"""Run reproducible, ignored Qwen dialogue-attribution experiments.

The experiment freezes production LiteParse extraction and regex targets once, then varies only
the prompt, bounded context, or call shape. It does not add speaker-resolution rules to the app.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
import urllib.request
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from meowdiobooks.backend.dialogue import scan_dialogue
from meowdiobooks.backend.dialogue_ai import (
    SYSTEM,
    _bounded_target,
    _clean_prompt_text,
    _focused_context,
    _validate_speaker_evidence,
    parse_attribution_answer,
)
from meowdiobooks.backend.documents import extract_full_document
from meowdiobooks.backend.local_llm import qwen_server

SCHEMA_VERSION = 1
MAX_MULTI_PROMPT_CHARACTERS = 5_200
DEFAULT_OUTPUT = Path("tmp/dialogue-attribution-experiment")
DEFAULT_BOOKS = {
    "alice": Path("SampleBooks/public-domain-evaluation/01-alice-explicit-dialogue.pdf"),
    "pride": Path("SampleBooks/public-domain-evaluation/02-pride-inferred-multispeaker.pdf"),
    "ah-q": Path("SampleBooks/public-domain-evaluation/03-ah-q-traditional-chinese-dialogue.pdf"),
}
OPEN_SPEAKER_PATTERNS = (r"^\?{2,}$", r"^UNKNOWN$", r"^Unidentified Voice$")

IDENTITY_REWRITE_SYSTEM = """Who speaks SPEECH? Return exactly one answer:

- the speaker's actual name
- ? if SPEECH is dialogue but an actual name cannot be inferred
- / if SPEECH is quoted text that is not spoken aloud

A pronoun such as he, she, or they is evidence, not a speaker name. A description such as
"the man" is not an actual name. If the passage supports only a pronoun or description, return ?.
If AFTER directly names who said SPEECH, that name wins. Otherwise use a name that directly
introduces SPEECH in BEFORE. Return only the name, ? or /."""

IDENTITY_APPEND_SYSTEM = SYSTEM + """

Identity guard: a pronoun such as he, she, or they is evidence, not a speaker name. A description
such as "the man" is not an actual name. If the passage supports only a pronoun or description,
return ?."""

CONVERSATION_SYSTEM = IDENTITY_APPEND_SYSTEM + """

Read the passage in order and follow the conversation. Do not copy a nearby name when that
person is being addressed, observing, or discussed."""

MULTI_FIXED_EXAMPLE_SYSTEM = """Who speaks each numbered SPEECH? For each one, choose exactly one answer:

- a person's name
- ? if SPEECH is dialogue but the speaker is unknown
- / if SPEECH is only a quoted term inside narration

Rules:
1. If AFTER directly attributes SPEECH to a name, return that name. This wins over names in BEFORE.
2. Otherwise, use a name that directly introduces SPEECH in BEFORE.
3. Attribution verbs include said, asked, replied, murmured, shouted, warned, admitted, confessed,
   whispered, ordered, and cautioned.
4. If BEFORE + SPEECH + AFTER is one narrator sentence containing a quoted term, return /. Otherwise,
   a complete quoted sentence is dialogue.
5. If it is dialogue with no reliable speaker, return ?.

Read the numbered passages in order.

Return exactly one JSON object in this form and nothing else:
{"answers":["name or ? or /", "name or ? or /"]}"""

MULTI_COUNTED_SYSTEM = """Who speaks each numbered SPEECH? For each one, choose exactly one answer:

- a person's name
- ? if SPEECH is dialogue but the speaker is unknown
- / if SPEECH is only a quoted term inside narration

Rules:
1. If AFTER directly attributes SPEECH to a name, return that name. This wins over names in BEFORE.
2. Otherwise, use a name that directly introduces SPEECH in BEFORE.
3. Attribution verbs include said, asked, replied, murmured, shouted, warned, admitted, confessed,
   whispered, ordered, and cautioned.
4. If BEFORE + SPEECH + AFTER is one narrator sentence containing a quoted term, return /. Otherwise,
   a complete quoted sentence is dialogue.
5. If it is dialogue with no reliable speaker, return ?.

Read the numbered passages in order. Return only one JSON object with an "answers" array. The user
states the exact required array length; return one answer per numbered SPEECH in the same order."""

VARIANTS = {
    "v0-control": {"system": SYSTEM, "units": 1, "characters": 700, "shape": "single"},
    "v1-identity": {
        "system": IDENTITY_REWRITE_SYSTEM,
        "units": 1,
        "characters": 700,
        "shape": "single",
    },
    "v1b-identity-append": {
        "system": IDENTITY_APPEND_SYSTEM,
        "units": 1,
        "characters": 700,
        "shape": "single",
    },
    "v2-conversation": {
        "system": CONVERSATION_SYSTEM,
        "units": 1,
        "characters": 700,
        "shape": "single",
    },
    "v3-balanced": {
        "system": SYSTEM,
        "units": 3,
        "characters": 900,
        "shape": "single",
    },
    "v4-broad": {
        "system": SYSTEM,
        "units": 6,
        "characters": 1_600,
        "shape": "single",
    },
    "v5-multi": {
        "system": MULTI_FIXED_EXAMPLE_SYSTEM,
        "units": 1,
        "characters": 700,
        "shape": "multi",
    },
    "v5b-multi-counted": {
        "system": MULTI_COUNTED_SYSTEM,
        "units": 1,
        "characters": 700,
        "shape": "multi",
        "counted": True,
    },
}


def _json_dump(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def _append_jsonl(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        for row in rows:
            stream.write(json.dumps(dict(row), ensure_ascii=False) + "\n")
            stream.flush()


def _source_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _target_spans(scan: Mapping[str, Any], owner_pages: set[int]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    targets = []
    for span in scan.get("partition", []):
        if int(span.get("page", 0)) not in owner_pages:
            continue
        if span.get("renderRole") != "dialogue":
            continue
        if span.get("speakerStatus") not in {"unlabelled", "unresolved"}:
            continue
        logical = str(span.get("turnGroupId") or span["id"])
        if logical in seen:
            continue
        seen.add(logical)
        targets.append(dict(span))
    return targets


def _window_density(pages: Sequence[Mapping[str, Any]], start: int) -> dict[str, Any]:
    owned = [page for page in pages if start <= int(page["page"]) <= start + 1]
    if len(owned) != 2:
        return {"start": start, "end": start + 1, "targets": 0, "characters": 0, "density": 0.0}
    scan = scan_dialogue(
        owned,
        open_speaker_patterns=OPEN_SPEAKER_PATTERNS,
    )
    targets = len(_target_spans(scan, {start, start + 1}))
    characters = sum(len(str(page.get("text", ""))) for page in owned)
    return {
        "start": start,
        "end": start + 1,
        "targets": targets,
        "characters": characters,
        "density": targets / max(1, characters) * 1_000,
    }


def select_density_windows(pages: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Select five non-overlapping two-page windows across the density distribution."""

    page_numbers = sorted(int(page["page"]) for page in pages)
    candidates = [_window_density(pages, start) for start in page_numbers if start + 1 in page_numbers]
    eligible = [row for row in candidates if row["targets"] >= 3]
    if len(eligible) < 5:
        eligible = [row for row in candidates if row["targets"] >= 1]
    if len(eligible) < 5:
        raise RuntimeError("Book has fewer than five usable two-page Dialogue windows")
    ordered = sorted(eligible, key=lambda row: (row["density"], row["start"]))
    percentiles = (0.1, 0.3, 0.5, 0.7, 0.9)
    selected: list[dict[str, Any]] = []
    used_pages: set[int] = set()
    for percentile in percentiles:
        rank = min(len(ordered) - 1, round((len(ordered) - 1) * percentile))
        target_density = float(ordered[rank]["density"])
        choices = sorted(
            (
                row
                for row in eligible
                if not ({int(row["start"]), int(row["end"])} & used_pages)
            ),
            key=lambda row: (abs(float(row["density"]) - target_density), row["start"]),
        )
        if not choices:
            raise RuntimeError("Could not select five non-overlapping density windows")
        choice = choices[0]
        selected.append(choice)
        used_pages.update((int(choice["start"]), int(choice["end"])))
    return sorted(selected, key=lambda row: row["start"])


def _accepted_extraction(repo_root: Path, source: Path) -> list[dict[str, Any]] | None:
    book_id = f"book_{_source_hash(source)[:20]}"
    latest = repo_root / ".meowdiobooks" / "packages" / book_id / "artifacts" / "latest.json"
    if not latest.is_file():
        return None
    pointer = json.loads(latest.read_text(encoding="utf-8")).get("extraction")
    if not pointer:
        return None
    artifact_path = Path(str(pointer))
    if not artifact_path.is_absolute():
        artifact_path = repo_root / artifact_path
    if not artifact_path.is_file():
        return None
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    return [dict(page) for page in artifact.get("pages", [])]


def _extract_book(repo_root: Path, output: Path, book_id: str, source: Path) -> list[dict[str, Any]]:
    accepted = _accepted_extraction(repo_root, source)
    if accepted is not None:
        return accepted
    return extract_full_document(
        source,
        output / "cache" / book_id,
        "liteparse",
        lambda progress, message=None: print(
            f"[{book_id}] {progress:5.1f}% {message or ''}", flush=True
        ),
    )


def prepare(repo_root: Path, output: Path, books: Mapping[str, Path]) -> dict[str, Any]:
    manifest_books = []
    corpus_windows = []
    gold_rows = []
    for book_id, relative_source in books.items():
        source = relative_source if relative_source.is_absolute() else repo_root / relative_source
        if not source.is_file():
            raise FileNotFoundError(source)
        pages = _extract_book(repo_root, output, book_id, source)
        if book_id == "alice" and len(pages) == 10:
            chosen = [
                {
                    "start": int(pages[0]["page"]),
                    "end": int(pages[-1]["page"]),
                    "targets": None,
                    "characters": sum(len(str(page.get("text", ""))) for page in pages),
                    "density": None,
                }
            ]
        else:
            chosen = select_density_windows(pages)
        page_map = {int(page["page"]): dict(page) for page in pages}
        selected_pages = sorted(
            {page for window in chosen for page in range(int(window["start"]), int(window["end"]) + 1)}
        )
        manifest_books.append(
            {
                "id": book_id,
                "source": str(relative_source),
                "sourceHash": _source_hash(source),
                "pageCount": len(pages),
                "selectedPages": selected_pages,
                "selectionWindows": chosen,
            }
        )
        for window_index, chosen_window in enumerate(chosen, 1):
            owner_start = int(chosen_window["start"])
            owner_end = int(chosen_window["end"])
            context_start = max(min(page_map), owner_start - 1)
            context_end = min(max(page_map), owner_end + 1)
            context_pages = [
                page_map[page]
                for page in range(context_start, context_end + 1)
                if page in page_map
            ]
            scan = scan_dialogue(
                context_pages,
                open_speaker_patterns=OPEN_SPEAKER_PATTERNS,
            )
            targets = _target_spans(scan, set(range(owner_start, owner_end + 1)))
            logical_turns = {
                str(span.get("turnGroupId") or span["id"]): span
                for span in scan["partition"]
                if span.get("renderRole") == "dialogue"
                and owner_start <= int(span.get("page", 0)) <= owner_end
            }
            explicit = sum(span.get("speakerStatus") == "explicit" for span in logical_turns.values())
            total_dialogue = len(logical_turns)
            source_characters = sum(
                len(str(page_map[page].get("text", "")))
                for page in range(owner_start, owner_end + 1)
                if page in page_map
            )
            window_id = f"{book_id}-window-{window_index:02d}"
            target_ids = [str(span["id"]) for span in targets]
            corpus_windows.append(
                {
                    "id": window_id,
                    "bookId": book_id,
                    "ownerPages": list(range(owner_start, owner_end + 1)),
                    "contextPages": [int(page["page"]) for page in context_pages],
                    "sourceCharacters": source_characters,
                    "dialogueCharacters": sum(
                        len(str(span.get("source", ""))) for span in logical_turns.values()
                    ),
                    "explicitTurns": explicit,
                    "totalDialogueTurns": total_dialogue,
                    "labelledShare": explicit / max(1, total_dialogue),
                    "partition": scan["partition"],
                    "targetIds": target_ids,
                }
            )
            for target in targets:
                sample_id = f"{book_id}:{target['id']}"
                dossier = experiment_dossier(scan["partition"], str(target["id"]), 6, 1_600)
                gold_rows.append(
                    {
                        "sampleId": sample_id,
                        "bookId": book_id,
                        "windowId": window_id,
                        "page": target["page"],
                        "target": dossier["target"],
                        "reviewBefore": dossier["before"],
                        "reviewAfter": dossier["after"],
                        "classification": None,
                        "canonicalSpeaker": None,
                        "acceptedAliases": [],
                        "speakerInferable": None,
                        "evidence": None,
                        "confidence": None,
                    }
                )
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "extractionMethod": "liteparse",
        "selection": "five non-overlapping two-page windows at density percentiles",
        "books": manifest_books,
        "sampleCount": len(gold_rows),
    }
    _json_dump(output / "manifest.json", manifest)
    _json_dump(output / "corpus.json", {"schemaVersion": SCHEMA_VERSION, "windows": corpus_windows})
    gold_path = output / "gold.jsonl"
    if not gold_path.exists():
        _append_jsonl(gold_path, gold_rows)
    print(json.dumps({"sampleCount": len(gold_rows), "books": manifest_books}, indent=2))
    return manifest


def experiment_dossier(
    partition: Sequence[Mapping[str, Any]],
    owner_id: str,
    context_units: int,
    context_characters: int,
) -> dict[str, Any]:
    positions = {str(span["id"]): index for index, span in enumerate(partition)}
    position = positions[owner_id]
    target = partition[position]
    group_id = target.get("turnGroupId")
    group_positions = [
        index
        for index, span in enumerate(partition)
        if group_id is not None and span.get("turnGroupId") == group_id
    ] or [position]
    target_text = _clean_prompt_text(
        "".join(str(partition[index].get("source", partition[index].get("text", ""))) for index in group_positions)
    )
    return {
        "spanId": owner_id,
        "spanIds": [str(partition[index]["id"]) for index in group_positions],
        "page": int(target.get("page", 0)),
        "before": _focused_context(
            partition,
            min(group_positions),
            -1,
            max_characters=context_characters,
            max_units=context_units,
        ),
        "target": _bounded_target(target_text, 1_200),
        "after": _focused_context(
            partition,
            max(group_positions),
            1,
            max_characters=context_characters,
            max_units=context_units,
        ),
    }


def _single_prompt(dossier: Mapping[str, Any]) -> str:
    return "\n".join(
        (
            "BEFORE",
            str(dossier.get("before") or "(none)"),
            "",
            "SPEECH",
            str(dossier.get("target") or "(empty)"),
            "",
            "AFTER",
            str(dossier.get("after") or "(none)"),
        )
    )


def _multi_prompt(dossiers: Sequence[Mapping[str, Any]], *, counted: bool = False) -> str:
    rows = ["PASSAGES"]
    for index, dossier in enumerate(dossiers, 1):
        rows.extend(
            (
                "",
                f"SPEECH {index}",
                f"BEFORE: {dossier.get('before') or '(none)'}",
                f"SPEECH: {dossier.get('target') or '(empty)'}",
                f"AFTER: {dossier.get('after') or '(none)'}",
            )
        )
    if counted:
        placeholders = ",".join('"name or ? or /"' for _ in dossiers)
        rows.extend(
            (
                "",
                f"Return exactly {len(dossiers)} answers, one for each numbered SPEECH.",
                f'{{"answers":[{placeholders}]}}',
            )
        )
    return "\n".join(rows)


def _bounded_multi_groups(
    partition: Sequence[Mapping[str, Any]],
    owners: Sequence[str],
    config: Mapping[str, Any],
) -> list[tuple[list[str], list[dict[str, Any]], str]]:
    """Group at most three targets without exceeding the multi-call prompt cap."""
    groups: list[tuple[list[str], list[dict[str, Any]], str]] = []
    group_owners: list[str] = []
    group_dossiers: list[dict[str, Any]] = []
    for owner in owners:
        dossier = experiment_dossier(
            partition,
            owner,
            int(config["units"]),
            int(config["characters"]),
        )
        candidate_dossiers = [*group_dossiers, dossier]
        counted = bool(config.get("counted"))
        candidate_prompt = _multi_prompt(candidate_dossiers, counted=counted)
        if group_dossiers and (
            len(group_dossiers) == 3 or len(candidate_prompt) > MAX_MULTI_PROMPT_CHARACTERS
        ):
            groups.append(
                (group_owners, group_dossiers, _multi_prompt(group_dossiers, counted=counted))
            )
            group_owners = []
            group_dossiers = []
            candidate_dossiers = [dossier]
            candidate_prompt = _multi_prompt(candidate_dossiers)
        if len(candidate_prompt) > MAX_MULTI_PROMPT_CHARACTERS:
            raise ValueError(
                f"Single multi-target dossier exceeds {MAX_MULTI_PROMPT_CHARACTERS} characters: {owner}"
            )
        group_owners.append(owner)
        group_dossiers.append(dossier)
    if group_dossiers:
        groups.append(
            (group_owners, group_dossiers, _multi_prompt(group_dossiers, counted=counted))
        )
    return groups


def _request(base: str, system: str, prompt: str, *, max_tokens: int, json_mode: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": "qwen3.5-9b",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.0,
        "max_tokens": max_tokens,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    request = urllib.request.Request(
        f"{base}/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.perf_counter()
    response = json.loads(urllib.request.urlopen(request, timeout=600).read())
    return {
        "raw": str(response["choices"][0]["message"]["content"]).strip(),
        "usage": dict(response.get("usage", {})),
        "latencyMs": round((time.perf_counter() - started) * 1_000),
    }


def _windows(output: Path) -> list[dict[str, Any]]:
    return list(json.loads((output / "corpus.json").read_text(encoding="utf-8"))["windows"])


def _single_rows(
    base: str,
    variant: str,
    window: Mapping[str, Any],
    completed: set[str],
) -> Iterable[dict[str, Any]]:
    config = VARIANTS[variant]
    partition = list(window["partition"])
    for owner_id in window["targetIds"]:
        sample_id = f"{window['bookId']}:{owner_id}"
        if sample_id in completed:
            continue
        dossier = experiment_dossier(
            partition,
            str(owner_id),
            int(config["units"]),
            int(config["characters"]),
        )
        prompt = _single_prompt(dossier)
        response = _request(base, str(config["system"]), prompt, max_tokens=128, json_mode=False)
        parse_error = None
        prediction = None
        validator_accepted = None
        try:
            prediction = parse_attribution_answer(response["raw"])
            context = "\n".join(str(dossier[field]) for field in ("before", "target", "after"))
            try:
                _validate_speaker_evidence(prediction, context, sample_id)
                validator_accepted = True
            except Exception:
                validator_accepted = False
        except Exception as error:
            parse_error = str(error)
        yield {
            "sampleId": sample_id,
            "bookId": window["bookId"],
            "windowId": window["id"],
            "variant": variant,
            "callId": f"{variant}:{sample_id}",
            "prediction": prediction,
            "raw": response["raw"],
            "parseError": parse_error,
            "validatorAccepted": validator_accepted,
            "latencyMs": response["latencyMs"],
            "usage": response["usage"],
            "promptCharacters": len(prompt),
            "sourceCharacters": sum(len(str(dossier[field])) for field in ("before", "target", "after")),
        }


def _parse_multi(raw: str, expected: int) -> list[str]:
    payload = json.loads(raw)
    answers = payload.get("answers")
    if not isinstance(answers, list) or len(answers) != expected:
        raise ValueError(f"Expected {expected} answers")
    return [parse_attribution_answer(str(answer)) for answer in answers]


def _multi_rows(
    base: str,
    variant: str,
    window: Mapping[str, Any],
    completed: set[str],
) -> Iterable[dict[str, Any]]:
    config = VARIANTS[variant]
    partition = list(window["partition"])
    pending = [
        str(owner_id)
        for owner_id in window["targetIds"]
        if f"{window['bookId']}:{owner_id}" not in completed
    ]
    groups = _bounded_multi_groups(partition, pending, config)
    for group_index, (owners, dossiers, prompt) in enumerate(groups, 1):
        call_id = f"{variant}:{window['id']}:{group_index}"
        response = _request(base, str(config["system"]), prompt, max_tokens=256, json_mode=True)
        parse_error = None
        predictions: list[str | None] = [None] * len(owners)
        try:
            predictions = _parse_multi(response["raw"], len(owners))
        except Exception as error:
            parse_error = str(error)
        usage = response["usage"]
        for owner, dossier, prediction in zip(owners, dossiers, predictions, strict=True):
            validator_accepted = None
            if prediction is not None:
                context = "\n".join(str(dossier[field]) for field in ("before", "target", "after"))
                try:
                    _validate_speaker_evidence(prediction, context, owner)
                    validator_accepted = True
                except Exception:
                    validator_accepted = False
            yield {
                "sampleId": f"{window['bookId']}:{owner}",
                "bookId": window["bookId"],
                "windowId": window["id"],
                "variant": variant,
                "callId": call_id,
                "prediction": prediction,
                "raw": response["raw"],
                "parseError": parse_error,
                "validatorAccepted": validator_accepted,
                "latencyMs": response["latencyMs"],
                "usage": usage,
                "promptCharacters": len(prompt),
                "sourceCharacters": sum(
                    len(str(row[field])) for row in dossiers for field in ("before", "target", "after")
                ),
            }


def run_variant(repo_root: Path, output: Path, variant: str) -> None:
    if variant not in VARIANTS:
        raise ValueError(f"Unknown variant: {variant}")
    run_path = output / "runs" / f"{variant}.jsonl"
    completed = {str(row["sampleId"]) for row in _jsonl(run_path)}
    windows = _windows(output)
    with qwen_server(repo_root) as base:
        for window in windows:
            rows = (
                _multi_rows(base, variant, window, completed)
                if VARIANTS[variant]["shape"] == "multi"
                else _single_rows(base, variant, window, completed)
            )
            for row in rows:
                _append_jsonl(run_path, [row])
                completed.add(str(row["sampleId"]))
                print(f"[{variant}] {len(completed)} {row['sampleId']} -> {row['prediction']}", flush=True)


def merge_gold_parts(output: Path, parts: Sequence[Path]) -> list[dict[str, Any]]:
    """Validate blinded label parts and merge them over the frozen gold template."""
    template_rows = _jsonl(output / "gold.jsonl")
    template = {str(row["sampleId"]): row for row in template_rows}
    if len(template) != len(template_rows):
        raise ValueError("Frozen gold template contains duplicate sample IDs")
    labels: dict[str, dict[str, Any]] = {}
    for part in parts:
        for row in _jsonl(part):
            sample_id = str(row.get("sampleId", ""))
            if sample_id not in template:
                raise ValueError(f"Unknown sample ID in {part}: {sample_id}")
            if sample_id in labels:
                raise ValueError(f"Duplicate gold label: {sample_id}")
            classification = row.get("classification")
            if classification not in {"dialogue", "prose"}:
                raise ValueError(f"Invalid classification for {sample_id}: {classification}")
            inferable = row.get("speakerInferable")
            if not isinstance(inferable, bool):
                raise ValueError(f"speakerInferable must be boolean for {sample_id}")
            canonical = row.get("canonicalSpeaker")
            if classification == "prose" and (inferable or canonical is not None):
                raise ValueError(f"Prose cannot have a speaker for {sample_id}")
            if classification == "dialogue" and inferable and not str(canonical or "").strip():
                raise ValueError(f"Inferable dialogue needs a canonical speaker for {sample_id}")
            if classification == "dialogue" and not inferable and canonical is not None:
                raise ValueError(f"Non-inferable dialogue cannot have a canonical speaker for {sample_id}")
            if row.get("confidence") not in {"high", "medium", "low"}:
                raise ValueError(f"Invalid confidence for {sample_id}")
            if not str(row.get("evidence") or "").strip():
                raise ValueError(f"Missing evidence for {sample_id}")
            aliases = row.get("acceptedAliases")
            if not isinstance(aliases, list) or not all(str(value).strip() for value in aliases):
                raise ValueError(f"acceptedAliases must be a list of non-empty strings for {sample_id}")
            labels[sample_id] = row
    missing = set(template) - set(labels)
    if missing:
        raise ValueError(f"Gold parts are missing {len(missing)} samples")
    merged = []
    label_fields = (
        "classification",
        "canonicalSpeaker",
        "acceptedAliases",
        "speakerInferable",
        "evidence",
        "confidence",
    )
    for base in template_rows:
        label = labels[str(base["sampleId"])]
        merged.append({**base, **{field: label[field] for field in label_fields}})
    _append_jsonl(output / "gold.merged.jsonl", [])
    merged_path = output / "gold.merged.jsonl"
    merged_path.unlink(missing_ok=True)
    _append_jsonl(merged_path, merged)
    merged_path.replace(output / "gold.jsonl")
    return merged


def _normal(value: Any) -> str:
    return " ".join(str(value or "").split()).casefold()


def score_variant(output: Path, variant: str) -> dict[str, Any]:
    gold = {str(row["sampleId"]): row for row in _jsonl(output / "gold.jsonl")}
    incomplete = [sample_id for sample_id, row in gold.items() if row.get("classification") is None]
    if incomplete:
        raise RuntimeError(f"Gold is incomplete for {len(incomplete)} samples")
    results = {str(row["sampleId"]): row for row in _jsonl(output / "runs" / f"{variant}.jsonl")}
    if set(results) != set(gold):
        raise RuntimeError(f"Run coverage mismatch: gold={len(gold)} run={len(results)}")
    by_book: dict[str, dict[str, int]] = {}
    totals = {
        "samples": 0,
        "classificationCorrect": 0,
        "proseSamples": 0,
        "dialogueSamples": 0,
        "inferableSpeakerSamples": 0,
        "inferableSpeakerCorrect": 0,
        "unresolvedDialogueSamples": 0,
        "unresolvedCorrect": 0,
        "speakerCorrect": 0,
        "fullyUsable": 0,
        "parseValid": 0,
        "validatorAccepted": 0,
    }
    for sample_id, expected in gold.items():
        result = results[sample_id]
        book = str(expected["bookId"])
        bucket = by_book.setdefault(book, {key: 0 for key in totals})
        prediction = result.get("prediction")
        predicted_class = "prose" if prediction == "/" else "dialogue"
        classification_correct = prediction is not None and predicted_class == expected["classification"]
        speaker_correct = False
        inferable_correct = False
        unresolved_correct = False
        if expected["classification"] == "dialogue":
            if expected.get("speakerInferable"):
                accepted = {
                    _normal(expected.get("canonicalSpeaker")),
                    *(_normal(value) for value in expected.get("acceptedAliases", [])),
                }
                inferable_correct = _normal(prediction) in accepted
                speaker_correct = inferable_correct
            else:
                unresolved_correct = prediction == "?"
                speaker_correct = unresolved_correct
        fully_usable = classification_correct and (
            expected["classification"] == "prose" or speaker_correct
        )
        increments = {
            "samples": 1,
            "classificationCorrect": int(classification_correct),
            "proseSamples": int(expected["classification"] == "prose"),
            "dialogueSamples": int(expected["classification"] == "dialogue"),
            "inferableSpeakerSamples": int(
                expected["classification"] == "dialogue" and expected.get("speakerInferable")
            ),
            "inferableSpeakerCorrect": int(inferable_correct),
            "unresolvedDialogueSamples": int(
                expected["classification"] == "dialogue" and not expected.get("speakerInferable")
            ),
            "unresolvedCorrect": int(unresolved_correct),
            "speakerCorrect": int(speaker_correct),
            "fullyUsable": int(fully_usable),
            "parseValid": int(not result.get("parseError")),
            "validatorAccepted": int(result.get("validatorAccepted") is True),
        }
        for key, value in increments.items():
            totals[key] += value
            bucket[key] += value
    calls = {row["callId"]: row for row in results.values()}
    latencies = sorted(int(row["latencyMs"]) for row in calls.values())
    usage = {
        "promptTokens": sum(int(row.get("usage", {}).get("prompt_tokens", 0)) for row in calls.values()),
        "completionTokens": sum(
            int(row.get("usage", {}).get("completion_tokens", 0)) for row in calls.values()
        ),
    }

    def ratios(bucket: Mapping[str, int]) -> dict[str, Any]:
        return {
            **dict(bucket),
            "classificationAccuracy": bucket["classificationCorrect"] / max(1, bucket["samples"]),
            "dialogueDecisionAccuracy": bucket["speakerCorrect"] / max(1, bucket["dialogueSamples"]),
            "speakerAccuracy": bucket["inferableSpeakerCorrect"]
            / max(1, bucket["inferableSpeakerSamples"]),
            "unresolvedAccuracy": bucket["unresolvedCorrect"]
            / max(1, bucket["unresolvedDialogueSamples"]),
            "fullyUsableRate": bucket["fullyUsable"] / max(1, bucket["samples"]),
        }

    book_ratios = {book: ratios(bucket) for book, bucket in sorted(by_book.items())}
    macro_fields = (
        "classificationAccuracy",
        "dialogueDecisionAccuracy",
        "speakerAccuracy",
        "unresolvedAccuracy",
        "fullyUsableRate",
    )
    return {
        "variant": variant,
        "overall": ratios(totals),
        "macro": {
            field: sum(float(bucket[field]) for bucket in book_ratios.values())
            / max(1, len(book_ratios))
            for field in macro_fields
        },
        "byBook": book_ratios,
        "physicalCalls": len(calls),
        "callsPerTarget": len(calls) / max(1, len(results)),
        "usage": usage,
        "latencyMs": {
            "p50": latencies[len(latencies) // 2] if latencies else 0,
            "p95": latencies[min(len(latencies) - 1, math.floor(len(latencies) * 0.95))]
            if latencies
            else 0,
            "total": sum(latencies),
        },
    }


def score(output: Path, variants: Sequence[str]) -> None:
    scores = [score_variant(output, variant) for variant in variants]
    _json_dump(output / "scores.json", scores)
    print(json.dumps(scores, indent=2))


def _parse_books(values: Sequence[str]) -> dict[str, Path]:
    if not values:
        return dict(DEFAULT_BOOKS)
    books = {}
    for value in values:
        if "=" not in value:
            raise ValueError("Books must use NAME=PATH")
        name, path = value.split("=", 1)
        books[name] = Path(path)
    return books


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--book", action="append", default=[])
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--variant", choices=sorted(VARIANTS), required=True)
    merge_parser = subparsers.add_parser("merge-gold")
    merge_parser.add_argument("--part", action="append", type=Path, required=True)
    score_parser = subparsers.add_parser("score")
    score_parser.add_argument("--variant", action="append", choices=sorted(VARIANTS), default=[])
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    output = args.output if args.output.is_absolute() else repo_root / args.output
    if args.command == "prepare":
        prepare(repo_root, output, _parse_books(args.book))
    elif args.command == "run":
        run_variant(repo_root, output, args.variant)
    elif args.command == "merge-gold":
        parts = [part if part.is_absolute() else repo_root / part for part in args.part]
        merged = merge_gold_parts(output, parts)
        print(f"Merged {len(merged)} blinded gold labels into {output / 'gold.jsonl'}")
    else:
        score(output, args.variant or sorted(VARIANTS))


if __name__ == "__main__":
    main()
