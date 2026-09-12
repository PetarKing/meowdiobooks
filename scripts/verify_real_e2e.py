"""Manual fresh-book verification through the production v2 API.

This deliberately makes conservative test decisions (keep non-blocking Review
evidence, accept explicit chapter headings, accept current identity proposals and
voice auditions). It is an operator smoke tool, not a product auto-accept path.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from meowdiobooks.backend.app import create_app


def _wait(client: TestClient, job_id: str, timeout: float = 7_200) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    previous = None
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        marker = (job["status"], round(float(job["progress"])), job.get("message"))
        if marker != previous:
            print(f"  {marker[0]} {marker[1]}% {marker[2] or ''}", flush=True)
            previous = marker
        if job["status"] in {"succeeded", "failed", "canceled"}:
            if job["status"] != "succeeded":
                raise RuntimeError(job.get("error") or f"Job {job_id} {job['status']}")
            return dict(job["result"])
        time.sleep(0.5)
    raise TimeoutError(f"Job {job_id} did not finish in {timeout} seconds")


def _process(
    client: TestClient, book_id: str, stage: str, settings: dict[str, Any]
) -> dict[str, Any]:
    print(f"{stage}: process", flush=True)
    response = client.post(
        f"/api/books/{book_id}/stages/{stage}/process", json={"settings": settings}
    )
    response.raise_for_status()
    return _wait(client, response.json()["id"])


def _candidate(
    client: TestClient, book_id: str, stage: str, result: dict[str, Any]
) -> dict[str, Any]:
    response = client.get(f"/api/books/{book_id}/stages/{stage}/candidates/{result['revision']}")
    response.raise_for_status()
    return dict(response.json())


def _accept(
    client: TestClient,
    book_id: str,
    stage: str,
    revision: str,
    decisions: list[dict[str, Any]] | None = None,
) -> None:
    print(f"{stage}: accept", flush=True)
    response = client.post(
        f"/api/books/{book_id}/stages/{stage}/accept",
        json={"revision": revision, "decisions": decisions or []},
    )
    if response.status_code != 200:
        raise RuntimeError(f"Could not accept {stage}: {response.status_code} {response.text}")


def _review_decisions(candidate: dict[str, Any]) -> list[dict[str, Any]]:
    decisions: list[dict[str, Any]] = []
    for warning in candidate.get("warnings", []):
        for occurrence in warning.get("occurrences", []):
            actions = list(occurrence.get("availableActions", []))
            action = next(
                (value for value in ("keep", "narrate", "exclude") if value in actions),
                None,
            )
            if action is None:
                raise RuntimeError(
                    f"Real-book smoke found a blocking Review occurrence: {occurrence}"
                )
            decisions.append(
                {
                    "occurrenceIds": [occurrence["id"]],
                    "action": action,
                    "provenance": "manual-real-book-smoke",
                }
            )
    decisions.extend(
        {
            "boundaryId": row["id"],
            "action": "chapter-start",
        }
        for row in candidate.get("boundaryCandidates", [])
    )
    return decisions


def verify_book(
    client: TestClient, name: str, source: Path, *, generate_audio: bool
) -> dict[str, Any]:
    print(f"\n=== {name}: {source} ===", flush=True)
    with source.open("rb") as stream:
        imported = client.post(
            "/api/books/import",
            files={"file": (source.name, stream, "application/pdf")},
        )
    imported.raise_for_status()
    book_id = str(imported.json()["book"]["id"])

    extraction = _process(client, book_id, "extract", {"method": "liteparse"})
    _accept(client, book_id, "extract", extraction["revision"])
    dialogue = _process(
        client,
        book_id,
        "dialogue",
        {
            "strategy": "fill-gaps",
            "openSpeakerLabels": ["???", "Unknown", "Unidentified Voice"],
        },
    )
    dialogue_candidate = _candidate(client, book_id, "dialogue", dialogue)
    _accept(client, book_id, "dialogue", dialogue["revision"])

    review = _process(client, book_id, "review", {})
    review_candidate = _candidate(client, book_id, "review", review)
    _accept(
        client,
        book_id,
        "review",
        review["revision"],
        _review_decisions(review_candidate),
    )

    cast_proposal = _process(client, book_id, "cast", {})
    proposal = _candidate(client, book_id, "cast", cast_proposal)
    identity_decisions = [
        {
            "label": row["label"],
            "category": row["category"],
            "canonicalName": row.get("canonicalName"),
            "aliases": row.get("aliases", []),
        }
        for row in proposal.get("proposals", [])
        if row.get("reviewRequired")
    ]
    cast_auditions = _process(
        client,
        book_id,
        "cast",
        {
            "proposalRevision": cast_proposal["revision"],
            "identityDecisions": identity_decisions,
            "language": "english",
        },
    )
    auditions = _candidate(client, book_id, "cast", cast_auditions)
    voice_decisions = [
        {
            "characterId": row["characterId"],
            "voiceRevision": row["voicePreviewRevision"],
        }
        for row in [auditions["narrator"], *auditions.get("identities", [])]
    ]
    _accept(client, book_id, "cast", cast_auditions["revision"], voice_decisions)

    snapshot = client.get(f"/api/books/{book_id}/snapshot").json()
    chapters = list(snapshot["chapters"])
    selected = min(chapters, key=lambda row: int(row.get("estimatedCharacters", 0)))
    generation = None
    if generate_audio:
        generation = _process(
            client,
            book_id,
            "generate",
            {"chapterIds": [selected["id"]], "language": "english"},
        )
        snapshot = client.get(f"/api/books/{book_id}/snapshot").json()

    summary = {
        "name": name,
        "bookId": book_id,
        "dialogue": dialogue_candidate.get("resultSummary"),
        "reviewWarnings": review_candidate.get("summary"),
        "castIdentities": len(auditions.get("identities", [])),
        "selectedChapter": selected,
        "generation": generation,
        "generatedChapters": snapshot.get("generatedChapters", []),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--book", action="append", nargs=2, metavar=("NAME", "PDF"), required=True)
    parser.add_argument("--generate-audio", action="store_true")
    parser.add_argument("--summary", type=Path)
    args = parser.parse_args()
    if args.data.exists() and any(args.data.iterdir()):
        raise SystemExit(f"Fresh data directory required: {args.data}")
    args.data.mkdir(parents=True, exist_ok=True)
    with TestClient(create_app(args.data)) as client:
        results = [
            verify_book(client, name, Path(path), generate_audio=args.generate_audio)
            for name, path in args.book
        ]
    if args.summary:
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        args.summary.write_text(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
