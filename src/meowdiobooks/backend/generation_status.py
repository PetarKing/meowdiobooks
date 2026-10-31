"""Projection of generated chapter audio against current accepted inputs."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .artifacts import artifact_history
from .render_plan import compile_render_plan
from .review import apply_review_render_policies

RecipeCache = dict[tuple[str, ...], dict[str, dict[str, Any]] | None]
_RECIPE_INPUTS = ("dialogue", "review", "cast", "script")
_LINE_BREAK_HYPHEN = re.compile(r"[^\W\d_]+-[ \t]*\r?\n[ \t]*[^\W\d_]+")


def generated_chapters(
    package: Path, current_inputs: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    rows = []
    audio = package / "audio"
    comparison_cache: RecipeCache = {}
    for pointer in sorted(audio.glob("*/latest.json")):
        try:
            value = json.loads(pointer.read_text(encoding="utf-8"))
            revision = str(value["revision"])
            chapter_id = pointer.parent.name
            metadata_path = pointer.parent / revision / "metadata.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (KeyError, OSError, ValueError, json.JSONDecodeError):
            continue
        pinned = metadata.get("inputRevisions", {})
        expected = current_inputs or {}
        stale_reasons = chapter_audio_stale_reasons(
            package,
            {**metadata, "chapterId": chapter_id},
            expected,
            comparison_cache=comparison_cache,
        )
        revisions = []
        for candidate in sorted(pointer.parent.glob("*/metadata.json")):
            try:
                receipt = json.loads(candidate.read_text(encoding="utf-8"))
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            revisions.append(
                {
                    "revision": receipt.get("revision"),
                    "audioSeconds": receipt.get("audioSeconds"),
                    "segments": len(receipt.get("segments", [])),
                    "inputRevisions": receipt.get("inputRevisions", {}),
                }
            )
        rows.append(
            {
                "chapterId": chapter_id,
                "revision": revision,
                "audioUrl": f"/api/books/{metadata['bookId']}/chapters/{chapter_id}/{revision}/audio",
                "audioSeconds": metadata.get("audioSeconds"),
                "segments": list(metadata.get("segments", [])),
                "segmentCount": len(metadata.get("segments", [])),
                "inputRevisions": pinned,
                "current": not stale_reasons,
                "staleReasons": stale_reasons,
                "revisions": revisions,
            }
        )
    return rows


def chapter_audio_stale_reasons(
    package: Path,
    metadata: dict[str, Any],
    current_inputs: dict[str, Any],
    *,
    comparison_cache: RecipeCache | None = None,
) -> list[str]:
    """Compare the effective chapter recipe, preserving immutable audit revisions.

    A request-local cache compiles each complete input tuple once, even when many chapters
    share it. Missing or invalid history cannot establish equivalence. Snapshot and export
    use this same decision; no recipe receipt or global cache is persisted.
    """

    pinned = dict(metadata.get("inputRevisions", {}))
    reasons = [
        f"{kind}:{pinned.get(kind)}->{current_revision}"
        for kind, current_revision in current_inputs.items()
        if str(pinned.get(kind) or "") != str(current_revision or "")
    ]
    chapter_id = str(metadata.get("chapterId") or "")
    if not chapter_id:
        return reasons
    cache = comparison_cache if comparison_cache is not None else {}
    current = _chapter_recipes(package, current_inputs, cache)
    # Older renderers could join line-break hyphens after Review. Recompiling both
    # histories with today's compiler hides that change, even at identical revisions.
    # Compare their immutable receipt against the accepted text for affected chapters.
    if current is not None and chapter_id in current:
        segments = current[chapter_id]["segments"]
        if any(_LINE_BREAK_HYPHEN.search(str(row.get("text") or "")) for row in segments):
            recorded = metadata.get("segments")
            if not isinstance(recorded, list) or _spoken_texts(recorded, "mixGroupId") != _spoken_texts(segments, "mixGroup"):
                return [*reasons, "rendered-text:reviewed-hyphen-spelling"]
    if not reasons:
        return []
    previous = _chapter_recipes(package, pinned, cache)
    if (
        previous is not None
        and current is not None
        and chapter_id in previous
        and chapter_id in current
        and previous[chapter_id] == current[chapter_id]
    ):
        return []
    return reasons



def _spoken_texts(segments: list[dict[str, Any]], group_key: str) -> list[str]:
    """One text per timeline slot; native receipts collapse layered voice tracks."""
    result = []
    previous_group = None
    for segment in segments:
        if not isinstance(segment, dict) or not isinstance(segment.get("text"), str):
            return []  # An incomplete receipt cannot establish text equivalence.
        group = segment.get(group_key)
        if group is None or group != previous_group:
            result.append(" ".join(segment["text"].split()))
        previous_group = group
    return result

def _chapter_recipes(
    package: Path, inputs: dict[str, Any], cache: RecipeCache
) -> dict[str, dict[str, Any]] | None:
    revisions = tuple(str(inputs.get(kind) or "") for kind in _RECIPE_INPUTS)
    # Include the package so a caller cannot accidentally reuse one book's recipes for another.
    key = (str(package), *revisions)
    if key in cache:
        return cache[key]
    cache[key] = None
    if not all(revisions):
        return None
    try:
        artifacts = {
            kind: _artifact_revision(package, kind, revision)
            for kind, revision in zip(_RECIPE_INPUTS, revisions, strict=True)
        }
        if any(value is None for value in artifacts.values()):
            return None
        dialogue = artifacts["dialogue"]
        review = artifacts["review"]
        cast = artifacts["cast"]
        script = artifacts["script"]
        assert dialogue is not None and review is not None
        assert cast is not None and script is not None
        if any(
            str(script.get("inputRevisions", {}).get(kind) or "") != revisions[index]
            for index, kind in enumerate(_RECIPE_INPUTS[:-1])
        ):
            return None
        mapping = {str(key): str(value) for key, value in review["spanChapterIds"].items()}
        spans = list(dialogue["spans"])
        if set(mapping) != {str(row["id"]) for row in spans}:
            return None
        chapter_dialogue = apply_review_render_policies(
            {
                **dialogue,
                "spans": [{**row, "chapterId": mapping[str(row["id"])]} for row in spans],
            },
            review,
        )
        chapter_ids = list(
            dict.fromkeys(str(row.get("chapterId") or "chapter-1") for row in script["entries"])
        )
        plan = compile_render_plan(chapter_dialogue, cast, script, chapter_ids)
        recipes = {
            str(chapter["chapterId"]): {
                "voiceModel": cast.get("voiceModel"),
                "language": cast.get("language"),
                "timing": plan.get("timing"),
                "segments": _segment_recipe(chapter["segments"]),
            }
            for chapter in plan["chapters"]
        }
    except (OSError, ValueError, TypeError, KeyError, AttributeError, IndexError):
        return None
    cache[key] = recipes
    return recipes


def _segment_recipe(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Display names, source/entry IDs and receipt IDs are audit metadata. Ordered text,
    # voice inputs, passage boundaries and layered mixing determine the rendered chapter.
    groups: dict[str, int] = {}
    result = []
    for segment in segments:
        group_id = segment.get("mixGroupId")
        group = groups.setdefault(str(group_id), len(groups)) if group_id is not None else None
        result.append(
            {
                **{
                    field: segment.get(field)
                    for field in (
                        "text",
                        "effectiveCharacterId",
                        "voiceRevision",
                        "referenceAudio",
                        "referenceText",
                        "referenceMode",
                        "voiceSettings",
                        "boundaryBefore",
                    )
                },
                "mixGroup": group,
            }
        )
    return result


def _artifact_revision(package: Path, kind: str, revision: str) -> dict[str, Any] | None:
    return next(
        (
            row
            for row in artifact_history(package, kind)
            if str(row.get("revision") or "") == revision
        ),
        None,
    )
