"""Real API/renderer/export probe with explicitly synthetic provider audio."""

import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import numpy as np
from fastapi.testclient import TestClient
from reportlab.pdfgen.canvas import Canvas
from scipy.io import wavfile

from meowdiobooks.backend.app_v2 import create_app_v2
from meowdiobooks.backend.artifacts import read_artifact
from meowdiobooks.backend.cast import build_label_dossiers
from meowdiobooks.backend.voice_candidates import VoiceCandidatePolicy

ROOT = Path(__file__).resolve().parents[5]
STATE = Path("/private/tmp/meow-audit08-api-state-v4")
EVIDENCE = Path(__file__).resolve().parent
FAIL_SECOND = False


def tone(*_args):
    if FAIL_SECOND and "second chapter keeps" in str(_args[1]):
        raise RuntimeError("Intentional offline second-chapter failure")
    time_axis = np.arange(2400, dtype=np.float32) / 24000
    return (0.1 * np.sin(2 * np.pi * 440 * time_axis)).astype(np.float32)


def auditions(_repo, package, book_id, characters, report, _language, _model):
    results = []
    for character in characters:
        row = dict(character)
        revision = uuid4().hex
        audio = package / "voices" / row["id"] / f"{revision}.wav"
        audio.parent.mkdir(parents=True, exist_ok=True)
        wavfile.write(audio, 24000, tone())
        url = f"/api/books/{book_id}/voices/{row['id']}/{revision}/audio"
        candidate = {"revision": revision, "previewUrl": url,
                     "referenceText": row["previewLine"], "direction": row["voiceDirection"]}
        row.update(voicePreviewRevision=revision, previewUrl=url,
                   referenceText=row["previewLine"], voiceCandidates=[candidate])
        results.append(row)
    report(100, "Synthetic provider tone ready")
    return results


def proposals(_repo, spans, report):
    dossiers = build_label_dossiers(spans)
    rows = [{"label": row["label"], "canonicalName": row["label"],
             "category": "character", "aliases": [], "competingLabels": [],
             "reason": "Offline probe preserves each literal source label.", "reviewRequired": False}
            for row in dossiers]
    return {"status": "ready", "dossiers": dossiers, "proposals": rows,
            "fuzzyCandidates": [], "reconciliationConflicts": [], "globalLabelLedger": ""}


def wait(client, queued):
    assert queued.status_code == 202, queued.text
    job_id = queued.json()["id"]
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in {"succeeded", "failed", "canceled"}:
            return job
        time.sleep(0.02)
    raise TimeoutError(job_id)


def process(client, book_id, stage, settings):
    job = wait(client, client.post(f"/api/books/{book_id}/stages/{stage}/process",
                                  json={"settings": settings}))
    assert job["status"] == "succeeded", job
    return job["result"]


def candidate(client, book_id, stage, result):
    response = client.get(f"/api/books/{book_id}/stages/{stage}/candidates/{result['revision']}")
    assert response.status_code == 200, response.text
    return response.json()


def accept(client, book_id, stage, revision, decisions=None):
    response = client.post(f"/api/books/{book_id}/stages/{stage}/accept",
                           json={"revision": revision, "decisions": decisions or []})
    assert response.status_code == 200, response.text


def journey(client, source):
    global FAIL_SECOND
    response = client.post("/api/books/import", files={"file": (source.name, source.read_bytes(), "application/pdf")})
    assert response.status_code == 201, response.text
    book_id = response.json()["book"]["id"]
    language = "chinese" if source.name.startswith("03-") else "english"
    package = STATE / "packages" / book_id
    extraction = process(client, book_id, "extract", {"method": "native"})
    accept(client, book_id, "extract", extraction["revision"])
    dialogue = process(client, book_id, "dialogue", {"strategy": "narrate"})
    accept(client, book_id, "dialogue", dialogue["revision"])
    review_result = process(client, book_id, "review", {})
    review = candidate(client, book_id, "review", review_result)
    decisions = [{"occurrenceIds": [item["id"]], "action": "keep"}
                 for group in review["warnings"] for item in group["occurrences"]]
    decisions += [{"boundaryId": item["id"], "action": "chapter-start"}
                  for item in review.get("boundaryCandidates", [])]
    accept(client, book_id, "review", review_result["revision"], decisions)
    proposed = process(client, book_id, "cast", {})
    auditioned = process(client, book_id, "cast", {"proposalRevision": proposed["revision"], "language": language})
    cast = candidate(client, book_id, "cast", auditioned)
    accept(client, book_id, "cast", auditioned["revision"], [
        {"characterId": row["characterId"], "voiceRevision": row["voicePreviewRevision"]}
        for row in [cast["narrator"], *cast["identities"]]])
    snapshot = client.get(f"/api/books/{book_id}/snapshot").json()
    chapter_ids = [row["id"] for row in snapshot["chapters"]]
    generated = process(client, book_id, "generate", {"chapterIds": chapter_ids, "language": language})
    exact = [{"chapterId": row["chapterId"], "revision": row["revision"]} for row in generated["chapters"]]
    prior = {row["chapterId"]: hashlib.sha256(Path(row["artifactPath"]).read_bytes()).hexdigest()
             for row in generated["chapters"]}
    retained = None
    if source.name == "04-synthetic-two-chapters.pdf":
        FAIL_SECOND = True
        failed = wait(client, client.post(f"/api/books/{book_id}/stages/generate/process",
                                          json={"settings": {"chapterIds": chapter_ids, "language": language}}))
        FAIL_SECOND = False
        assert failed["status"] == "failed", failed
        assert all(hashlib.sha256(Path(row["artifactPath"]).read_bytes()).hexdigest() == prior[row["chapterId"]]
                   for row in generated["chapters"])
        current = client.get(f"/api/books/{book_id}/snapshot").json()["generatedChapters"]
        assert len(current) == len(chapter_ids)
        assert current[0]["revision"] != exact[0]["revision"]
        assert current[-1]["revision"] == exact[-1]["revision"]
        retained = {"failedStatus": failed["status"], "oldBytesRetained": True,
                    "completedFirstChapterPublished": True, "failedSecondChapterRetained": True}
    exports = []
    for preset in ("m4b-high", "m4b-compact"):
        selected = exact[-1:]
        output = client.post(f"/api/books/{book_id}/exports/audio",
                             json={"chapters": selected, "preset": preset,
                                   "title": source.stem, "author": "Offline contract probe",
                                   "description": "Generated by Meowdiobooks"})
        assert output.status_code == 200, output.text[:500]
        target = STATE / f"{source.stem}-{preset}.m4b"
        target.write_bytes(output.content)
        probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_chapters", "-show_streams",
                                           "-show_format", "-of", "json", str(target)],
                                          check=True, capture_output=True, text=True).stdout)
        assert len(probe["chapters"]) == len(selected)
        assert probe["format"]["tags"]["description"] == "Generated by Meowdiobooks"
        assert any(s["codec_name"] == "aac" for s in probe["streams"])
        assert any(s.get("disposition", {}).get("attached_pic") == 1 for s in probe["streams"])
        exports.append({"preset": preset, "selected": selected, "bytes": len(output.content),
                        "chapterTitles": [r["tags"]["title"] for r in probe["chapters"]],
                        "description": probe["format"]["tags"]["description"]})
    invalid = client.post(f"/api/books/{book_id}/exports/audio", json={"chapters": [{"chapterId": chapter_ids[0], "revision": "nonexistent"}], "preset": "m4b-high"})
    assert invalid.status_code == 409, invalid.text
    assert all(hashlib.sha256(Path(row["artifactPath"]).read_bytes()).hexdigest() == prior[row["chapterId"]]
               for row in generated["chapters"])
    return {"sample": source.name, "bookId": book_id, "language": language,
        "castIdentities": len(cast["identities"]), "acceptedRevisions": {
        kind: read_artifact(package, kind)["revision"] for kind in ("extraction", "dialogue", "review", "cast")},
        "generatedChapters": len(chapter_ids), "exports": exports, "invalidRevisionStatus": invalid.status_code,
        "priorAudioUnmodifiedByExport": True, "partialFailure": retained}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, default=STATE)
    STATE = parser.parse_args().state
    if STATE.exists():
        raise SystemExit(f"Choose a fresh --state directory: {STATE}")
    STATE.mkdir(parents=True, exist_ok=True)
    synthetic = STATE / "04-synthetic-two-chapters.pdf"
    canvas = Canvas(str(synthetic))
    for title, sentence in (("Chapter I", "Alice: [Hello, Rabbit! The first chapter is a quiet garden.]"),
                            ("Chapter II", "Rabbit: [The second chapter keeps its old recording if rendering fails.]")):
        canvas.drawString(72, 760, title)
        canvas.drawString(72, 720, sentence)
        canvas.showPage()
    canvas.save()
    sources = [*sorted((ROOT / "SampleBooks/public-domain-evaluation").glob("*.pdf")), synthetic]
    app = create_app_v2(STATE, library_dir=STATE / "library", voice_auditioner=auditions,
                        cast_proposer=proposals, voice_profiler=lambda *_args, **_kwargs: {},
                        voice_candidate_policy=VoiceCandidatePolicy(enabled=False))
    with patch("meowdiobooks.backend.tts_v2._load_model", lambda *_: (SimpleNamespace(sample_rate=24000), lambda: None)), \
         patch("meowdiobooks.backend.tts_v2._synthesize", tone), TestClient(app) as client:
        rows = [journey(client, source) for source in sources]
        assert len(client.get("/api/library").json()) == len(sources) * 2
    (EVIDENCE / "08-offline-api-results.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False))
    print(json.dumps(rows, indent=2, ensure_ascii=False))
