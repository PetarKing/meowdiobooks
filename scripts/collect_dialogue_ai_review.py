"""Build an ignored, reviewable corpus from one Dialogue candidate artifact."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    artifact = json.loads(args.artifact.read_text())
    spans = {str(span["id"]): span for span in artifact.get("spans", [])}
    samples = []
    for window in artifact.get("aiWindows", []):
        dossier = window["dossiers"][0]
        span_id = str(window["ownerIds"][0])
        outcome = spans.get(span_id)
        samples.append(
            {
                "sampleId": window["id"],
                "spanId": span_id,
                "page": dossier.get("page"),
                "contextBefore": dossier.get("before", ""),
                "target": dossier.get("target", ""),
                "contextAfter": dossier.get("after", ""),
                "aiResult": {
                    "classification": "not-dialogue" if outcome is None else "dialogue",
                    "speaker": None if outcome is None else outcome.get("resolvedSpeakerLabel"),
                    "speakerStatus": None if outcome is None else outcome.get("speakerStatus"),
                    "origin": "qwen:not-vocalisation" if outcome is None else outcome.get("origin"),
                },
                "humanAnchor": (
                    {
                        "grade": "incorrect",
                        "expectedSpeaker": "Subaru",
                        "reason": 'The preceding narration explicitly says "Subaru asked".',
                    }
                    if dossier.get("target") == '"Here is?"'
                    else None
                ),
            }
        )

    payload = {
        "sourceArtifact": str(args.artifact),
        "revision": artifact.get("revision"),
        "summary": artifact.get("resultSummary", artifact.get("summary", {})),
        "sampleCount": len(samples),
        "samples": samples,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
