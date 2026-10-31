from copy import deepcopy

import pytest

from meowdiobooks.backend.cast_runtime import cast_voice_targets
from meowdiobooks.backend.dialogue import scan_dialogue
from meowdiobooks.backend.recording_script import build_recording_script
from meowdiobooks.backend.render_plan import compile_render_plan
from meowdiobooks.backend.voice_routing import is_narration_delimiter


@pytest.mark.parametrize("text", ["\n \t", "“”—…", "「」『』"])
def test_nonverbal_narration_is_omitted_but_attributed_dialogue_remains_playable(text):
    assert is_narration_delimiter({"renderRole": "narration", "text": text})
    assert not is_narration_delimiter({"renderRole": "dialogue", "text": text})


@pytest.mark.parametrize("text", ["Chapter 1", "第一章", "123", ""])
def test_spoken_narration_and_invalid_empty_spans_are_not_delimiters(text):
    assert not is_narration_delimiter({"renderRole": "narration", "text": text})


def test_dialogue_only_source_keeps_delimiter_coverage_without_a_narrator_voice():
    source = "ALICE: Hello.\n\nBOB: Goodbye.\n"
    spans = scan_dialogue([{"page": 1, "text": source}])["partition"]
    dialogue = {"revision": "dialogue-1", "spans": spans}
    review = {"revision": "review-1", "dialogueRevision": "dialogue-1"}
    identities = [
        {
            "characterId": name.lower(), "name": name, "category": "character",
            "literalLabels": [name], "voiceAccepted": True,
            "acceptedVoiceRevision": f"voice-{name.lower()}",
            "referenceAudio": f"voices/{name.lower()}.wav", "referenceText": "Reference.",
        }
        for name in ("ALICE", "BOB")
    ]
    finalized = {
        "identities": identities,
        "labelToCharacterId": {row["name"]: row["characterId"] for row in identities},
    }
    proposal = {"dossiers": [{"label": name, "occurrenceCount": 1} for name in ("ALICE", "BOB")]}
    targets = cast_voice_targets(finalized, proposal, dialogue, review)
    assert {row["characterId"] for row in targets} == {"alice", "bob"}
    cast = {**finalized, "revision": "cast-1", "narrator": None}

    script = build_recording_script(dialogue, review, cast, revision="script-1")
    omissions = [row for row in script["entries"] if row["kind"] == "omission"]
    assert omissions
    assert all(row["provenance"] == "source-delimiter" and row["text"] == "" for row in omissions)
    assert "".join(row["sourceText"] for row in script["entries"]) == source
    assert script["sourceCoverage"]["sourceSpanIds"] == [row["id"] for row in spans]
    assert script["summary"]["retainedSpans"] == 2

    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])
    segments = plan["chapters"][0]["segments"]
    assert [(row["effectiveCharacterId"], row["text"]) for row in segments] == [
        ("alice", "Hello."), ("bob", "Goodbye."),
    ]
    assert plan["summary"]["omissions"] == len(omissions)


def test_voice_targets_expand_source_spellings_without_mutating_any_input():
    finalized = {
        "identities": [{
            "characterId": "alice", "name": "Alice", "category": "character",
            "literalLabels": ["Alice"], "lineCount": 999,
        }],
        "labelToCharacterId": {"Alice": "alice"},
    }
    proposal = {"dossiers": [{"label": "Alice", "sourceSpellings": ["ALICE"], "occurrenceCount": 1}]}
    dialogue = {"spans": [{"renderRole": "dialogue", "sourceSpeakerLabel": "ALICE", "text": "Hello."}]}
    review = {}
    original = deepcopy((finalized, proposal, dialogue, review))

    targets = cast_voice_targets(finalized, proposal, dialogue, review)

    assert [row["characterId"] for row in targets] == ["alice"]
    assert targets[0]["lineCount"] == 1
    targets[0]["literalLabels"].append("unrelated edit")
    assert (finalized, proposal, dialogue, review) == original
