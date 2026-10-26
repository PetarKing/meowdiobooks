"""Compile TTS-ready metadata directly from accepted v2 artifacts."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
import re
from typing import Any

from .boundary_render import BoundaryRenderError, validate_boundary_repairs
from .pacing import boundary_before, timing_policy
from .source_pacing import entry_parts, source_boundaries
from .voice_routing import narrator_route, speaker_labels


class RenderPlanError(ValueError):
    """Raised when accepted artifacts cannot produce a lossless playable plan."""


def compile_render_plan(
    dialogue: Mapping[str, Any],
    cast: Mapping[str, Any],
    recording_script: Mapping[str, Any],
    chapter_ids: Sequence[str],
) -> dict[str, Any]:
    """Compile selected chapters without regexes, source reparsing, or model calls."""

    selected = list(chapter_ids)
    if not selected or len(selected) != len(set(selected)):
        raise RenderPlanError("Selected chapter IDs must be non-empty and unique")
    dialogue_revision = _revision(dialogue, "Dialogue")
    cast_revision = _revision(cast, "Cast")
    script_revision = _revision(recording_script, "Recording script")
    if recording_script.get("status") != "ready":
        raise RenderPlanError("Recording script must be ready before generation")
    inputs = recording_script.get("inputRevisions", {})
    if str(inputs.get("dialogue")) != dialogue_revision:
        raise RenderPlanError("Recording script does not reference the accepted Dialogue revision")
    if str(inputs.get("cast")) != cast_revision:
        raise RenderPlanError("Recording script does not reference the accepted Cast revision")
    spans = _dialogue_spans(dialogue)
    span_index = {str(row["id"]): row for row in spans}
    span_positions = {str(row["id"]): index for index, row in enumerate(spans)}
    entries = list(recording_script.get("entries", []))
    _validate_script_coverage(entries, spans, recording_script)
    try:
        boundary_repairs = validate_boundary_repairs(recording_script.get("boundaryRepairs", []), spans, entries)
    except BoundaryRenderError as exc:
        raise RenderPlanError(str(exc)) from exc
    repair_by_pair = {(row["anchors"][0]["spanId"], row["anchors"][1]["spanId"]): row for row in boundary_repairs}
    intact_words = _intact_words(entries)
    available_chapters = {str(row.get("chapterId") or "chapter-1") for row in entries}
    unknown_chapters = sorted(set(selected) - available_chapters)
    if unknown_chapters:
        raise RenderPlanError(f"Unknown selected chapters: {unknown_chapters}")

    voices = _accepted_voices(cast)
    label_mapping = {
        str(label): character_id
        for label, character_id in cast.get("labelToCharacterId", {}).items()
    }
    segments_by_chapter: dict[str, list[dict[str, Any]]] = {value: [] for value in selected}
    omissions: list[dict[str, Any]] = []
    repaired_line_hyphenations = 0
    segment_number = 0
    boundaries = source_boundaries(spans, recording_script)
    pending_boundaries: dict[str, str] = {}
    for entry in entries:
        chapter_id = str(entry.get("chapterId") or "chapter-1")
        if chapter_id not in segments_by_chapter:
            continue
        kind = str(entry.get("kind", "source"))
        source_ids = [str(value) for value in entry.get("sourceSpanIds", [])]
        if kind == "omission":
            omissions.append(
                {
                    "entryId": str(entry.get("id")),
                    "chapterId": chapter_id,
                    "sourceSpanIds": source_ids,
                }
            )
            continue
        if kind != "source":
            raise RenderPlanError(f"Unsupported recording-script entry kind: {kind}")
        if not str(entry.get("text", "")):
            raise RenderPlanError(
                f"Playable recording-script entry {entry.get('id')} has empty text"
            )
        source_spans = [span_index[value] for value in source_ids]
        anchor = source_spans[0]
        render_role = str(anchor.get("renderRole", "narration"))
        if any(str(row.get("renderRole", "narration")) != render_role for row in source_spans):
            raise RenderPlanError(
                f"Recording-script entry {entry.get('id')} combines incompatible render roles"
            )
        effective = _effective_voices(anchor, label_mapping, voices, cast)
        mix_group = f"mix:{entry.get('id')}" if len(effective) > 1 else None
        for part_index, (part, boundary) in enumerate(entry_parts(entry, source_spans, boundaries)):
            if boundary is not None:
                previous_boundary = pending_boundaries.get(chapter_id)
                if previous_boundary != "chapter-heading":
                    pending_boundaries[chapter_id] = boundary
            if not part:
                continue
            text, line_hyphenations = _repair_line_break_hyphenation(part, intact_words)
            repaired_line_hyphenations += line_hyphenations
            speakable = any(character.isalnum() for character in text)
            kind = pending_boundaries.get(chapter_id, "turn")
            if not segments_by_chapter[chapter_id]:
                kind = "start"
            for voice, fallback in effective:
                segment_number += 1
                segment = _segment(
                    segment_number, chapter_id, entry, text, render_role, voice, source_ids,
                    fallback=fallback,
                    mix_group=f"{mix_group}:{part_index}" if mix_group else None,
                )
                segment["boundaryBefore"] = boundary_before(kind)
                segments_by_chapter[chapter_id].append(segment)
            if speakable:
                pending_boundaries.pop(chapter_id, None)

    compiled_chapters = []
    omitted_chapter_ids = []
    for chapter_id in selected:
        raw_segments = segments_by_chapter[chapter_id]
        if not raw_segments:
            omitted_chapter_ids.append(chapter_id)
            continue
        compiled_chapters.append(
            {
                "chapterId": chapter_id,
                "segments": _coalesce_narration(raw_segments, span_positions, repair_by_pair),
                "omissions": [row for row in omissions if row["chapterId"] == chapter_id],
            }
        )
    if not compiled_chapters:
        raise RenderPlanError("Selected chapters contain no playable text in the recording script")
    return {
        "contract": "meowdiobooks.render-plan.v2",
        "timing": timing_policy(),
        "inputRevisions": {
            "dialogue": dialogue_revision,
            "review": inputs.get("review"),
            "cast": cast_revision,
            "script": script_revision,
        },
        "selectedChapterIds": selected,
        "omittedChapterIds": omitted_chapter_ids,
        "sourceCoverage": {"status": "exact", "sourceSpanCount": len(spans)},
        "chapters": compiled_chapters,
        "summary": {
            "segments": sum(len(row["segments"]) for row in compiled_chapters),
            "omissions": len(omissions),
            "fallbackSegments": sum(
                segment["fallback"] is not None
                for chapter in compiled_chapters
                for segment in chapter["segments"]
            ),
            "omittedChapters": len(omitted_chapter_ids),
            "repairedLineBreakHyphenations": repaired_line_hyphenations,
        },
    }


_LINE_BREAK_HYPHEN = re.compile(
    r"(?P<left>[^\W\d_]+)-[ \t]*\r?\n[ \t]*(?P<right>[^\W\d_]+)",
    re.UNICODE,
)
_INTACT_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)


def _intact_words(entries: Sequence[Mapping[str, Any]]) -> set[str]:
    """Collect book-local evidence without treating split fragments as intact words."""

    words: set[str] = set()
    for entry in entries:
        text = _LINE_BREAK_HYPHEN.sub(" ", str(entry.get("text", "")))
        words.update(match.group(0).casefold() for match in _INTACT_WORD.finditer(text))
    return words


def _repair_line_break_hyphenation(text: str, intact_words: set[str]) -> tuple[str, int]:
    """Join only line-broken words corroborated elsewhere in the accepted book text."""

    repaired = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal repaired
        joined = match.group("left") + match.group("right")
        if joined.casefold() not in intact_words:
            return match.group(0)
        repaired += 1
        return joined

    return _LINE_BREAK_HYPHEN.sub(replace, text), repaired


def _dialogue_spans(dialogue: Mapping[str, Any]) -> list[dict[str, Any]]:
    spans = [dict(row) for row in (dialogue.get("spans") or dialogue.get("partition") or [])]
    ids = [str(row.get("id", "")) for row in spans]
    if not spans or any(not value for value in ids) or len(ids) != len(set(ids)):
        raise RenderPlanError("Dialogue requires non-empty unique source span IDs")
    by_block: dict[str, list[dict[str, Any]]] = {}
    for span in spans:
        by_block.setdefault(str(span.get("blockId", "")), []).append(span)
    for block_id, rows in by_block.items():
        ordered = sorted(rows, key=lambda row: int(row.get("sourceStart", 0)))
        cursor = 0
        for row in ordered:
            start = int(row.get("sourceStart", 0))
            end = int(row.get("sourceEnd", 0))
            if start != cursor or end < start:
                raise RenderPlanError(f"Dialogue source coverage is not contiguous in {block_id}")
            source = str(row.get("source", ""))
            if len(source) != end - start:
                raise RenderPlanError(
                    f"Dialogue span {row.get('id')} source evidence disagrees with its range"
                )
            cursor = end
    return spans


def _validate_script_coverage(
    entries: Sequence[Mapping[str, Any]],
    spans: Sequence[Mapping[str, Any]],
    recording_script: Mapping[str, Any],
) -> None:
    expected = [str(row["id"]) for row in spans]
    unsupported = sorted(
        {str(entry.get("kind", "source")) for entry in entries} - {"source", "omission"}
    )
    if unsupported:
        raise RenderPlanError(f"Unsupported recording-script entry kinds: {unsupported}")
    owner_ids = [str(span_id) for entry in entries for span_id in entry.get("sourceSpanIds", [])]
    if sorted(owner_ids) != sorted(expected) or len(owner_ids) != len(set(owner_ids)):
        raise RenderPlanError("Recording script must own every Dialogue span exactly once")
    declared = [
        str(value) for value in recording_script.get("sourceCoverage", {}).get("sourceSpanIds", [])
    ]
    if recording_script.get("sourceCoverage", {}).get("status") != "exact" or sorted(
        declared
    ) != sorted(expected):
        raise RenderPlanError("Recording-script source-coverage receipt is invalid")


def _accepted_voices(cast: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for raw in cast.get("identities", []):
        character_id = str(raw.get("characterId", ""))
        if not character_id:
            raise RenderPlanError("Cast identity has no characterId")
        if character_id in result:
            raise RenderPlanError(f"Duplicate Cast characterId: {character_id}")
        route = raw.get("voiceRoute")
        if isinstance(route, Mapping) and str(route.get("kind", "")) == "layered":
            if raw.get("category") != "group" or not raw.get("voiceAccepted"):
                raise RenderPlanError(f"Layered voice route is invalid for {character_id}")
            member_ids = [str(value) for value in route.get("characterIds", []) if str(value)]
            if len(member_ids) < 2 or len(set(member_ids)) != len(member_ids):
                raise RenderPlanError(
                    f"Layered voice route requires two unique members for {character_id}"
                )
            result[character_id] = {
                "characterId": character_id,
                "name": str(raw.get("name") or character_id),
                "category": "group",
                "voiceRoute": {"kind": "layered", "characterIds": member_ids},
            }
        else:
            result[character_id] = _voice(raw, character_id)
    for character_id, voice in result.items():
        route = voice.get("voiceRoute")
        if not isinstance(route, Mapping):
            continue
        for member_id in route["characterIds"]:
            member = result.get(str(member_id))
            if member is None or member.get("category") != "character" or member.get("voiceRoute"):
                raise RenderPlanError(
                    f"Layered group {character_id} references an unavailable accepted character voice"
                )
    return result


def _narrator_voice(cast: Mapping[str, Any]) -> dict[str, Any]:
    narrator = cast.get("narrator")
    if not isinstance(narrator, Mapping):
        raise RenderPlanError("Cast requires an accepted narrator voice")
    return _voice(narrator, str(narrator.get("characterId") or "narrator"))


def _voice(raw: Mapping[str, Any], character_id: str) -> dict[str, Any]:
    if not raw.get("voiceAccepted"):
        raise RenderPlanError(f"Voice is not accepted for {character_id}")
    revision = str(raw.get("acceptedVoiceRevision") or raw.get("voiceRevision") or "")
    reference_audio = str(raw.get("referenceAudio") or raw.get("referenceAudioPath") or "")
    reference_text = str(raw.get("referenceText") or "")
    reference_mode = str(raw.get("referenceMode") or "transcript-conditioned")
    if reference_mode not in {"transcript-conditioned", "speaker-embedding"}:
        raise RenderPlanError(f"Accepted voice mode is unsupported for {character_id}")
    if (
        not revision
        or not reference_audio
        or (reference_mode == "transcript-conditioned" and not reference_text)
    ):
        raise RenderPlanError(f"Accepted voice metadata is incomplete for {character_id}")
    voice = {
        "characterId": character_id,
        "name": str(raw.get("name") or character_id),
        "category": str(raw.get("category") or "character"),
        "voiceRevision": revision,
        "referenceAudio": reference_audio,
        "referenceText": reference_text,
        "referenceMode": reference_mode,
    }
    voice_settings = raw.get("voiceSettings")
    if voice_settings is not None:
        if not isinstance(voice_settings, Mapping):
            raise RenderPlanError(f"Accepted voice settings are invalid for {character_id}")
        voice["voiceSettings"] = deepcopy(dict(voice_settings))
    return voice


def _effective_voices(
    span: Mapping[str, Any],
    label_mapping: Mapping[str, Any],
    voices: Mapping[str, dict[str, Any]],
    cast: Mapping[str, Any],
) -> list[tuple[dict[str, Any], str | None]]:
    needs_narrator, fallback = narrator_route(span, label_mapping)
    if needs_narrator:
        return [(_narrator_voice(cast), fallback)]
    result: list[tuple[dict[str, Any], str | None]] = []
    for label in speaker_labels(span):
        character_id = label_mapping[label]
        voice = voices.get(str(character_id))
        if voice is None:
            raise RenderPlanError(f"Cast mapping for {label} has no accepted identity voice")
        route = voice.get("voiceRoute")
        if isinstance(route, Mapping) and route.get("kind") == "layered":
            result.extend((voices[str(member_id)], None) for member_id in route["characterIds"])
        else:
            result.append((voice, None))
    deduplicated: list[tuple[dict[str, Any], str | None]] = []
    seen: set[str] = set()
    for voice, fallback in result:
        character_id = str(voice["characterId"])
        if character_id not in seen:
            seen.add(character_id)
            deduplicated.append((voice, fallback))
    return deduplicated


def _segment(
    number: int,
    chapter_id: str,
    entry: Mapping[str, Any],
    text: str,
    render_role: str,
    voice: Mapping[str, Any],
    source_ids: Sequence[str],
    *,
    fallback: str | None,
    mix_group: str | None = None,
) -> dict[str, Any]:
    segment = {
        "id": f"segment-{number:06d}",
        "chapterId": chapter_id,
        "scriptEntryIds": [str(entry.get("id"))],
        "sourceSpanIds": list(source_ids),
        "text": text,
        "renderRole": render_role,
        "effectiveCharacterId": voice["characterId"],
        "effectiveSpeaker": voice["name"],
        "voiceRevision": voice["voiceRevision"],
        "referenceAudio": voice["referenceAudio"],
        "referenceText": voice["referenceText"],
        "referenceMode": voice["referenceMode"],
        "fallback": fallback,
        "mixGroupId": mix_group,
    }
    if "voiceSettings" in voice:
        segment["voiceSettings"] = deepcopy(voice["voiceSettings"])
    return segment


def _coalesce_narration(
    segments: Sequence[dict[str, Any]], span_positions: Mapping[str, int],
    boundary_repairs: Mapping[tuple[str, str], Mapping[str, Any]],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    source_ids = {source_id for segment in segments for source_id in segment["sourceSpanIds"]}
    required = {pair for pair in boundary_repairs if set(pair) <= source_ids}
    applied = set()
    for raw in segments:
        segment = dict(raw)
        previous = result[-1] if result else None
        repair = boundary_repairs.get((previous["sourceSpanIds"][-1], segment["sourceSpanIds"][0])) if previous else None
        if repair is not None:
            if not _safe_boundary_pair(previous, segment):
                raise RenderPlanError("Accepted boundary repair has incompatible voice routing")
            left, right = repair["anchors"]
            applied.add((left["spanId"], right["spanId"]))
            if not previous["text"].endswith(left["source"]) or not segment["text"].startswith(right["source"]):
                raise RenderPlanError("Accepted boundary repair conflicts with rendered text normalization")
            previous["text"] = previous["text"][:-len(left["source"])] + repair["replacement"] + segment["text"][len(right["source"]):]
            previous["scriptEntryIds"].extend(segment["scriptEntryIds"])
            previous["sourceSpanIds"].extend(segment["sourceSpanIds"])
            continue
        if previous is not None and _safe_narration_pair(previous, segment, span_positions):
            previous["text"] += segment["text"]
            previous["scriptEntryIds"].extend(segment["scriptEntryIds"])
            previous["sourceSpanIds"].extend(segment["sourceSpanIds"])
            continue
        result.append(segment)
    if applied != required:
        raise RenderPlanError("Accepted boundary repairs could not be rendered with current voice routing")
    return result


def _safe_narration_pair(
    left: Mapping[str, Any], right: Mapping[str, Any], span_positions: Mapping[str, int]
) -> bool:
    left_ids = list(left.get("sourceSpanIds", []))
    right_ids = list(right.get("sourceSpanIds", []))
    source_contiguous = (
        bool(left_ids)
        and bool(right_ids)
        and span_positions.get(str(left_ids[-1]), -2) + 1
        == span_positions.get(str(right_ids[0]), -4)
    )
    return (
        source_contiguous
        and right.get("boundaryBefore", {}).get("kind") not in {"paragraph", "chapter-heading"}
        and left.get("renderRole") == right.get("renderRole") == "narration"
        and left.get("effectiveCharacterId") == right.get("effectiveCharacterId")
        and left.get("voiceRevision") == right.get("voiceRevision")
        and left.get("fallback") == right.get("fallback")
        and left.get("mixGroupId") is None
        and right.get("mixGroupId") is None
    )


def _revision(artifact: Mapping[str, Any], label: str) -> str:
    revision = str(artifact.get("revision", "")).strip()
    if not revision:
        raise RenderPlanError(f"{label} revision is required")
    return revision


def _safe_boundary_pair(left, right):
    return (left.get("mixGroupId") is None and right.get("mixGroupId") is None
            and all(left.get(key) == right.get(key) for key in (
                "chapterId", "renderRole", "effectiveCharacterId", "voiceRevision", "fallback",
                "referenceAudio", "referenceText", "referenceMode", "voiceSettings")))
