import json

import pytest

from meowdiobooks.backend.voice_profile_checkpoint import (
    CHECKPOINT_DIRECTORY,
    profile_checkpoint_key,
    read_profile_checkpoint,
    write_profile_checkpoint,
)


IDENTITIES = [
    {
        "characterId": "character-alice",
        "name": "Alice",
        "category": "character",
        "literalLabels": ["Alice", "Lady Alice"],
    }
]


def _key(**changes):
    arguments = {
        "proposal_revision": "proposal-1",
        "dialogue_revision": "dialogue-1",
        "review_revision": "review-1",
        "identities": IDENTITIES,
        "language": "english",
        "profiler_revision": "luna-profile-v2",
        "include_narrator": True,
    }
    arguments.update(changes)
    return profile_checkpoint_key(**arguments)


def test_profile_checkpoint_round_trips_only_the_exact_complete_profile_set(tmp_path):
    key = _key()
    profiles = {
        "narrator": {"age": "adult", "tone": "warm"},
        "character-alice": {"age": "young-adult", "tone": "bright"},
    }

    write_profile_checkpoint(tmp_path, key, profiles)

    path = tmp_path / CHECKPOINT_DIRECTORY / f"{key}.json"
    assert path.is_file()
    assert not list(path.parent.glob("*.tmp"))
    assert read_profile_checkpoint(
        tmp_path,
        key,
        expected_character_ids={"narrator", "character-alice"},
    ) == profiles
    assert (
        read_profile_checkpoint(
            tmp_path,
            key,
            expected_character_ids={"character-alice"},
        )
        is None
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("proposal_revision", "proposal-2"),
        ("dialogue_revision", "dialogue-2"),
        ("review_revision", "review-2"),
        ("language", "french"),
        ("profiler_revision", "luna-profile-v3"),
        ("include_narrator", False),
        (
            "identities",
            [
                {
                    **IDENTITIES[0],
                    "literalLabels": ["Alice", "Lady Alice", "Alicia"],
                }
            ],
        ),
    ],
)
def test_profile_checkpoint_key_invalidates_every_profile_input(field, value):
    assert _key(**{field: value}) != _key()


def test_profile_checkpoint_ignores_corrupt_or_relabelled_payloads(tmp_path):
    key = _key()
    path = tmp_path / CHECKPOINT_DIRECTORY / f"{key}.json"
    path.parent.mkdir(parents=True)
    path.write_text("not json", encoding="utf-8")
    assert (
        read_profile_checkpoint(
            tmp_path, key, expected_character_ids={"narrator", "character-alice"}
        )
        is None
    )

    path.write_text(
        json.dumps(
            {
                "contract": "meowdiobooks.cast-voice-profiles.v1",
                "key": "different-key",
                "profiles": {},
            }
        ),
        encoding="utf-8",
    )
    assert (
        read_profile_checkpoint(
            tmp_path, key, expected_character_ids={"narrator", "character-alice"}
        )
        is None
    )
