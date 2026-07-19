import pytest

from meowdiobooks.backend.voice_sharing import VoiceSharingPolicy, plan_shared_voices


def _identity(character_id: str) -> dict:
    return {"characterId": character_id, "name": character_id.title(), "category": "character"}


def _span(span_id: str, label: str, chapter: str = "chapter-1") -> dict:
    return {
        "id": span_id,
        "chapterId": chapter,
        "renderRole": "dialogue",
        "sourceSpeakerLabel": label,
        "text": "Line.",
    }


def _settings(presentation: str = "masculine", age: str = "adult", **extra: str) -> dict:
    return {"presentation": presentation, "age": age, **extra}


def test_plan_uses_absolute_and_proportional_line_limits() -> None:
    identities = [_identity("guard"), _identity("rebel"), _identity("soldier")]
    spans = [
        *[_span(f"guard-{index}", "Guard") for index in range(6)],
        *[_span(f"rebel-{index}", "Rebel", "chapter-2") for index in range(2)],
        *[_span(f"soldier-{index}", "Soldier", "chapter-3") for index in range(92)],
    ]
    plan = plan_shared_voices(
        identities,
        {row["characterId"]: _settings() for row in identities},
        spans,
        {"Guard": "guard", "Rebel": "rebel", "Soldier": "soldier"},
        VoiceSharingPolicy(max_lines=6, max_dialogue_fraction=0.02),
    )

    assert plan.total_dialogue_lines == 100
    assert plan.effective_line_limit == 2
    assert plan.groups == ()


def test_plan_still_allows_one_line_roles_in_short_transcripts() -> None:
    identities = [_identity("guard"), _identity("rebel")]
    spans = [
        _span("guard", "Guard", "chapter-1"),
        _span("rebel", "Rebel", "chapter-2"),
        *[_span(f"bulk-{index}", "Major", "chapter-3") for index in range(18)],
    ]
    plan = plan_shared_voices(
        identities,
        {row["characterId"]: _settings() for row in identities},
        spans,
        {"Guard": "guard", "Rebel": "rebel", "Major": "major"},
        VoiceSharingPolicy(max_lines=6, max_dialogue_fraction=0.02),
    )

    assert plan.effective_line_limit == 1
    assert [group.character_ids for group in plan.groups] == [("guard", "rebel")]


def test_plan_reuses_compatible_distant_characters_but_separates_nearby_turns() -> None:
    identities = [_identity("guard"), _identity("rebel"), _identity("soldier")]
    spans = [
        _span("guard", "Guard"),
        *[_span(f"filler-{index}", "Major") for index in range(7)],
        _span("rebel", "Rebel"),
        _span("soldier", "Soldier", "chapter-2"),
        *[_span(f"bulk-{index}", "Major", "chapter-3") for index in range(90)],
    ]
    plan = plan_shared_voices(
        identities,
        {row["characterId"]: _settings() for row in identities},
        spans,
        {
            "Guard": "guard",
            "Rebel": "rebel",
            "Soldier": "soldier",
            "Major": "major",
        },
        VoiceSharingPolicy(max_lines=6, max_dialogue_fraction=0.02, collision_window_turns=8),
    )

    assert [group.character_ids for group in plan.groups] == [("guard", "soldier")]


def test_plan_uses_only_configured_voice_fields() -> None:
    identities = [_identity("guard"), _identity("rebel"), _identity("child")]
    spans = [
        _span("guard", "Guard", "chapter-1"),
        _span("rebel", "Rebel", "chapter-2"),
        _span("child", "Child", "chapter-3"),
        *[_span(f"bulk-{index}", "Major", "chapter-4") for index in range(97)],
    ]
    settings = {
        "guard": _settings(tone="dark"),
        "rebel": _settings(tone="bright"),
        "child": _settings(age="child", tone="dark"),
    }
    mapping = {"Guard": "guard", "Rebel": "rebel", "Child": "child", "Major": "major"}

    default_plan = plan_shared_voices(
        identities,
        settings,
        spans,
        mapping,
        VoiceSharingPolicy(max_lines=6, max_dialogue_fraction=0.02),
    )
    tone_plan = plan_shared_voices(
        identities,
        settings,
        spans,
        mapping,
        VoiceSharingPolicy(
            max_lines=6,
            max_dialogue_fraction=0.02,
            compatibility_fields=("age", "presentation", "tone"),
        ),
    )

    assert [group.character_ids for group in default_plan.groups] == [("guard", "rebel")]
    assert tone_plan.groups == ()


def test_policy_rejects_unknown_compatibility_fields() -> None:
    with pytest.raises(ValueError, match="Unsupported voice-sharing compatibility fields"):
        VoiceSharingPolicy(compatibility_fields=("description",))
