import pytest

from meowdiobooks.backend.recording_script import (
    build_recording_script,
    split_recording_script_chapter,
)
from meowdiobooks.backend.render_plan import RenderPlanError, compile_render_plan


def _span(span_id, text, start, *, role="narration", label=None, labels=None):
    row = {
        "id": span_id,
        "chapterId": "chapter-1",
        "blockId": "b1",
        "sourceStart": start,
        "sourceEnd": start + len(text),
        "source": text,
        "text": text,
        "renderRole": role,
        "speakerStatus": "explicit" if label or labels else "not-applicable",
    }
    if label:
        row["sourceSpeakerLabel"] = label
    if labels:
        row["speakerLabels"] = labels
    return row


def _voice(
    character_id,
    name,
    *,
    category="character",
    accepted=True,
    voice_settings=None,
):
    return {
        "characterId": character_id,
        "name": name,
        "category": category,
        "voiceAccepted": accepted,
        "acceptedVoiceRevision": f"voice-{character_id}",
        "referenceAudio": f"voices/{character_id}.wav",
        "referenceText": f"Reference line for {name}.",
        "voiceSettings": voice_settings
        or {
            "tone": "natural",
            "pace": "natural",
            "energy": "balanced",
            "description": f"Deliver {name}'s lines naturally.",
        },
    }


def _artifacts():
    spans = [
        _span("s1", "Alice entered. ", 0),
        _span("s2", "She paused. ", 15),
        _span("s3", "Hello!", 27, role="dialogue", label="Alice"),
        _span("s4", "Who are you?", 33, role="dialogue", label="???"),
        _span("s5", "Together!", 45, role="dialogue", labels=["Alice", "Rabbit"]),
        _span("s6", " Goodbye.", 54),
    ]
    dialogue = {"revision": "dialogue-1", "spans": spans}
    review = {
        "revision": "review-1",
        "dialogueRevision": "dialogue-1",
        "canStartCast": True,
        "blockers": [],
    }
    cast = {
        "revision": "cast-1",
        "labelToCharacterId": {"Alice": "alice", "Rabbit": "rabbit"},
        "identities": [_voice("alice", "Alice"), _voice("rabbit", "Rabbit")],
        "narrator": _voice("narrator", "Narrator", category="narrator"),
    }
    script = build_recording_script(dialogue, review, cast, revision="script-1")
    return dialogue, cast, script


def test_compiles_directly_from_spans_with_identity_mapping_tts_metadata_and_fallbacks():
    dialogue, cast, script = _artifacts()

    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])

    segments = plan["chapters"][0]["segments"]
    assert segments[0]["text"] == "Alice entered. She paused. "
    assert segments[0]["sourceSpanIds"] == ["s1", "s2"]
    alice = next(row for row in segments if row["sourceSpanIds"] == ["s3"])
    assert alice["effectiveCharacterId"] == "alice"
    assert alice["voiceRevision"] == "voice-alice"
    assert alice["referenceAudio"] == "voices/alice.wav"
    assert alice["referenceText"] == "Reference line for Alice."
    assert alice["voiceSettings"]["description"] == "Deliver Alice's lines naturally."
    unresolved = next(row for row in segments if row["sourceSpanIds"] == ["s4"])
    assert unresolved["effectiveCharacterId"] == "narrator"
    assert unresolved["fallback"] == "unmapped-label:???"
    joint = [row for row in segments if row["sourceSpanIds"] == ["s5"]]
    assert {row["effectiveCharacterId"] for row in joint} == {"alice", "rabbit"}
    assert len({row["mixGroupId"] for row in joint}) == 1
    assert joint[0]["mixGroupId"] is not None
    assert plan["sourceCoverage"] == {"status": "exact", "sourceSpanCount": 6}
    assert plan["inputRevisions"]["script"] == "script-1"


def test_repairs_book_corroborated_line_break_hyphenation_for_tts() -> None:
    dialogue, cast, script = _artifacts()
    script["entries"][0]["text"] = "Protect your al-\nlies. "
    script["entries"][1]["text"] = "Your allies are waiting. "

    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])

    assert plan["chapters"][0]["segments"][0]["text"] == (
        "Protect your allies. Your allies are waiting. "
    )
    assert plan["summary"]["repairedLineBreakHyphenations"] == 1


def test_preserves_uncorroborated_line_break_hyphenated_compound() -> None:
    dialogue, cast, script = _artifacts()
    script["entries"][0]["text"] = "A well-\nknown path. "

    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])

    assert plan["chapters"][0]["segments"][0]["text"].startswith("A well-\nknown path.")
    assert plan["summary"]["repairedLineBreakHyphenations"] == 0


def test_shared_voice_revision_keeps_each_characters_accepted_settings():
    dialogue, cast, script = _artifacts()
    alice = next(row for row in cast["identities"] if row["characterId"] == "alice")
    rabbit = next(row for row in cast["identities"] if row["characterId"] == "rabbit")
    alice.update(
        acceptedVoiceRevision="shared-voice-1",
        referenceAudio="voices/alice/shared-voice-1.wav",
        voiceSettings={
            "tone": "bright",
            "pace": "natural",
            "energy": "balanced",
            "description": "Sound lightly dispirited, with sharp bursts during combat.",
        },
    )
    rabbit.update(
        acceptedVoiceRevision="shared-voice-1",
        referenceAudio="voices/alice/shared-voice-1.wav",
        voiceSettings={
            "tone": "gravelly",
            "pace": "brisk",
            "energy": "animated",
            "description": "Deliver a forceful roar with explosive conviction.",
        },
    )

    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])

    shared = {
        row["effectiveCharacterId"]: row
        for row in plan["chapters"][0]["segments"]
        if row["sourceSpanIds"] == ["s5"]
    }
    assert shared["alice"]["voiceRevision"] == shared["rabbit"]["voiceRevision"]
    assert shared["alice"]["referenceAudio"] == shared["rabbit"]["referenceAudio"]
    assert shared["alice"]["voiceSettings"]["tone"] == "bright"
    assert shared["rabbit"]["voiceSettings"] == rabbit["voiceSettings"]


def test_compiles_transcript_free_uploaded_voice_reference():
    dialogue, cast, script = _artifacts()
    alice = next(row for row in cast["identities"] if row["characterId"] == "alice")
    alice.update(
        referenceText=None,
        referenceMode="speaker-embedding",
        referenceAudio="voices/alice/upload.wav",
    )

    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])

    segment = next(row for row in plan["chapters"][0]["segments"] if row["sourceSpanIds"] == ["s3"])
    assert segment["referenceAudio"] == "voices/alice/upload.wav"
    assert segment["referenceText"] == ""
    assert segment["referenceMode"] == "speaker-embedding"


def test_unresolved_and_unmapped_group_fallbacks_are_explicit():
    dialogue, cast, script = _artifacts()
    dialogue["spans"][3]["speakerStatus"] = "unresolved"
    dialogue["spans"][4]["speakerLabels"] = ["Everyone"]

    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])
    segments = plan["chapters"][0]["segments"]

    unresolved = next(row for row in segments if row["sourceSpanIds"] == ["s4"])
    collective = next(row for row in segments if row["sourceSpanIds"] == ["s5"])
    assert unresolved["fallback"] == "unresolved-speaker"
    assert collective["fallback"] == "unmapped-label:Everyone"
    assert plan["summary"]["fallbackSegments"] == 2


def test_confirmed_group_voice_route_expands_to_member_voices_and_one_mix_slot():
    dialogue, cast, script = _artifacts()
    joint = dialogue["spans"][4]
    joint.pop("speakerLabels")
    joint["sourceSpeakerLabel"] = "Alice & Rabbit"
    cast["labelToCharacterId"]["Alice & Rabbit"] = "alice-rabbit"
    cast["identities"].append(
        {
            "characterId": "alice-rabbit",
            "name": "Alice & Rabbit",
            "category": "group",
            "voiceAccepted": True,
            "voiceRoute": {
                "kind": "layered",
                "characterIds": ["alice", "rabbit"],
            },
        }
    )

    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])

    mixed = [row for row in plan["chapters"][0]["segments"] if row["sourceSpanIds"] == ["s5"]]
    assert [row["effectiveCharacterId"] for row in mixed] == ["alice", "rabbit"]
    assert [row["voiceRevision"] for row in mixed] == ["voice-alice", "voice-rabbit"]
    assert len({row["mixGroupId"] for row in mixed}) == 1
    assert mixed[0]["mixGroupId"] is not None

    alice = next(row for row in cast["identities"] if row["characterId"] == "alice")
    alice.update(
        acceptedVoiceRevision="voice-alice-2",
        referenceAudio="voices/alice-2.wav",
        referenceText="Updated reference line for Alice.",
    )
    updated_plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])
    updated_alice = next(
        row
        for row in updated_plan["chapters"][0]["segments"]
        if row["sourceSpanIds"] == ["s5"] and row["effectiveCharacterId"] == "alice"
    )
    assert updated_alice["voiceRevision"] == "voice-alice-2"
    assert updated_alice["referenceAudio"] == "voices/alice-2.wav"
    assert updated_alice["referenceText"] == "Updated reference line for Alice."


def test_explicit_narrator_route_is_not_reported_as_an_unmapped_fallback():
    dialogue, cast, script = _artifacts()
    cast["labelToCharacterId"]["Alice"] = None

    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])
    routed = next(row for row in plan["chapters"][0]["segments"] if row["sourceSpanIds"] == ["s3"])

    assert routed["effectiveCharacterId"] == "narrator"
    assert routed["effectiveSpeaker"] == "Narrator"
    assert routed["fallback"] is None


def test_narration_does_not_coalesce_across_an_omitted_source_span():
    _dialogue, cast, _script = _artifacts()
    dialogue = {
        "revision": "dialogue-1",
        "spans": [
            _span("s1", "Before. ", 0),
            {**_span("s2", "Removed. ", 8), "reviewAction": "exclude"},
            _span("s3", "After.", 17),
        ],
    }
    script = build_recording_script(
        dialogue,
        {
            "revision": "review-1",
            "dialogueRevision": "dialogue-1",
            "canStartCast": True,
            "blockers": [],
        },
        cast,
        revision="script-review-exclusion",
    )

    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])

    assert [row["sourceSpanIds"] for row in plan["chapters"][0]["segments"]] == [
        ["s1"],
        ["s3"],
    ]


def test_chapters_without_retained_text_are_skipped_instead_of_rendered_as_silence():
    dialogue, cast, _script = _artifacts()
    for row in dialogue["spans"]:
        row["chapterId"] = "chapter-1"
    dialogue["spans"].append(
        {
            **_span("s7", "Only narration.", 0),
            "chapterId": "chapter-2",
            "blockId": "b2",
        }
    )
    dialogue["spans"][-1]["reviewAction"] = "exclude"
    script = build_recording_script(
        dialogue,
        {
            "revision": "review-1",
            "dialogueRevision": "dialogue-1",
            "canStartCast": True,
            "blockers": [],
        },
        cast,
        revision="script-with-empty-chapter",
    )

    plan = compile_render_plan(dialogue, cast, script, ["chapter-1", "chapter-2"])

    assert [row["chapterId"] for row in plan["chapters"]] == ["chapter-1"]
    assert plan["omittedChapterIds"] == ["chapter-2"]
    assert plan["summary"]["omittedChapters"] == 1


def test_generation_accepts_physical_chapters_created_by_the_recording_script():
    dialogue, cast, script = _artifacts()
    split = split_recording_script_chapter(
        script,
        dialogue,
        cast,
        chapter_id="chapter-1",
        revision="script-split",
        target_seconds=2,
        minimum_seconds=1,
    )
    chapter_ids = [row["id"] for row in split["chapters"]]

    plan = compile_render_plan(dialogue, cast, split, chapter_ids)

    assert [row["chapterId"] for row in plan["chapters"]] == chapter_ids
    assert {
        source_id
        for chapter in plan["chapters"]
        for segment in chapter["segments"]
        for source_id in segment["sourceSpanIds"]
    } == {f"s{index}" for index in range(1, 7)}


@pytest.mark.parametrize(
    ("mutate", "error"),
    [
        (lambda dialogue, cast, script: script.update(status="review-required"), "must be ready"),
        (
            lambda dialogue, cast, script: script["inputRevisions"].update(dialogue="old"),
            "does not reference",
        ),
        (
            lambda dialogue, cast, script: cast["identities"][0].update(voiceAccepted=False),
            "not accepted",
        ),
        (
            lambda dialogue, cast, script: script["entries"].pop(),
            "own every Dialogue span",
        ),
        (
            lambda dialogue, cast, script: dialogue["spans"][0].update(source="short"),
            "source evidence disagrees",
        ),
    ],
)
def test_generation_gates_invalid_or_incomplete_accepted_artifacts(mutate, error):
    dialogue, cast, script = _artifacts()
    mutate(dialogue, cast, script)

    with pytest.raises(RenderPlanError, match=error):
        compile_render_plan(dialogue, cast, script, ["chapter-1"])


def test_character_only_chapter_does_not_require_unused_narrator():
    dialogue, cast, script = _artifacts()
    cast["narrator"] = None
    for span in dialogue["spans"]:
        span["chapterId"] = "dialogue-only" if span["id"] == "s3" else "other"
    for entry in script["entries"]:
        entry["chapterId"] = "dialogue-only" if entry["sourceSpanIds"] == ["s3"] else "other"

    plan = compile_render_plan(dialogue, cast, script, ["dialogue-only"])
    assert [row["effectiveCharacterId"] for row in plan["chapters"][0]["segments"]] == ["alice"]
    with pytest.raises(RenderPlanError, match="accepted narrator voice"):
        compile_render_plan(dialogue, cast, script, ["other"])


@pytest.mark.parametrize(
    "left,right,expected",
    [
        ("A shadow crossed her", "eyes.", "A shadow crossed hereyes."),
        ("her ", "eyes.", "her eyes."),
        ("her", "\neyes.", "her\neyes."),
        ("her\u00a0", "eyes.", "her\u00a0eyes."),
        ("said (", "word)", "said (word)"),
        ("word", ", then", "word, then"),
        ("inter-", "national", "inter-national"),
        ("她的", "眼睛", "她的眼睛"),
        ("彼女の", "目", "彼女の目"),
        ("ภาษา", "ไทย", "ภาษาไทย"),
        ("ses", "yeux", "sesyeux"),
        ("её", "глаза", "еёглаза"),
        ("τα", "μάτια", "ταμάτια"),
        ("λέξη", "; next", "λέξη; next"),
        ("cafe\u0301", "noir", "cafe\u0301noir"),
        ("room", "12", "room12"),
    ],
)
def test_narration_without_approved_boundary_keeps_existing_source_join(left, right, expected):
    dialogue, cast, _script = _artifacts()
    dialogue["spans"] = [
        {**_span("s1", left, 0), "blockId": "page-1-block"},
        {**_span("s2", right, 0), "blockId": "page-2-block"},
    ]
    script = build_recording_script(
        dialogue,
        {"revision": "review-1", "dialogueRevision": "dialogue-1",
         "canStartCast": True, "blockers": []},
        cast, revision="script-boundaries",
    )
    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])
    segment = plan["chapters"][0]["segments"][0]
    assert segment["text"] == expected
    assert segment["sourceSpanIds"] == ["s1", "s2"]
    assert [entry["text"] for entry in script["entries"]] == [left, right]


def test_narration_without_approved_boundary_keeps_repeated_source_joins():
    dialogue, cast, _script = _artifacts()
    dialogue["spans"] = [
        _span("s1", "She saw her", 0),
        {**_span("s2", "eye", 0), "blockId": "b2"},
        {**_span("s3", "s", 3), "blockId": "b2"},
        {**_span("s4", "close.", 0), "blockId": "b3"},
    ]
    script = build_recording_script(
        dialogue,
        {"revision": "review-1", "dialogueRevision": "dialogue-1",
         "canStartCast": True, "blockers": []},
        cast, revision="script-boundaries",
    )
    plan = compile_render_plan(dialogue, cast, script, ["chapter-1"])
    segment = plan["chapters"][0]["segments"][0]
    assert segment["text"] == "She saw hereyesclose."
    assert segment["sourceSpanIds"] == ["s1", "s2", "s3", "s4"]
