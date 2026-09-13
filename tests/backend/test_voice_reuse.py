import pytest
from meowdiobooks.backend.cast import CastContractError
from meowdiobooks.backend.voice_reuse import (
    match_exact_voices,
    validate_source_book_ids,
    validated_imported_voices,
)


def test_exact_matching_order_aliases_unicode_narrator_and_ambiguity():
    targets = [
        dict(characterId="a", name="Ａｌｉｃｅ", category="character"),
        dict(characterId="narrator", name="Narrator", category="narrator"),
    ]
    voice = dict(
        characterId="v", name="Al", aliases=[" alice "], category="character", revision="r"
    )
    first = dict(
        bookId="first",
        voices=[voice, dict(characterId="n", name="Erzähler", category="narrator", revision="nr")],
    )
    second = dict(bookId="second", voices=[{**voice, "revision": "later"}])
    matches = match_exact_voices(targets, [first, second])
    assert matches["a"]["bookId"] == "first"
    assert matches["narrator"]["characterId"] == "n"
    assert (
        match_exact_voices(
            targets,
            [dict(bookId="ambiguous", voices=[voice, {**voice, "characterId": "other"}]), second],
        )
        == {}
    )


@pytest.mark.parametrize("ids", [["destination"], ["one", "one"], [""], [123], None])
def test_rejects_invalid_source_selection(ids):
    with pytest.raises(CastContractError):
        validate_source_book_ids(ids, "destination")


def test_import_preserves_destination_identity_and_requires_review():
    target = dict(characterId="dest", name="Alice", literalLabels=["Alice"], category="character")
    source = dict(
        characterId="source",
        name="Al",
        voicePreviewRevision="copied",
        referenceAudio="voices/dest/copied.wav",
        acceptedVoiceRevision="old",
        voiceAccepted=True,
        reusedVoice={"bookId": "source"},
    )
    result = validated_imported_voices({"dest": source}, [target])["dest"]
    assert result["name"] == "Alice" and result["characterId"] == "dest"
    assert result["voiceAccepted"] is False and "acceptedVoiceRevision" not in result
    assert result["reusedVoice"] == {"bookId": "source"}
    for malformed in [{"unknown": source}, {"dest": {}}]:
        with pytest.raises(CastContractError):
            validated_imported_voices(malformed, [target])


def test_stale_proposal_rejected_before_casting():
    from meowdiobooks.backend.voice_reuse import validate_cast_proposal_inputs

    proposal = {"dialogueRevision": "dialogue", "reviewRevision": "review"}
    validate_cast_proposal_inputs(proposal, {"revision": "dialogue"}, {"revision": "review"})
    for dialogue, review in [("changed", "review"), ("dialogue", "changed")]:
        with pytest.raises(CastContractError):
            validate_cast_proposal_inputs(proposal, {"revision": dialogue}, {"revision": review})
