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


def test_coverage_policy_dedicates_the_voices_covering_eighty_percent() -> None:
    identities = [_identity(name) for name in ("lead", "second", "third", "tail-a", "tail-b")]
    counts = {"lead": 50, "second": 20, "third": 10, "tail-a": 8, "tail-b": 12}
    spans = [
        _span(f"{name}-{index}", name, f"chapter-{name}")
        for name, count in counts.items()
        for index in range(count)
    ]
    plan = plan_shared_voices(
        identities,
        {row["characterId"]: _settings(pitch="medium") for row in identities},
        spans,
        {name: name for name in counts},
        VoiceSharingPolicy(
            dedicated_dialogue_coverage=0.8,
            compatibility_fields=("age", "presentation", "pitch"),
        ),
    )

    assert plan.dedicated_character_ids == ("lead", "second", "tail-b")
    assert [set(group.character_ids) for group in plan.groups] == [{"third", "tail-a"}]
    assert plan.groups[0].id.startswith("shared-voice-")


def test_coverage_policy_counts_non_character_dialogue_as_already_dedicated() -> None:
    identities = [
        {**_identity("crowd"), "category": "group"},
        *[_identity(name) for name in ("lead", "tail-a", "tail-b")],
    ]
    counts = {"crowd": 30, "lead": 50, "tail-a": 10, "tail-b": 10}
    spans = [
        _span(f"{name}-{index}", name, f"chapter-{name}")
        for name, count in counts.items()
        for index in range(count)
    ]
    plan = plan_shared_voices(
        identities,
        {row["characterId"]: _settings() for row in identities},
        spans,
        {name: name for name in counts},
        VoiceSharingPolicy(dedicated_dialogue_coverage=0.8),
    )

    assert plan.dedicated_character_ids == ("lead",)
    assert [set(group.character_ids) for group in plan.groups] == [{"tail-a", "tail-b"}]


def test_coverage_group_id_is_stable_and_planning_can_limit_newly_shareable_characters() -> None:
    identities = [_identity(name) for name in ("lead", "tail-a", "tail-b", "tail-c")]
    spans = [
        *[_span(f"lead-{index}", "lead", "chapter-lead") for index in range(80)],
        *[_span(f"a-{index}", "tail-a", "chapter-a") for index in range(8)],
        *[_span(f"b-{index}", "tail-b", "chapter-b") for index in range(7)],
        *[_span(f"c-{index}", "tail-c", "chapter-c") for index in range(5)],
    ]
    settings = {row["characterId"]: _settings() for row in identities}
    mapping = {name: name for name in ("lead", "tail-a", "tail-b", "tail-c")}
    policy = VoiceSharingPolicy(dedicated_dialogue_coverage=0.8)

    complete = plan_shared_voices(identities, settings, spans, mapping, policy)
    reversed_plan = plan_shared_voices(list(reversed(identities)), settings, spans, mapping, policy)
    limited = plan_shared_voices(
        identities,
        settings,
        spans,
        mapping,
        policy,
        shareable_character_ids={"tail-a", "tail-b"},
    )

    assert complete.groups[0].id == reversed_plan.groups[0].id
    assert limited.groups[0].character_ids == ("tail-a", "tail-b")
    assert limited.groups[0].id != complete.groups[0].id
