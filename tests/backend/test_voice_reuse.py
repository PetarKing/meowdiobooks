import pytest
from meowdiobooks.backend.cast import CastContractError
from meowdiobooks.backend.voice_reuse import (
    match_exact_voices,
    validate_source_book_ids,
    validated_imported_voices,
)


def test_exact_matching_pool_aliases_unicode_narrator_and_ambiguity():
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
    assert "a" not in matches
    assert matches == match_exact_voices(targets, [second, first])
    assert match_exact_voices(targets, [first])["a"]["bookId"] == "first"
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


def test_source_selection_is_canonical_regardless_of_input_order():
    assert validate_source_book_ids(["z", "a"], "dest") == ["a", "z"]
    assert validate_source_book_ids(["a", "z"], "dest") == ["a", "z"]


def test_latest_exact_match_uses_normalized_labels_not_display_name_or_substrings():
    from meowdiobooks.backend.voice_reuse import match_latest_voices
    target = dict(characterId='target', name='Renamed display', category='character', literalLabels=[' Ｓｕｂａｒｕ '])
    voice = dict(characterId='source', name='Different display', category='character', literalLabels=['subaru'], revision='r')
    old = dict(bookId='older', createdAt='2026-01-01T00:00:00Z', voices=[voice])
    new = dict(bookId='newer', createdAt='2026-02-01T00:00:00Z', voices=[{**voice, 'revision': 'chosen'}])
    assert match_latest_voices([target], [new, old])['target']['revision'] == 'chosen'
    for label in ['Subaruu', 'Captain Subaru', 'Renamed display']:
        negative = {**voice, 'literalLabels': [label]}
        assert match_latest_voices([target], [{**new, 'voices': [negative]}]) == {}


def test_latest_exact_match_ambiguous_latest_book_does_not_choose_or_fall_back():
    from meowdiobooks.backend.voice_reuse import match_latest_voices
    target = dict(characterId='target', name='Subaru', category='character', literalLabels=['Subaru'])
    voice = {**target, 'characterId': 'source', 'revision': 'r'}
    old = dict(bookId='older', createdAt='2026-01-01', voices=[voice])
    new = dict(bookId='newer', createdAt='2026-02-01', voices=[voice, {**voice, 'characterId': 'other'}])
    assert match_latest_voices([target], [old, new]) == {}
    new['voices'] = [{**voice, 'category': 'group'}]
    assert match_latest_voices([target], [new, old])['target']['bookId'] == 'older'


def test_latest_exact_match_ties_are_stable_and_legacy_name_and_alias_work():
    from meowdiobooks.backend.voice_reuse import match_latest_voices
    target = dict(characterId='target', name='Subaru', category='character')
    voice = dict(characterId='source', name='Natsuki', aliases=['Subaru'], category='character', revision='r')
    books = [dict(bookId=key, createdAt='2026-01-01', voices=[voice]) for key in ['a', 'z']]
    assert match_latest_voices([target], books) == match_latest_voices([target], books[::-1])
    assert match_latest_voices([target], books)['target']['bookId'] == 'z'


def test_latest_exact_match_compares_instants_across_timezone_offsets():
    from meowdiobooks.backend.voice_reuse import match_latest_voices
    target = dict(characterId='target', name='Subaru', category='character')
    voice = {**target, 'characterId': 'source', 'revision': 'r'}
    books = [dict(bookId='earlier', createdAt='2026-01-01T09:00:00+02:00', voices=[voice]),
             dict(bookId='later', createdAt='2026-01-01T08:00:00Z', voices=[voice])]
    assert match_latest_voices([target], books)['target']['bookId'] == 'later'


def test_prepend_previous_voice_retains_generated_alternatives_and_prunable_refs(tmp_path):
    from meowdiobooks.backend.voice_reuse import prepend_previous_voice
    from meowdiobooks.backend.cast_runtime import has_complete_audition_pack
    from meowdiobooks.backend.voice_retention import cast_voice_revisions, prune_voice_files
    generated = dict(characterId='target', name='Subaru', category='character',
        voiceCandidates=[{'revision': 'fresh1'}, {'revision': 'fresh2'}],
        voiceCandidatePlan={'automaticAlternatives': 1}, voiceAccepted=True,
        acceptedVoiceRevision='fresh1')
    imported = dict(voiceCandidates=[{'revision': 'prior', 'referenceAudio': 'voices/target/prior.reference.wav',
        'previewUrl': '/api/books/dest/voices/target/prior/audio', 'referenceText': 'Saved line'}])
    result = prepend_previous_voice(generated, imported)
    assert [row['revision'] for row in result['voiceCandidates']] == ['prior', 'fresh1', 'fresh2']
    assert result['voiceCandidates'][0]['source'] == 'previous-book'
    assert result['voicePreviewRevision'] == 'prior'
    assert result['voiceAccepted'] is False and 'acceptedVoiceRevision' not in result
    assert has_complete_audition_pack(result)
    assert not has_complete_audition_pack({**result, 'voiceCandidates': result['voiceCandidates'][:2]})
    voices = tmp_path/'voices'/'target'
    voices.mkdir(parents=True)
    for name in ['prior.wav', 'prior.reference.wav', 'fresh1.wav', 'fresh2.wav', 'discard.wav']:
        (voices/name).write_bytes(b'audio')
    prune_voice_files(tmp_path, cast_voice_revisions({'identities': [result]}))
    assert sorted(path.name for path in voices.iterdir()) == ['fresh1.wav', 'fresh2.wav', 'prior.reference.wav', 'prior.wav']
    assert generated['voiceAccepted'] is True  # No mutation of existing input artifacts.
