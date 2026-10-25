"""Exercise narrator omission through the public cast and generation endpoints."""

import pytest
from fastapi.testclient import TestClient

from meowdiobooks.backend.app_v2 import create_app_v2
from meowdiobooks.backend.artifacts import read_artifact, write_artifact
from test_app_v2_finish import _accept, _pdf, _process, _seed_reviewed_transcript, _wait


@pytest.mark.parametrize("exclude_narration", [False, True])
def test_dialogue_only_cast_skips_narrator_through_retry_acceptance_and_generation(
    tmp_path, exclude_narration
):
    profile_requests = []
    audition_requests = []
    rendered = []
    fail_once = True
    settings = {
        "presentation": "unspecified",
        "age": "adult",
        "tone": "warm",
        "pitch": "medium",
        "pace": "natural",
        "energy": "balanced",
        "accent": "unspecified",
        "description": "A clear and warm voice.",
    }
    proposal = {
        "status": "ready",
        "dossiers": [{"label": "Alice", "occurrenceCount": 1, "examples": []}],
        "proposals": [
            {
                "label": "Alice",
                "category": "character",
                "canonicalName": "Alice",
                "aliases": [],
                "competingLabels": [],
                "reason": "Explicit label.",
                "reviewRequired": False,
            }
        ],
        "fuzzyCandidates": [],
        "globalLabelLedger": "Alice\t1\tfirst:0",
        "reconciliationConflicts": [],
        "processing": {"labels": 1, "batches": 1},
    }

    def profile(_repo, identities, _dossiers, _spans, _report, **kwargs):
        profile_requests.append(kwargs.get("include_narrator"))
        return {
            **({"narrator": settings} if kwargs.get("include_narrator") else {}),
            **{row["characterId"]: settings for row in identities},
        }

    def audition(_repo, package, _book, voices, _report, _language, _model):
        nonlocal fail_once
        audition_requests.append([row["id"] for row in voices])
        if fail_once:
            fail_once = False
            raise RuntimeError("Transient audition failure")
        for row in voices:
            revision = f"voice-{row['id']}-{len(audition_requests)}"
            path = package / "voices" / row["id"] / f"{revision}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"RIFF-test")
            row.update(
                voicePreviewRevision=revision,
                previewUrl=f"/voice/{revision}",
                referenceText=row["previewLine"],
                voice=row["voiceDirection"],
                voiceCandidates=[
                    *row.get("voiceCandidates", []),
                    {
                        "revision": revision,
                        "previewUrl": f"/voice/{revision}",
                        "referenceText": row["previewLine"],
                        "direction": row["voiceDirection"],
                    },
                ],
            )
        return voices

    def render(_repo, _package, _book, plan, _language, _report, _model):
        rendered.append(plan)
        return [{"chapterId": "complete-document", "revision": "audio-1"}]

    with TestClient(
        create_app_v2(
            tmp_path,
            cast_proposer=lambda *_args: proposal,
            voice_profiler=profile,
            voice_auditioner=audition,
            chapter_renderer=render,
            voice_candidate_policy={
                "enabled": False,
                "coverage_fraction": 0.8,
                "min_voices": 0,
                "max_voices": 1,
                "extra_candidates": 1,
            },
        )
    ) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]
        package, dialogue, review = _seed_reviewed_transcript(tmp_path, book_id)
        if exclude_narration:
            narration = {
                **dialogue["spans"][0],
                "id": "heading",
                "blockId": "p1-b2",
                "source": "Heading",
                "text": "Heading",
                "sourceEnd": 7,
                "renderRole": "narration",
                "speakerStatus": "not-applicable",
            }
            narration.pop("sourceSpeakerLabel")
            write_artifact(
                package,
                "dialogue",
                {
                    **dialogue,
                    "revision": "dialogue-excluded",
                    "spans": [narration, *dialogue["spans"]],
                },
            )
            write_artifact(
                package,
                "review",
                {
                    **review,
                    "revision": "review-excluded",
                    "dialogueRevision": "dialogue-excluded",
                    "chapters": [{**review["chapters"][0], "sourceSpanIds": ["heading", "span-1"]}],
                    "spanChapterIds": {
                        "heading": "complete-document",
                        "span-1": "complete-document",
                    },
                    "warningSnapshot": [
                        {
                            "occurrences": [
                                {
                                    "id": "heading-warning",
                                    "blockId": "p1-b2",
                                    "sourceStart": 0,
                                    "sourceEnd": 7,
                                }
                            ]
                        }
                    ],
                    "decisions": [{"occurrenceId": "heading-warning", "action": "exclude"}],
                },
            )
        identity = _process(client, book_id, "cast", {})
        request = {"proposalRevision": identity["revision"], "language": "english"}
        failed = client.post(
            f"/api/books/{book_id}/stages/cast/process", json={"settings": request}
        )
        assert _wait(client, failed.json()["id"])["status"] == "failed"
        result = _process(client, book_id, "cast", request)
        candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{result['revision']}"
        ).json()
        assert candidate["narrator"] is None
        alice = candidate["identities"][0]
        assert alice["lineCount"] == 1
        assert profile_requests == [False]
        assert audition_requests == [[alice["characterId"]], [alice["characterId"]]]

        regenerated = _process(
            client,
            book_id,
            "cast",
            {
                "proposalRevision": result["revision"],
                "characterId": alice["characterId"],
                "voiceSettings": {**settings, "pace": "brisk"},
            },
        )
        candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{regenerated['revision']}"
        ).json()
        assert candidate["narrator"] is None
        assert audition_requests[-1] == [alice["characterId"]]
        assert profile_requests == [False]
        decisions = [
            {"characterId": row["characterId"], "voiceRevision": row["voicePreviewRevision"]}
            for row in candidate["identities"]
        ]
        accepted = _accept(client, book_id, "cast", regenerated["revision"], decisions)
        assert accepted.status_code == 200, accepted.text
        assert read_artifact(package, "cast")["narrator"] is None
        prepared = client.post(f"/api/books/{book_id}/recording-script/prepare")
        assert prepared.status_code == 200, prepared.text
        _process(
            client,
            book_id,
            "generate",
            {"chapterIds": ["complete-document"], "language": "english"},
        )
        assert {row["effectiveCharacterId"] for row in rendered[0]["chapters"][0]["segments"]} == {
            alice["characterId"]
        }

        narrated = _process(
            client,
            book_id,
            "cast",
            {
                **request,
                "identityDecisions": [
                    {
                        "label": "Alice",
                        "category": "narrator",
                        "canonicalName": "",
                        "aliases": [],
                        "primaryLabel": "narrator",
                    }
                ],
            },
        )
        narrated_cast = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{narrated['revision']}"
        ).json()
        assert narrated_cast["identities"] == []
        assert narrated_cast["narrator"]["lineCount"] == 1
        assert profile_requests[-1] is True
        assert audition_requests[-1] == ["narrator"]


@pytest.mark.parametrize("role,label", [("narration", None), ("dialogue", "Unknown")])
def test_generation_still_requires_narrator_when_a_span_falls_back_to_it(role, label):
    from meowdiobooks.backend.recording_script import build_recording_script
    from meowdiobooks.backend.render_plan import RenderPlanError, compile_render_plan
    from test_render_plan import _span, _voice

    dialogue = {
        "revision": "dialogue-1",
        "spans": [
            _span("s1", "Speak this line.", 0, role=role, label=label),
        ],
    }
    review = {
        "revision": "review-1",
        "dialogueRevision": "dialogue-1",
        "canStartCast": True,
        "blockers": [],
    }
    cast = {
        "revision": "cast-1",
        "narrator": None,
        "labelToCharacterId": {},
        "identities": [_voice("alice", "Alice")],
    }
    script = build_recording_script(dialogue, review, cast, revision="script-1")
    with pytest.raises(RenderPlanError, match="[Nn]arrator"):
        compile_render_plan(dialogue, cast, script, ["chapter-1"])


def test_review_changes_remove_unused_narrator_and_reopen_cast_when_it_becomes_needed(tmp_path):
    proposals = []

    def propose(*_args):
        proposals.append(True)
        return {"status": "ready", "dossiers": [], "proposals": []}

    def no_auditions(*_args, **_kwargs):
        pytest.fail("Reopening review must not synthesize a voice")

    with TestClient(
        create_app_v2(tmp_path, cast_proposer=propose, voice_auditioner=no_auditions)
    ) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]
        package, dialogue, review = _seed_reviewed_transcript(
            tmp_path, book_id, include_narration=True
        )
        alice = {
            "characterId": "alice",
            "name": "Alice",
            "category": "character",
            "literalLabels": ["Alice"],
            "lineCount": 1,
            "voiceAccepted": True,
            "voicePreviewRevision": "alice-1",
            "voiceCandidates": [{"revision": "alice-1"}],
        }
        write_artifact(
            package,
            "cast",
            {
                "revision": "accepted-with-narrator",
                "phase": "accepted",
                "status": "accepted",
                "dialogueRevision": dialogue["revision"],
                "reviewRevision": review["revision"],
                "labelToCharacterId": {"Alice": "alice"},
                "identities": [alice],
                "dossiers": [{"label": "Alice", "occurrenceCount": 1}],
                "narrator": {
                    "characterId": "narrator",
                    "name": "Narrator",
                    "category": "narrator",
                    "voicePreviewRevision": "narrator-1",
                    "voiceAccepted": True,
                },
            },
        )
        _, excluded = write_artifact(
            package,
            "review",
            {
                **review,
                "revision": "review-excluded",
                "warningSnapshot": [
                    {
                        "occurrences": [
                            {
                                "id": "narration-warning",
                                "blockId": "p1-b2",
                                "sourceStart": 0,
                                "sourceEnd": 15,
                            }
                        ]
                    }
                ],
                "decisions": [{"occurrenceId": "narration-warning", "action": "exclude"}],
            },
        )
        result = _process(client, book_id, "cast", {})
        candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{result['revision']}"
        ).json()
        assert candidate["phase"] == "audition-review"
        assert candidate["narrator"] is None
        assert candidate["identities"] == [alice]
        assert proposals == []
        write_artifact(
            package,
            "cast",
            {
                **candidate,
                "revision": "accepted-without-narrator",
                "phase": "accepted",
                "status": "accepted",
            },
        )
        write_artifact(
            package, "review", {**excluded, "revision": "review-restored", "decisions": []}
        )
        restored = _process(client, book_id, "cast", {})
        restored_candidate = client.get(
            f"/api/books/{book_id}/stages/cast/candidates/{restored['revision']}"
        ).json()
        assert restored_candidate["phase"] == "identity-review"
        assert proposals == [True]
        assert _accept(client, book_id, "cast", restored["revision"], []).status_code == 409
