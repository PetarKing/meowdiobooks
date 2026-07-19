#!/usr/bin/env python3
"""Run a read-only hosted Cast reconciliation benchmark from an exported spans JSON file."""

from __future__ import annotations

import argparse
from collections.abc import Mapping, Sequence
from decimal import Decimal
import json
from pathlib import Path
import sys
from typing import Any

from meowdiobooks.backend.cast import label_comparison_key
from meowdiobooks.backend.remote_llm import remote_usage_cost


EXPECTED_PAIRS = (
    ("Ceci", "Cecilus"),
    ("Berstetz", "Berstetz Fondalfon"),
    ("Goz", "Goz Ralfon"),
    ("Frederica", "Frederica Baumann"),
    ("Gudda", "Gudda Dialmo"),
    ("Madelyn", "Madelyn Eschart"),
    ("Flop", "Flop O’Connell"),
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--turns-json",
        required=True,
        help="Spans JSON path, or '-' to read a private artifact from standard input.",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        required=True,
        help="Cloud repository root containing models.toml and the configured Luna API key.",
    )
    parser.add_argument("--output", type=Path, help="Optional path for the compact benchmark JSON.")
    args = parser.parse_args()

    turns = _load_turns(args.turns_json)
    events: list[dict[str, Any]] = []

    def observe(config, event: Mapping[str, Any]) -> None:
        usage = event.get("usage") if isinstance(event.get("usage"), Mapping) else {}
        events.append(
            {
                "model": str(event.get("model") or config.model),
                "outcome": str(event.get("outcome") or "unknown"),
                "ambiguousBillable": bool(event.get("ambiguousBillable", False)),
                "inputTokens": int(
                    usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0
                ),
                "cachedInputTokens": _cached_tokens(usage),
                "outputTokens": int(
                    usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0
                ),
                "estimatedCostUsd": str(Decimal(str(remote_usage_cost(config, usage)))),
            }
        )

    try:
        from meowdiobooks_cloud.luna import propose_cast_with_luna
    except ImportError as error:  # pragma: no cover - operational guidance
        raise SystemExit(
            "Hosted Luna adapter is unavailable. Run from the Cloud environment with both "
            "repositories' src directories on PYTHONPATH."
        ) from error

    result = propose_cast_with_luna(
        args.repo_root.resolve(),
        turns,
        usage_observer=observe,
    )
    summary = _summarize(result, events)
    rendered = json.dumps(summary, indent=2, ensure_ascii=False, sort_keys=True)
    print(rendered)
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0


def _load_turns(path: str) -> list[Mapping[str, Any]]:
    raw = json.loads(
        sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    )
    candidates: object = raw
    if isinstance(raw, Mapping):
        candidates = raw.get("spans")
        if candidates is None and isinstance(raw.get("payload"), Mapping):
            candidates = raw["payload"].get("spans")
        if candidates is None and isinstance(raw.get("artifact"), Mapping):
            artifact = raw["artifact"]
            candidates = artifact.get("spans")
            if candidates is None and isinstance(artifact.get("payload"), Mapping):
                candidates = artifact["payload"].get("spans")
    if not isinstance(candidates, list) or not all(
        isinstance(row, Mapping) for row in candidates
    ):
        raise SystemExit(
            "Input must be a JSON spans array or an object with spans/payload.spans/"
            "artifact.payload.spans."
        )
    return candidates


def _cached_tokens(usage: Mapping[str, Any]) -> int:
    details = usage.get("prompt_tokens_details", usage.get("input_tokens_details"))
    return int(details.get("cached_tokens", 0) or 0) if isinstance(details, Mapping) else 0


def _summarize(
    result: Mapping[str, Any], events: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    proposals = [row for row in result.get("proposals", []) if isinstance(row, Mapping)]
    candidates = [
        row for row in result.get("fuzzyCandidates", []) if isinstance(row, Mapping)
    ]
    by_label = {_benchmark_label_key(row.get("label")): row for row in proposals}
    candidate_by_pair = {
        frozenset(
            (
                _benchmark_label_key(row.get("leftLabel")),
                _benchmark_label_key(row.get("rightLabel")),
            )
        ): row
        for row in candidates
    }
    expected = []
    for left, right in EXPECTED_PAIRS:
        left_row = by_label.get(_benchmark_label_key(left))
        right_row = by_label.get(_benchmark_label_key(right))
        candidate = candidate_by_pair.get(
            frozenset((_benchmark_label_key(left), _benchmark_label_key(right)))
        )
        grouped = bool(
            left_row
            and right_row
            and left_row.get("canonicalName") == right_row.get("canonicalName")
        )
        expected.append(
            {
                "leftLabel": left,
                "rightLabel": right,
                "nominated": candidate is not None,
                "relationship": candidate.get("relationship") if candidate else None,
                "grouped": grouped,
                "mandatoryReview": bool(
                    grouped
                    and left_row.get("reviewRequired")
                    and right_row.get("reviewRequired")
                ),
            }
        )
    successful = [row for row in events if row.get("outcome") == "response"]
    relationship_counts = {
        relationship: sum(row.get("relationship") == relationship for row in candidates)
        for relationship in ("same", "possible", "different")
    }
    grouped_labels: dict[str, list[str]] = {}
    for row in proposals:
        canonical = str(row.get("canonicalName") or row.get("label"))
        grouped_labels.setdefault(canonical, []).append(str(row.get("label")))
    return {
        "labels": len(proposals),
        "processing": result.get("processing", {}),
        "candidates": {
            "nominatedAndAdjudicated": len(candidates),
            "relationships": relationship_counts,
            "automaticMerges": sum(bool(row.get("automaticMerge")) for row in candidates),
        },
        "proposedGroups": [
            {"canonicalName": canonical, "labels": sorted(labels)}
            for canonical, labels in sorted(grouped_labels.items())
            if len(labels) > 1
        ],
        "adjudications": [
            {
                "leftLabel": row.get("leftLabel"),
                "rightLabel": row.get("rightLabel"),
                "relationship": row.get("relationship"),
                "automaticMerge": row.get("automaticMerge"),
            }
            for row in candidates
        ],
        "knownMissedPairs": expected,
        "usage": {
            "providerEvents": len(events),
            "successfulRequests": len(successful),
            "inputTokens": sum(int(row.get("inputTokens", 0)) for row in events),
            "cachedInputTokens": sum(int(row.get("cachedInputTokens", 0)) for row in events),
            "outputTokens": sum(int(row.get("outputTokens", 0)) for row in events),
            "estimatedCostUsd": str(
                sum(Decimal(str(row.get("estimatedCostUsd", "0"))) for row in events)
            ),
            "costCompleteness": (
                "unknown"
                if any(row.get("ambiguousBillable") for row in events)
                else "complete"
            ),
        },
    }


def _benchmark_label_key(value: object) -> str:
    """Compare expected report labels across straight/curly source punctuation."""

    return label_comparison_key(value).translate(str.maketrans({"’": "'", "‘": "'"}))


if __name__ == "__main__":
    raise SystemExit(main())
