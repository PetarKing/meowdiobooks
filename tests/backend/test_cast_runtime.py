from meowdiobooks.backend.cast import stable_character_id
from meowdiobooks.backend.cast_runtime import (
    _reuse_unchanged_cast_voices,
    _shared_audition_identity,
)


def _voice(character_id, name, labels, revision):
    return {
        "characterId": character_id,
        "name": name,
        "category": "character",
        "literalLabels": labels,
        "voicePreviewRevision": revision,
        "previewUrl": f"/api/voices/{character_id}/{revision}",
        "voiceCandidates": [{"revision": revision}],
    }


def test_label_only_rename_reuses_audition_and_opaque_character_id():
    old_id = stable_character_id("Alice")
    generated_id = stable_character_id("Alice Liddell")
    finalized = {
        "identities": [
            {
                "characterId": generated_id,
                "name": "Alice Liddell",
                "category": "character",
                "literalLabels": ["Alice"],
                "lineCount": 12,
            }
        ],
        "labelToCharacterId": {"Alice": generated_id},
    }

    reused = _reuse_unchanged_cast_voices(
        finalized,
        {"identities": [_voice(old_id, "Alice", ["Alice"], "alice-voice-1")]},
    )

    assert set(reused) == {old_id}
    assert reused[old_id]["name"] == "Alice Liddell"
    assert reused[old_id]["voicePreviewRevision"] == "alice-voice-1"
    assert finalized["identities"][0]["characterId"] == old_id
    assert finalized["labelToCharacterId"] == {"Alice": old_id}


def test_merge_invalidates_only_the_resulting_identity():
    alice_id = stable_character_id("Alice")
    bob_id = stable_character_id("Bob")
    finalized = {
        "identities": [
            {
                "characterId": alice_id,
                "name": "Alice",
                "category": "character",
                "literalLabels": ["Alice", "Bob"],
            }
        ],
        "labelToCharacterId": {"Alice": alice_id, "Bob": alice_id},
    }
    previous = {
        "identities": [
            _voice(alice_id, "Alice", ["Alice"], "alice-voice-1"),
            _voice(bob_id, "Bob", ["Bob"], "bob-voice-1"),
        ]
    }

    reused = _reuse_unchanged_cast_voices(finalized, previous)
    affected = [
        row
        for row in finalized["identities"]
        if str(row["characterId"]) not in reused
    ]

    assert reused == {}
    assert [row["name"] for row in affected] == ["Alice"]


def test_shared_audition_preserves_each_identity_desired_settings(tmp_path):
    anchor_settings = {"age": "adult", "tone": "dark"}
    member_settings = {"age": "young-adult", "tone": "bright"}
    generated = {
        "id": "guard",
        "name": "Supporting voice",
        "category": "character",
        "voicePreviewRevision": "voice-1",
        "voice": "Dark adult voice",
        "voiceSettings": anchor_settings,
        "voiceCandidates": [
            {
                "revision": "voice-1",
                "direction": "Dark adult voice",
                "voiceSettings": anchor_settings,
            }
        ],
    }
    base = {
        "characterId": "rebel",
        "name": "Rebel",
        "category": "character",
        "voiceDirection": "Bright young-adult voice",
        "voiceSettings": member_settings,
    }

    shared = _shared_audition_identity(
        generated, base, "shared-voice-group", tmp_path
    )

    assert shared["voiceSettings"] == member_settings
    assert shared["voiceDirection"] == "Bright young-adult voice"
    assert shared["voiceCandidates"][0]["voiceSettings"] == member_settings
    assert shared["voiceCandidates"][0]["direction"] == "Bright young-adult voice"
    assert shared["voiceCandidates"][0]["source"] == "shared"
    assert shared["referenceAudio"] == "voices/guard/voice-1.wav"
