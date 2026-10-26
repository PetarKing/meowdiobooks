"""Chapter eligibility follows the rendered recipe rather than stage audit revisions."""

from copy import deepcopy
import json

import pytest

from meowdiobooks.backend import generation_status
from meowdiobooks.backend.artifacts import write_artifact
from meowdiobooks.backend.recording_script import build_recording_script
from meowdiobooks.backend.review import apply_review_render_policies


def _voice(character_id):
    return {
        "characterId": character_id,
        "name": character_id.title(),
        "category": "character",
        "voiceAccepted": True,
        "acceptedVoiceRevision": f"voice-{character_id}",
        "referenceAudio": f"voices/{character_id}.wav",
        "referenceText": "A reference line.",
    }


def _inputs():
    spans = [
        {
            "id": f"span-{chapter}", "chapterId": chapter, "blockId": f"block-{chapter}",
            "sourceStart": 0, "sourceEnd": len(text), "source": text, "text": text,
            "renderRole": "dialogue", "sourceSpeakerLabel": label,
            "speakerStatus": "explicit",
        }
        for chapter, text, label in (("a", "Hello.", "Alice"), ("b", "Goodbye.", "Bob"))
    ]
    return {
        "dialogue": {"revision": "dialogue-1", "spans": spans},
        "review": {
            "revision": "review-1", "dialogueRevision": "dialogue-1",
            "spanChapterIds": {row["id"]: row["chapterId"] for row in spans},
            "canStartCast": True, "blockers": [],
        },
        "cast": {
            "revision": "cast-1", "voiceModel": "model-1", "language": "english",
            "narrator": _voice("narrator"),
            "identities": [_voice("alice"), _voice("bob")],
            "labelToCharacterId": {"Alice": "alice", "Bob": "bob"},
        },
    }


def _publish(package, inputs, suffix):
    artifacts = deepcopy(inputs)
    for kind, artifact in artifacts.items():
        artifact["revision"] = f"{kind}-{suffix}"
    artifacts["review"]["dialogueRevision"] = artifacts["dialogue"]["revision"]
    chapter_dialogue = {
        **artifacts["dialogue"],
        "spans": [
            {**row, "chapterId": artifacts["review"]["spanChapterIds"][row["id"]]}
            for row in artifacts["dialogue"]["spans"]
        ],
    }
    artifacts["script"] = build_recording_script(
        apply_review_render_policies(chapter_dialogue, artifacts["review"]),
        artifacts["review"], artifacts["cast"], revision=f"script-{suffix}",
    )
    for kind, artifact in artifacts.items():
        write_artifact(package, kind, artifact, publish=False)
    return {kind: artifact["revision"] for kind, artifact in artifacts.items()}


def _metadata(pinned, chapter="a"):
    return {"chapterId": chapter, "inputRevisions": pinned}


def _stale(package, pinned, current, chapter="a"):
    return generation_status.chapter_audio_stale_reasons(
        package, _metadata(pinned, chapter), current,
    )


def test_equivalent_reaccept_and_new_source_ids_keep_chapters_current(tmp_path):
    inputs = _inputs()
    pinned = _publish(tmp_path, inputs, "1")
    for span in inputs["dialogue"]["spans"]:
        span["id"] += "-rebuilt"
    inputs["review"]["spanChapterIds"] = {
        row["id"]: row["chapterId"] for row in inputs["dialogue"]["spans"]
    }
    inputs["cast"]["narrator"]["name"] = "A new display name"
    inputs["cast"]["identities"].reverse()
    current = _publish(tmp_path, inputs, "2")
    assert _stale(tmp_path, pinned, current, "a") == []
    assert _stale(tmp_path, pinned, current, "b") == []


@pytest.mark.parametrize("changed", ["text", "voice", "speaker"])
def test_changes_only_reopen_chapters_that_use_them(tmp_path, changed):
    inputs = _inputs()
    pinned = _publish(tmp_path, inputs, "1")
    if changed == "text":
        span = inputs["dialogue"]["spans"][1]
        span["source"] = span["text"] = "A different farewell."
        span["sourceEnd"] = len(span["source"])
    elif changed == "voice":
        inputs["cast"]["identities"][1]["acceptedVoiceRevision"] = "bob-new-voice"
    else:
        inputs["cast"]["labelToCharacterId"]["Bob"] = "alice"
    current = _publish(tmp_path, inputs, "2")
    assert _stale(tmp_path, pinned, current, "a") == []
    assert _stale(tmp_path, pinned, current, "b")


@pytest.mark.parametrize("changed", ["referenceMode", "referenceText", "voiceSettings", "language", "model"])
def test_render_affecting_voice_and_model_inputs_reopen_chapter(tmp_path, changed):
    inputs = _inputs()
    pinned = _publish(tmp_path, inputs, "1")
    alice = inputs["cast"]["identities"][0]
    if changed == "language":
        inputs["cast"]["language"] = "french"
    elif changed == "model":
        inputs["cast"]["voiceModel"] = "model-2"
    elif changed == "voiceSettings":
        # Host renderers may consume settings even when the local clone route does not.
        alice[changed] = {"pace": "slow"}
    else:
        alice[changed] = "speaker-embedding" if changed == "referenceMode" else "New reference."
    # Keep Dialogue and Review immutable so their revision checks cannot mask a missing
    # voice field in the detector. Only accepted Cast and its rebuilt Script change.
    inputs["cast"]["revision"] = "cast-2"
    script = build_recording_script(
        inputs["dialogue"], inputs["review"], inputs["cast"], revision="script-2",
    )
    write_artifact(tmp_path, "cast", inputs["cast"], publish=False)
    write_artifact(tmp_path, "script", script, publish=False)
    current = {**pinned, "cast": "cast-2", "script": "script-2"}
    assert _stale(tmp_path, pinned, current)


@pytest.mark.parametrize("action", ["narrate", "exclude"])
def test_review_render_policy_reopens_affected_chapter_only(tmp_path, action):
    inputs = _inputs()
    pinned = _publish(tmp_path, inputs, "1")
    inputs["review"]["warningSnapshot"] = [{"occurrences": [{
        "id": "warning-a", "blockId": "block-a", "sourceStart": 0, "sourceEnd": 6,
    }]}]
    inputs["review"]["decisions"] = [{"occurrenceId": "warning-a", "action": action}]
    current = _publish(tmp_path, inputs, "2")
    assert _stale(tmp_path, pinned, current, "a")
    assert _stale(tmp_path, pinned, current, "b") == []


def test_other_chapter_text_cannot_change_reviewed_hyphen_spelling(tmp_path):
    inputs = _inputs()
    span = inputs["dialogue"]["spans"][0]
    span["source"] = span["text"] = "Find your al-\nlies."
    span["sourceEnd"] = len(span["source"])
    pinned = _publish(tmp_path, inputs, "1")
    other = inputs["dialogue"]["spans"][1]
    other["source"] = other["text"] = "Your allies await."
    other["sourceEnd"] = len(other["source"])
    current = _publish(tmp_path, inputs, "2")
    receipt = {**_metadata(pinned), "segments": [{"text": "Find your al-\nlies."}]}
    assert generation_status.chapter_audio_stale_reasons(tmp_path, receipt, current) == []
    assert _stale(tmp_path, pinned, current, "b")


@pytest.mark.parametrize("recorded,stale", [
    ([{"text": "Find your allies."}], True),
    ([{"text": "Find your al-\nlies."}], False),
    ([{"text": "Find your al- lies."}], False),
    (None, True),
    ([], True),
    ([{}], True),
])
def test_same_revision_legacy_audio_checks_actual_hyphen_spelling(tmp_path, recorded, stale):
    inputs = _inputs()
    span = inputs["dialogue"]["spans"][0]
    span["source"] = span["text"] = "Find your al-\nlies."
    span["sourceEnd"] = len(span["source"])
    pinned = _publish(tmp_path, inputs, "1")
    receipt = {**_metadata(pinned), "segments": recorded}
    reasons = generation_status.chapter_audio_stale_reasons(tmp_path, receipt, pinned)
    assert bool(reasons) is stale
    if stale:
        assert reasons == ["rendered-text:reviewed-hyphen-spelling"]
    assert _stale(tmp_path, pinned, pinned, "b") == []


def test_layered_member_voice_changes_reopen_every_chapter_using_the_group(tmp_path):
    inputs = _inputs()
    inputs["cast"]["identities"].append({
        "characterId": "crowd", "category": "group", "name": "Crowd", "voiceAccepted": True,
        "voiceRoute": {"kind": "layered", "characterIds": ["alice", "bob"]},
    })
    inputs["cast"]["labelToCharacterId"]["Alice"] = "crowd"
    pinned = _publish(tmp_path, inputs, "1")
    # Rebuilt source IDs change the compiler's mix-group receipt IDs, without changing mixing.
    inputs["dialogue"]["spans"][0]["id"] = "new-span-a"
    inputs["review"]["spanChapterIds"] = {"new-span-a": "a", "span-b": "b"}
    current = _publish(tmp_path, inputs, "2")
    assert _stale(tmp_path, pinned, current, "a") == []
    inputs["cast"]["identities"][1]["acceptedVoiceRevision"] = "bob-new-voice"
    changed = _publish(tmp_path, inputs, "3")
    assert _stale(tmp_path, pinned, changed, "a")
    assert _stale(tmp_path, pinned, changed, "b")


def test_chapter_assignment_change_keeps_unaffected_chapter_current(tmp_path):
    inputs = _inputs()
    pinned = _publish(tmp_path, inputs, "1")
    inputs["review"]["spanChapterIds"]["span-b"] = "new-b"
    current = _publish(tmp_path, inputs, "2")
    assert _stale(tmp_path, pinned, current, "a") == []
    assert _stale(tmp_path, pinned, current, "b")


@pytest.mark.parametrize("failure", ["missing", "malformed", "incomplete-current"])
def test_uncertain_recipe_history_never_claims_equivalence(tmp_path, failure):
    inputs = _inputs()
    pinned = _publish(tmp_path, inputs, "1")
    current = _publish(tmp_path, inputs, "2")
    historical = tmp_path / "artifacts" / "dialogue" / "dialogue-1.json"
    if failure == "missing":
        historical.unlink()
    elif failure == "malformed":
        historical.write_text("{broken")
    else:
        current["cast"] = None
    assert _stale(tmp_path, pinned, current)


def test_snapshot_compiles_each_input_tuple_once_for_multiple_chapters(tmp_path, monkeypatch):
    inputs = _inputs()
    pinned = _publish(tmp_path, inputs, "1")
    current = _publish(tmp_path, inputs, "2")
    for chapter in ("a", "b"):
        directory = tmp_path / "audio" / chapter / "audio-1"
        directory.mkdir(parents=True)
        (directory / "metadata.json").write_text(json.dumps({
            **_metadata(pinned, chapter), "bookId": "book", "revision": "audio-1", "segments": [],
        }))
        (directory.parent / "latest.json").write_text(json.dumps({"revision": "audio-1"}))
    compile_plan = generation_status.compile_render_plan
    calls = []

    def counted(*args):
        calls.append(args)
        return compile_plan(*args)

    monkeypatch.setattr(generation_status, "compile_render_plan", counted)
    rows = generation_status.generated_chapters(tmp_path, current)
    assert [row["current"] for row in rows] == [True, True]
    assert len(calls) == 2
    # Export callers can share the same request-local context across chapter checks.
    cache = {}
    assert generation_status.chapter_audio_stale_reasons(
        tmp_path, _metadata(pinned, "a"), current, comparison_cache=cache,
    ) == []
    assert generation_status.chapter_audio_stale_reasons(
        tmp_path, _metadata(pinned, "b"), current, comparison_cache=cache,
    ) == []
    assert len(calls) == 4


@pytest.mark.parametrize("collapsed", [True, False])
def test_hyphen_receipt_handles_native_and_hosted_layered_tracks(tmp_path, collapsed):
    inputs = _inputs()
    span = inputs["dialogue"]["spans"][0]
    span["source"] = span["text"] = "A re-\ncreation."
    span["sourceEnd"] = len(span["source"])
    inputs["cast"]["identities"].append({
        "characterId": "crowd", "category": "group", "name": "Crowd", "voiceAccepted": True,
        "voiceRoute": {"kind": "layered", "characterIds": ["alice", "bob"]},
    })
    inputs["cast"]["labelToCharacterId"]["Alice"] = "crowd"
    pinned = _publish(tmp_path, inputs, "1")
    rows = [{"text": span["text"], "mixGroupId": "legacy-group"}]
    receipt = {**_metadata(pinned), "segments": rows if collapsed else rows * 2}
    assert generation_status.chapter_audio_stale_reasons(tmp_path, receipt, pinned) == []
    receipt["segments"][0]["text"] = "A recreation."
    assert generation_status.chapter_audio_stale_reasons(tmp_path, receipt, pinned)
