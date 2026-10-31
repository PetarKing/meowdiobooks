"""Run the conservative full-source Dialogue attribution consensus experiment.

The production-shaped policy is intentionally selective:

1. Run the current ``v0-control`` prompt for every AI-owned Dialogue target.
2. Only when v0 proposes a Character name, run the independent
   ``v2-conversation`` verifier on the identical frozen dossier.
3. Keep a Character only when both parsed answers match and both pass the
   existing evidence validator. Otherwise, withhold the Character as ``?``.

Outputs are ignored, append-only JSONL so a long local run can resume safely.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from meowdiobooks.backend.dialogue import scan_dialogue
from meowdiobooks.backend.local_llm import qwen_server
from scripts.dialogue_attribution_experiment import (
    DEFAULT_BOOKS,
    OPEN_SPEAKER_PATTERNS,
    _accepted_extraction,
    _append_jsonl,
    _json_dump,
    _jsonl,
    _single_rows,
    _source_hash,
    _target_spans,
    experiment_dossier,
)

SCHEMA_VERSION = 1
DEFAULT_OUTPUT = Path("tmp/dialogue-attribution-full-consensus")
DEFAULT_EXTRACTION_CACHE = Path("tmp/dialogue-attribution-experiment")
BASE_VARIANT = "v0-control"
VERIFIER_VARIANT = "v2-conversation"
SYMBOLS = {"?", "/"}


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _cached_extraction(cache: Path, book_id: str) -> Path:
    return cache / "cache" / book_id / "extraction" / "liteparse" / "full.json"


def _load_pages(repo_root: Path, cache: Path, book_id: str, source: Path) -> tuple[list[dict[str, Any]], Path]:
    cached = _cached_extraction(cache, book_id)
    if cached.is_file():
        payload = json.loads(cached.read_text(encoding="utf-8"))
        return [dict(page) for page in payload["pages"]], cached
    accepted = _accepted_extraction(repo_root, source)
    if accepted is None:
        raise FileNotFoundError(
            f"No frozen extraction for {book_id}; expected {cached} or an accepted package artifact"
        )
    book_key = f"book_{_source_hash(source)[:20]}"
    latest = repo_root / ".meowdiobooks" / "packages" / book_key / "artifacts" / "latest.json"
    pointer = json.loads(latest.read_text(encoding="utf-8"))["extraction"]
    artifact = Path(str(pointer))
    if not artifact.is_absolute():
        artifact = repo_root / artifact
    return accepted, artifact


def prepare_full(
    repo_root: Path,
    output: Path,
    extraction_cache: Path,
    books: Mapping[str, Path],
) -> dict[str, Any]:
    windows: list[dict[str, Any]] = []
    manifest_books: list[dict[str, Any]] = []
    total_targets = 0
    for book_id, relative_source in books.items():
        source = relative_source if relative_source.is_absolute() else repo_root / relative_source
        if not source.is_file():
            raise FileNotFoundError(source)
        pages, extraction = _load_pages(repo_root, extraction_cache, book_id, source)
        scan = scan_dialogue(pages, open_speaker_patterns=OPEN_SPEAKER_PATTERNS)
        page_numbers = {int(page["page"]) for page in pages}
        targets = _target_spans(scan, page_numbers)
        target_ids = [str(target["id"]) for target in targets]
        # Freeze dossiers once so base and verifier consume byte-identical user prompts.
        dossiers = {
            owner_id: experiment_dossier(scan["partition"], owner_id, 1, 700)
            for owner_id in target_ids
        }
        windows.append(
            {
                "id": f"{book_id}-full",
                "bookId": book_id,
                "partition": scan["partition"],
                "targetIds": target_ids,
                "dossiers": dossiers,
            }
        )
        logical_dialogue = {
            str(span.get("turnGroupId") or span["id"]): span
            for span in scan["partition"]
            if span.get("renderRole") == "dialogue"
        }
        statuses: dict[str, int] = {}
        for span in logical_dialogue.values():
            status = str(span.get("speakerStatus"))
            statuses[status] = statuses.get(status, 0) + 1
        total_targets += len(target_ids)
        manifest_books.append(
            {
                "id": book_id,
                "source": str(relative_source),
                "sourceHash": _source_hash(source),
                "pageCount": len(pages),
                "extraction": str(extraction.relative_to(repo_root) if extraction.is_relative_to(repo_root) else extraction),
                "extractionHash": _file_hash(extraction),
                "logicalDialogueTurns": len(logical_dialogue),
                "dialogueStatuses": statuses,
                "targetCount": len(target_ids),
                "availableSourceScope": "public-domain evaluation excerpt",
            }
        )
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "policy": {
            "base": BASE_VARIANT,
            "verifier": VERIFIER_VARIANT,
            "verifierTrigger": "parsed base Character proposal only",
            "acceptCharacter": "normalized exact agreement and both evidence validators pass",
            "disagreement": "?",
            "dossier": {"contextUnits": 1, "contextCharacters": 700},
        },
        "books": manifest_books,
        "targetCount": total_targets,
    }
    _json_dump(output / "full-manifest.json", manifest)
    _json_dump(output / "full-corpus.json", {"schemaVersion": SCHEMA_VERSION, "windows": windows})
    print(json.dumps(manifest, indent=2), flush=True)
    return manifest


def _windows(output: Path) -> list[dict[str, Any]]:
    return list(json.loads((output / "full-corpus.json").read_text(encoding="utf-8"))["windows"])


def _run_stage(
    base: str,
    output: Path,
    windows: Sequence[Mapping[str, Any]],
    variant: str,
    allowed: set[str] | None = None,
) -> None:
    run_path = output / "runs" / f"{variant}.jsonl"
    completed = {str(row["sampleId"]) for row in _jsonl(run_path)}
    expected_ids = {
        f"{window['bookId']}:{owner}"
        for window in windows
        for owner in window["targetIds"]
        if allowed is None or f"{window['bookId']}:{owner}" in allowed
    }
    expected = len(expected_ids)
    if completed & expected_ids:
        print(f"[{variant}] resuming at {len(completed & expected_ids)}/{expected}", flush=True)
    for window in windows:
        selected = [
            str(owner)
            for owner in window["targetIds"]
            if allowed is None or f"{window['bookId']}:{owner}" in allowed
        ]
        filtered = {**dict(window), "targetIds": selected}
        for row in _single_rows(base, variant, filtered, completed):
            _append_jsonl(run_path, [row])
            completed.add(str(row["sampleId"]))
            done = len(completed & expected_ids)
            if done % 25 == 0 or done == expected:
                print(f"[{variant}] {done}/{expected}", flush=True)


def _is_character(value: Any) -> bool:
    return value is not None and str(value).strip() not in SYMBOLS


def _normal(value: Any) -> str:
    return " ".join(str(value or "").split()).casefold()


def consensus_prediction(base: Mapping[str, Any], verifier: Mapping[str, Any] | None) -> str | None:
    prediction = base.get("prediction")
    if not _is_character(prediction):
        return None if prediction is None else str(prediction)
    if verifier is None:
        return None
    verified = verifier.get("prediction")
    if (
        _is_character(verified)
        and _normal(prediction) == _normal(verified)
        and base.get("validatorAccepted") is True
        and verifier.get("validatorAccepted") is True
    ):
        return str(prediction)
    return "?"


def summarize(output: Path) -> dict[str, Any]:
    windows = _windows(output)
    expected = {
        f"{window['bookId']}:{owner}"
        for window in windows
        for owner in window["targetIds"]
    }
    base_rows = {str(row["sampleId"]): row for row in _jsonl(output / "runs" / f"{BASE_VARIANT}.jsonl")}
    verifier_rows = {
        str(row["sampleId"]): row
        for row in _jsonl(output / "runs" / f"{VERIFIER_VARIANT}.jsonl")
    }
    if set(base_rows) != expected:
        raise RuntimeError(f"Base coverage mismatch: expected={len(expected)} actual={len(base_rows)}")
    requested_verifiers = {sample_id for sample_id, row in base_rows.items() if _is_character(row.get("prediction"))}
    if set(verifier_rows) != requested_verifiers:
        raise RuntimeError(
            f"Verifier coverage mismatch: expected={len(requested_verifiers)} actual={len(verifier_rows)}"
        )
    decisions = []
    by_book: dict[str, dict[str, Any]] = {}
    for sample_id in sorted(expected):
        base_row = base_rows[sample_id]
        verifier_row = verifier_rows.get(sample_id)
        final = consensus_prediction(base_row, verifier_row)
        book = str(base_row["bookId"])
        bucket = by_book.setdefault(
            book,
            {
                "targets": 0,
                "baseCharacterProposals": 0,
                "acceptedCharacters": 0,
                "withheldCharacterProposals": 0,
                "baseParseFailures": 0,
                "verifierParseFailures": 0,
                "baseLatencyMs": 0,
                "addedVerifierLatencyMs": 0,
                "basePromptTokens": 0,
                "baseCompletionTokens": 0,
                "verifierPromptTokens": 0,
                "verifierCompletionTokens": 0,
            },
        )
        bucket["targets"] += 1
        bucket["baseLatencyMs"] += int(base_row.get("latencyMs", 0))
        bucket["baseParseFailures"] += int(bool(base_row.get("parseError")))
        base_usage = base_row.get("usage", {})
        bucket["basePromptTokens"] += int(base_usage.get("prompt_tokens", 0))
        bucket["baseCompletionTokens"] += int(base_usage.get("completion_tokens", 0))
        if _is_character(base_row.get("prediction")):
            bucket["baseCharacterProposals"] += 1
            bucket["addedVerifierLatencyMs"] += int(verifier_row.get("latencyMs", 0))
            bucket["verifierParseFailures"] += int(bool(verifier_row.get("parseError")))
            verifier_usage = verifier_row.get("usage", {})
            bucket["verifierPromptTokens"] += int(verifier_usage.get("prompt_tokens", 0))
            bucket["verifierCompletionTokens"] += int(verifier_usage.get("completion_tokens", 0))
            if _is_character(final):
                bucket["acceptedCharacters"] += 1
            else:
                bucket["withheldCharacterProposals"] += 1
        decisions.append(
            {
                "sampleId": sample_id,
                "bookId": book,
                "base": base_row.get("prediction"),
                "verifier": verifier_row.get("prediction") if verifier_row else None,
                "final": final,
            }
        )
    totals: dict[str, int] = {}
    for bucket in by_book.values():
        for key, value in bucket.items():
            totals[key] = totals.get(key, 0) + int(value)
    summary = {
        "schemaVersion": SCHEMA_VERSION,
        "policy": "selective exact-agreement Character verification",
        "byBook": by_book,
        "total": totals,
    }
    _json_dump(output / "full-decisions.json", {"schemaVersion": SCHEMA_VERSION, "decisions": decisions})
    _json_dump(output / "full-summary.json", summary)
    print(json.dumps(summary, indent=2), flush=True)
    return summary


def score_dorian_audit(repo_root: Path, output: Path) -> dict[str, Any]:
    """Score new Character claims against the completed 938-row Dorian audit."""

    review_path = repo_root / "tmp/dialogue-ai-review/dorian-gray.json"
    review = json.loads(review_path.read_text(encoding="utf-8"))
    grades: dict[str, dict[str, str]] = {}
    for path in sorted((repo_root / "tmp/dialogue-ai-review").glob("dorian-grades-*.tsv")):
        with path.open(encoding="utf-8", newline="") as stream:
            for row in csv.DictReader(stream, delimiter="\t"):
                grades[str(row["sampleId"])] = dict(row)
    if len(grades) != 938 or len(review["samples"]) != 938:
        raise RuntimeError(
            f"Dorian audit coverage mismatch: grades={len(grades)} review={len(review['samples'])}"
        )
    base_rows = {
        str(row["sampleId"]): row
        for row in _jsonl(output / "runs" / f"{BASE_VARIANT}.jsonl")
        if row["bookId"] == "dorian"
    }
    verifier_rows = {
        str(row["sampleId"]): row
        for row in _jsonl(output / "runs" / f"{VERIFIER_VARIANT}.jsonl")
        if row["bookId"] == "dorian"
    }
    if len(base_rows) != 938:
        raise RuntimeError(f"Dorian base coverage mismatch: {len(base_rows)}")
    counts = {
        "auditedTargets": 938,
        "baseCharacterAssignments": 0,
        "baseCorrectCharacterAssignments": 0,
        "baseFalseCharacterAssignments": 0,
        "consensusCharacterAssignments": 0,
        "consensusCorrectCharacterAssignments": 0,
        "consensusFalseCharacterAssignments": 0,
        "withheldBaseCharacterAssignments": 0,
        "baseReplayMismatches": 0,
    }
    for sample in review["samples"]:
        review_id = str(sample["sampleId"])
        sample_id = f"dorian:{sample['spanId']}"
        base = base_rows[sample_id]
        old_result = sample["aiResult"]
        old_prediction = (
            "/" if old_result.get("classification") == "not-dialogue" else old_result.get("speaker")
        )
        if _normal(base.get("prediction")) != _normal(old_prediction):
            counts["baseReplayMismatches"] += 1
        grade = grades[review_id]
        base_character = _is_character(base.get("prediction"))
        final = consensus_prediction(base, verifier_rows.get(sample_id))
        final_character = _is_character(final)
        if base_character:
            counts["baseCharacterAssignments"] += 1
            correct = grade["speakerGrade"] == "correct"
            counts["baseCorrectCharacterAssignments"] += int(correct)
            counts["baseFalseCharacterAssignments"] += int(not correct)
        if final_character:
            counts["consensusCharacterAssignments"] += 1
            correct = grade["speakerGrade"] == "correct"
            counts["consensusCorrectCharacterAssignments"] += int(correct)
            counts["consensusFalseCharacterAssignments"] += int(not correct)
        if base_character and not final_character:
            counts["withheldBaseCharacterAssignments"] += 1
    if counts["baseReplayMismatches"]:
        raise RuntimeError(
            "The new Dorian base run differs from the audited production run; grades cannot be reused"
        )
    result = {
        **counts,
        "baseCharacterPrecision": counts["baseCorrectCharacterAssignments"]
        / max(1, counts["baseCharacterAssignments"]),
        "baseFalseCharacterRate": counts["baseFalseCharacterAssignments"]
        / max(1, counts["baseCharacterAssignments"]),
        "consensusCharacterPrecision": counts["consensusCorrectCharacterAssignments"]
        / max(1, counts["consensusCharacterAssignments"]),
        "consensusFalseCharacterRate": counts["consensusFalseCharacterAssignments"]
        / max(1, counts["consensusCharacterAssignments"]),
    }
    _json_dump(output / "dorian-audit-score.json", result)
    print(json.dumps(result, indent=2), flush=True)
    return result


def run_consensus(repo_root: Path, output: Path) -> None:
    windows = _windows(output)
    with qwen_server(repo_root) as base:
        _run_stage(base, output, windows, BASE_VARIANT)
        base_rows = {
            str(row["sampleId"]): row
            for row in _jsonl(output / "runs" / f"{BASE_VARIANT}.jsonl")
        }
        character_proposals = {
            sample_id for sample_id, row in base_rows.items() if _is_character(row.get("prediction"))
        }
        print(
            f"[{VERIFIER_VARIANT}] selectively checking {len(character_proposals)} base Character proposals",
            flush=True,
        )
        _run_stage(base, output, windows, VERIFIER_VARIANT, character_proposals)
    summarize(output)


def _parse_books(values: Sequence[str]) -> dict[str, Path]:
    if not values:
        return dict(DEFAULT_BOOKS)
    result: dict[str, Path] = {}
    for value in values:
        if "=" not in value:
            raise ValueError("Books must use NAME=PATH")
        name, path = value.split("=", 1)
        result[name] = Path(path)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--book", action="append", default=[])
    prepare_parser.add_argument("--extraction-cache", type=Path, default=DEFAULT_EXTRACTION_CACHE)
    subparsers.add_parser("run")
    subparsers.add_parser("summarize")
    subparsers.add_parser("score-dorian-audit")
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    output = args.output if args.output.is_absolute() else repo_root / args.output
    if args.command == "prepare":
        cache = args.extraction_cache
        if not cache.is_absolute():
            cache = repo_root / cache
        prepare_full(repo_root, output, cache, _parse_books(args.book))
    elif args.command == "run":
        run_consensus(repo_root, output)
    elif args.command == "summarize":
        summarize(output)
    else:
        score_dorian_audit(repo_root, output)


if __name__ == "__main__":
    main()
