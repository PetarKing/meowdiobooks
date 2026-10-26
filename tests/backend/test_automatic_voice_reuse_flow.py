"""Public HTTP reuse flow; reviewed text and speech providers are deterministic.

Synthetic Subaru samples avoid copying private book fixtures. Import, Cast,
acceptance and render planning use public HTTP routes; transcription is seeded.
"""

from copy import deepcopy
from io import BytesIO
import wave

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen.canvas import Canvas

from meowdiobooks.backend.app_v2 import create_app_v2
from meowdiobooks.backend.artifacts import read_artifact, write_artifact
from tests.backend.test_app_v2_finish import _accept, _process


def _wav(number):
    output = BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(24_000)
        stream.writeframes(int(number).to_bytes(2, "little", signed=True) * 2_400)
    return output.getvalue()


def _book(client, root, title, labels, source_pdf=None):
    pdf = BytesIO()
    canvas = Canvas(pdf)
    canvas.setTitle(title)
    for label in labels:
        canvas.drawString(72, 760, title)
        canvas.drawString(72, 720, f"{label}: We should cross the bridge before nightfall.")
        canvas.showPage()
    canvas.save()
    response = client.post(
        "/api/books/import",
        files={
            "file": (
                f"{title}.pdf",
                source_pdf.read_bytes() if source_pdf else pdf.getvalue(),
                "application/pdf",
            )
        },
    )
    assert response.status_code == 201, response.text
    book = response.json()["book"]["id"]
    package = root / "packages" / book
    text = "We should cross the bridge before nightfall."
    spans = [
        {
            "id": f"span-{i}",
            "blockId": f"p{i}-b1",
            "page": i,
            "sourceStart": 0,
            "sourceEnd": len(text),
            "source": text,
            "text": text,
            "renderRole": "dialogue",
            "sourceSpeakerLabel": label,
            "speakerStatus": "explicit",
        }
        for i, label in enumerate(labels, 1)
    ]
    extraction_revision = "extract-1"
    if source_pdf is not None:
        extracted = _process(client, book, "extract", {"method": "native"})
        accepted = _accept(client, book, "extract", extracted["revision"])
        assert accepted.status_code == 200, accepted.text
        extraction = read_artifact(package, "extraction")
        extraction_revision = extraction["revision"]
        blocks = extraction["blocks"]
        for span, label in zip(spans, labels):
            block = next(b for b in blocks if label in b["text"])
            span.update(
                blockId=block["id"],
                page=block["page"],
                sourceStart=0,
                sourceEnd=len(block["text"]),
                source=block["text"],
                text=block["text"],
            )
    else:
        write_artifact(
            package,
            "extraction",
            {
                "revision": "extract-1",
                "pages": [],
                "blocks": [
                    {"id": s["blockId"], "page": s["page"], "text": s["text"]} for s in spans
                ],
                "boundaryCandidates": [],
            },
        )
    write_artifact(
        package,
        "dialogue",
        {"revision": "dialogue-1", "extractionRevision": extraction_revision, "spans": spans},
    )
    write_artifact(
        package,
        "review",
        {
            "revision": "review-1",
            "dialogueRevision": "dialogue-1",
            "canStartCast": True,
            "blockers": [],
            "chapters": [
                {
                    "id": "complete-document",
                    "title": title,
                    "sourceSpanIds": [s["id"] for s in spans],
                }
            ],
            "spanChapterIds": {s["id"]: "complete-document" for s in spans},
        },
    )
    return book, package


def _propose(_repo, spans, _report):
    labels = list(dict.fromkeys(s["sourceSpeakerLabel"] for s in spans))
    return {
        "status": "ready",
        "dossiers": [{"label": label, "occurrenceCount": 1, "examples": []} for label in labels],
        "fuzzyCandidates": [],
        "globalLabelLedger": "",
        "reconciliationConflicts": [],
        "proposals": [
            {
                "label": label,
                "category": "character",
                "canonicalName": label,
                "aliases": [],
                "competingLabels": [],
                "reason": "Explicit distinct label.",
                "reviewRequired": False,
            }
            for label in labels
        ],
        "processing": {"labels": len(labels), "batches": 1, "model": "test"},
    }


def _profile(_repo, identities, *_args, **kwargs):
    settings = {
        "presentation": "unspecified",
        "age": "adult",
        "tone": "warm",
        "pitch": "medium",
        "pace": "measured",
        "energy": "balanced",
        "accent": "unspecified",
        "description": "Clear natural voice.",
    }
    return {
        row["characterId"]: dict(settings)
        for row in [
            *identities,
            *([{"characterId": "narrator"}] if kwargs.get("include_narrator") else []),
        ]
    }


def _candidate(client, book, result):
    response = client.get(f"/api/books/{book}/stages/cast/candidates/{result['revision']}")
    assert response.status_code == 200, response.text
    return response.json()


def _generate(client, book):
    identity = _candidate(client, book, _process(client, book, "cast", {}))
    preview = client.post(
        f"/api/books/{book}/cast/reuse-preview",
        json={
            "proposalRevision": identity["revision"],
            "language": "english",
            "voiceModel": "test",
            "sourceBookIds": [],
        },
    )
    assert preview.status_code == 200, preview.text
    identity["previousVoiceMatches"] = preview.json()["previousVoiceMatches"]
    voices = _candidate(
        client,
        book,
        _process(
            client,
            book,
            "cast",
            {"proposalRevision": identity["revision"], "language": "english", "voiceModel": "test"},
        ),
    )
    return identity, voices


def _approve(client, book, cast, choices=None):
    choices = choices or {}
    decisions = [
        {
            "characterId": row["characterId"],
            "voiceRevision": choices.get(row["name"], row["voiceCandidates"][0]["revision"]),
        }
        for row in [cast["narrator"], *cast["identities"]]
        if row
    ]
    response = _accept(client, book, "cast", cast["revision"], decisions)
    assert response.status_code == 200, response.text


def run_sample(tmp_path, override=False, evidence_dir=None, source_pdf=None, delete_prior=False):
    lead, near, companion, new_label = (
        ("Alice", "Alicee", "Caterpillar", "Rabbit")
        if source_pdf
        else ("Subaru", "Subaro", "Louis", "Emilia")
    )
    audition_calls, render_plans = [], []

    def audition(_repo, package, book, characters, report, _language, _model):
        audition_calls.append((book, [r["name"] for r in characters]))
        result = []
        for original in characters:
            row = deepcopy(original)
            revision = f"generated-{len(audition_calls)}-{row['id']}"
            relative = f"voices/{row['id']}/{revision}.wav"
            path = package / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(_wav(len(audition_calls)))
            candidate = {
                "revision": revision,
                "referenceAudio": relative,
                "previewUrl": f"/api/books/{book}/voices/{row['id']}/{revision}/audio",
                "referenceText": row["previewLine"],
                "direction": row["voiceDirection"],
                "voiceSettings": row["voiceSettings"],
                "source": "generated",
            }
            row.update(
                voicePreviewRevision=revision,
                referenceAudio=relative,
                previewUrl=candidate["previewUrl"],
                referenceText=candidate["referenceText"],
                voiceCandidates=[candidate],
            )
            result.append(row)
        report(100, "done")
        return result

    def render(_repo, _package, _book, plan, _language, report, _model):
        render_plans.append(deepcopy(plan))
        report(100, "done")
        return [{"chapterId": "complete-document", "revision": "rendered-1"}]

    app = create_app_v2(
        tmp_path,
        cast_proposer=_propose,
        voice_profiler=_profile,
        voice_auditioner=audition,
        chapter_renderer=render,
        default_voice_model="test",
        voice_models=lambda *_: [{"id": "test", "recipeVersion": "1"}],
        voice_languages=lambda *_: ["english"],
        voice_candidate_policy={
            "enabled": False,
            "coverage_fraction": 0.8,
            "min_voices": 0,
            "max_voices": 1,
            "extra_candidates": 1,
        },
    )
    with TestClient(app) as client:
        older, _ = _book(
            client, tmp_path, f"{lead} first", [lead, companion], source_pdf=source_pdf
        )
        _, old_cast = _generate(client, older)
        _approve(client, older, old_cast)
        newer, newer_package = _book(client, tmp_path, f"{lead} second", [lead, companion])
        _, newer_cast = _generate(client, newer)
        subaru = next(r for r in newer_cast["identities"] if r["name"] == lead)
        # Choose the newly generated alternative, rather than the inherited voice.
        assert len(subaru["voiceCandidates"]) == 2
        chosen = subaru["voiceCandidates"][-1]
        _approve(client, newer, newer_cast, {lead: chosen["revision"]})
        selected_bytes = (newer_package / chosen["referenceAudio"]).read_bytes()
        destination, package = _book(client, tmp_path, f"{lead} third", [lead, near, new_label])
        identity, cast = _generate(client, destination)
        assert lead in identity["previousVoiceMatches"]
        assert near not in identity["previousVoiceMatches"]
        assert new_label not in identity["previousVoiceMatches"]
        rows = {r["name"]: r for r in cast["identities"]}
        assert set(rows) == {lead, near, new_label}
        assert len(set(cast["labelToCharacterId"].values())) == 3
        prior, generated = rows[lead]["voiceCandidates"]
        assert prior["source"] == "previous-book"
        assert prior["previousBookTitle"] == f"{lead} second"
        assert (package / prior["referenceAudio"]).read_bytes() == selected_bytes
        assert generated["source"] == "generated"
        assert all(
            c.get("source") != "previous-book"
            for name in (near, new_label)
            for c in rows[name]["voiceCandidates"]
        )
        assert {lead, near, new_label}.issubset(
            {name for book, names in audition_calls if book == destination for name in names}
        )
        if evidence_dir is not None:
            import json
            import shutil
            from pathlib import Path

            evidence_dir = Path(evidence_dir)
            shutil.copytree(tmp_path, evidence_dir)
            (evidence_dir / "evidence.json").write_text(
                json.dumps(
                    {
                        "olderBookId": older,
                        "newerBookId": newer,
                        "destinationBookId": destination,
                        "identityRevision": identity["revision"],
                        "auditionRevision": cast["revision"],
                        "selectedSourceRevision": chosen["revision"],
                        "destinationPriorRevision": prior["revision"],
                        "positiveLabel": lead,
                        "negativeLabels": [near, new_label],
                    },
                    indent=2,
                )
            )
        if delete_prior:
            deleted = client.delete(
                f"/api/books/{destination}/stages/cast/candidates/{cast['revision']}"
                f"/voices/{rows[lead]['characterId']}/{prior['revision']}"
            )
            assert deleted.status_code == 200, deleted.text
            deleted_cast = deleted.json()
            deleted_row = next(r for r in deleted_cast["identities"] if r["name"] == lead)
            assert deleted_row["voiceCandidatePlan"].get("priorBookCandidates", 0) == 0
            assert {
                k: v
                for k, v in deleted_row["voiceCandidatePlan"].items()
                if k != "priorBookCandidates"
            } == {
                k: v
                for k, v in rows[lead]["voiceCandidatePlan"].items()
                if k != "priorBookCandidates"
            }
            calls_before = len(audition_calls)
            cast = _candidate(
                client,
                destination,
                _process(
                    client,
                    destination,
                    "cast",
                    {
                        "proposalRevision": deleted_cast["revision"],
                        "language": "english",
                        "voiceModel": "test",
                        "identityDecisions": [
                            {
                                "label": new_label,
                                "category": "character",
                                "canonicalName": f"{new_label} revised",
                                "aliases": [],
                                "primaryLabel": new_label,
                            }
                        ],
                    },
                ),
            )
            retained = next(r for r in cast["identities"] if r["name"] == lead)
            assert retained["voiceCandidates"] == [generated]
            assert all(lead not in names for _, names in audition_calls[calls_before:])
            assert client.get(generated["previewUrl"]).status_code == 200
            override = True
        assert client.delete(f"/api/books/{newer}").status_code == 204
        if delete_prior:
            assert client.get(prior["previewUrl"]).status_code == 404
        else:
            assert client.get(prior["previewUrl"]).content == selected_bytes
        selected = generated if override else prior
        _approve(client, destination, cast, {lead: selected["revision"]})
        accepted = read_artifact(package, "cast")
        accepted_subaru = next(r for r in accepted["identities"] if r["name"] == lead)
        assert accepted_subaru["acceptedVoiceRevision"] == selected["revision"]
        response = client.post(f"/api/books/{destination}/recording-script/prepare")
        assert response.status_code == 200, response.text
        _process(
            client,
            destination,
            "generate",
            {"chapterIds": ["complete-document"], "language": "english"},
        )
        segments = render_plans[-1]["chapters"][0]["segments"]
        assert segments[0]["voiceRevision"] == selected["revision"]
        assert segments[0]["referenceAudio"] == selected["referenceAudio"]
        assert (package / segments[0]["referenceAudio"]).read_bytes() == (
            package / selected["referenceAudio"]
        ).read_bytes()
        assert len({s["effectiveSpeaker"] for s in segments}) == 3


@pytest.mark.parametrize(
    "override", [False, True], ids=["first-voice-default", "explicit-override"]
)
def test_latest_exact_prior_voice_survives_source_deletion_and_reaches_render_plan(
    tmp_path, override
):
    run_sample(tmp_path, override)


def test_public_domain_alice_extraction_then_exact_voice_reuse(tmp_path):
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[2]
        / "SampleBooks/public-domain-evaluation/01-alice-explicit-dialogue.pdf"
    )
    run_sample(tmp_path, source_pdf=source)


def test_deleting_prior_audition_keeps_generated_voice_on_unrelated_cast_edit(tmp_path):
    run_sample(tmp_path, delete_prior=True)
