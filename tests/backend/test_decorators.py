import pytest

from meowdiobooks.backend.decorators import (
    STATE_VALUES,
    EnrichmentOptions,
    EnrichmentValidationError,
    plan_enrichment,
    skipped_enrichment,
    validate_enrichment_output,
)


def turns(count=6, chapter="chapter-1"):
    return [
        {
            "id": f"t{index}",
            "chapterId": chapter,
            "text": f"Source line {index} with enough text for planning.",
            "speakerId": "speaker-alice" if index % 2 else "narrator",
            "identityId": "alice" if index % 2 else "narrator",
        }
        for index in range(1, count + 1)
    ]


def complete_output(source_turns, *, ranges=None):
    return {
        "turnStates": [
            {
                "turnId": turn["id"],
                "state": "happy" if turn["speakerId"] != "narrator" else "neutral",
                "speakerId": turn["speakerId"],
                "identityId": turn["identityId"],
            }
            for turn in source_turns
        ],
        "rangeDecorators": ranges or [],
    }


def validate(source_turns, plan, output):
    return validate_enrichment_output(
        source_turns,
        plan,
        output,
        dialogue_revision_id="dialogue-r1",
        cast_revision_id="cast-r1",
    )


def test_state_contract_has_exactly_the_twelve_agreed_values():
    assert STATE_VALUES == (
        "neutral",
        "happy",
        "sad",
        "angry",
        "afraid",
        "surprised",
        "disgusted",
        "embarrassed",
        "determined",
        "confused",
        "pained",
        "tender",
    )


def test_skip_path_has_no_windows_or_model_work_and_does_not_affect_audio():
    plan = plan_enrichment(turns(), EnrichmentOptions(state=False))
    artifact = skipped_enrichment("dialogue-r1", "cast-r1")

    assert plan["status"] == "skipped"
    assert plan["windows"] == []
    assert plan["workload"]["modelLoad"] == "none"
    assert artifact["turnStates"] == []
    assert artifact["downstream"]["affectsSynthesizedSpeech"] is False
    assert artifact["downstream"]["audibleAmbienceImplemented"] is False


def test_plan_is_bounded_and_every_turn_has_one_owner():
    source = turns(7)
    plan = plan_enrichment(
        source,
        EnrichmentOptions(max_input_tokens=80, max_output_rows=2, overlap_turns=1),
    )
    owners = [turn_id for window in plan["windows"] for turn_id in window["ownerTurnIds"]]

    assert owners == [turn["id"] for turn in source]
    assert all(len(window["ownerTurnIds"]) <= 2 for window in plan["windows"])
    assert all(window["estimatedInputTokens"] <= 80 for window in plan["windows"])
    assert all(
        not set(window["ownerTurnIds"]) & set(window["contextTurnIds"])
        for window in plan["windows"]
    )
    assert plan["workload"]["totalTurns"] == 7
    assert plan["workload"]["expectedTurnRows"] == 7
    assert plan["workload"]["estimatedSeconds"] > 0


def test_windows_never_cross_chapters():
    source = turns(2, "chapter-1") + [
        {**turn, "id": f"c2-{turn['id']}", "chapterId": "chapter-2"} for turn in turns(2)
    ]
    plan = plan_enrichment(source, EnrichmentOptions(max_output_rows=10, overlap_turns=2))

    assert len(plan["windows"]) == 2
    assert all(
        all(
            next(turn for turn in source if turn["id"] == turn_id)["chapterId"]
            == window["chapterId"]
            for turn_id in window["inputTurnIds"]
        )
        for window in plan["windows"]
    )


def test_explicit_scenes_get_separate_contiguous_windows():
    source = turns(4)
    source[0]["sceneId"] = source[1]["sceneId"] = "scene-a"
    source[2]["sceneId"] = source[3]["sceneId"] = "scene-b"

    plan = plan_enrichment(source, EnrichmentOptions(max_output_rows=10, overlap_turns=2))

    assert [window["sceneId"] for window in plan["windows"]] == ["scene-a", "scene-b"]
    assert plan["windows"][0]["inputTurnIds"] == ["t1", "t2"]
    assert plan["windows"][1]["inputTurnIds"] == ["t3", "t4"]


def test_overlap_is_context_only_and_trimmed_to_input_budget():
    source = turns(5)
    plan = plan_enrichment(
        source,
        EnrichmentOptions(max_input_tokens=65, max_output_rows=2, overlap_turns=2),
    )

    assert any(window["contextTurnIds"] for window in plan["windows"])
    assert all(window["estimatedInputTokens"] <= 65 for window in plan["windows"])
    owners = [turn_id for window in plan["windows"] for turn_id in window["ownerTurnIds"]]
    assert len(owners) == len(set(owners)) == len(source)


def test_single_turn_over_input_budget_is_rejected():
    source = turns(1)
    source[0]["text"] = "x" * 500

    with pytest.raises(EnrichmentValidationError, match="exceeds"):
        plan_enrichment(source, EnrichmentOptions(max_input_tokens=20))


def test_complete_output_preserves_source_order_and_revision_independence():
    source = turns(3)
    plan = plan_enrichment(source)
    artifact = validate(source, plan, complete_output(source))

    assert artifact["status"] == "complete"
    assert [row["turnId"] for row in artifact["turnStates"]] == ["t1", "t2", "t3"]
    assert artifact["dialogueRevisionId"] == "dialogue-r1"
    assert artifact["castRevisionId"] == "cast-r1"
    assert "audioRevisionId" not in artifact
    assert artifact["downstream"]["affectsSynthesizedSpeech"] is False


@pytest.mark.parametrize("failure", ["missing", "duplicate", "invented"])
def test_invalid_or_incomplete_ids_fail_atomically(failure):
    source = turns(3)
    plan = plan_enrichment(source)
    output = complete_output(source)
    if failure == "missing":
        output["turnStates"].pop()
    elif failure == "duplicate":
        output["turnStates"].append(dict(output["turnStates"][0]))
    else:
        output["turnStates"][0]["turnId"] = "invented"

    with pytest.raises(EnrichmentValidationError):
        validate(source, plan, output)


def test_invalid_state_rejects_the_complete_output():
    source = turns(2)
    plan = plan_enrichment(source)
    output = complete_output(source)
    output["turnStates"][1]["state"] = "melancholy"

    with pytest.raises(EnrichmentValidationError, match="Invalid state"):
        validate(source, plan, output)


@pytest.mark.parametrize("locked_field", ["speakerId", "identityId"])
def test_enrichment_cannot_change_locked_speaker_or_identity(locked_field):
    source = turns(2)
    plan = plan_enrichment(source)
    output = complete_output(source)
    output["turnStates"][0][locked_field] = "rewritten-by-model"

    with pytest.raises(EnrichmentValidationError, match=f"locked {locked_field}"):
        validate(source, plan, output)


def test_valid_scene_ranges_are_source_anchored_and_may_be_empty():
    source = turns(4)
    options = EnrichmentOptions(ambience=True, effects=True)
    plan = plan_enrichment(source, options)
    output = complete_output(
        source,
        ranges=[
            {
                "kind": "ambience",
                "startTurnId": "t1",
                "endTurnId": "t4",
                "value": "wind through an old hall",
            },
            {
                "kind": "effect",
                "startTurnId": "t2",
                "endTurnId": "t2",
                "value": "door closes",
            },
        ],
    )

    artifact = validate(source, plan, output)

    assert len(artifact["rangeDecorators"]) == 2
    assert artifact["rangeDecorators"][0]["startTurnId"] == "t1"


@pytest.mark.parametrize(
    ("row", "message"),
    [
        (
            {"kind": "ambience", "startTurnId": "missing", "endTurnId": "t2", "value": "x"},
            "invented",
        ),
        (
            {"kind": "ambience", "startTurnId": "t3", "endTurnId": "t1", "value": "x"},
            "start follows",
        ),
        (
            {"kind": "ambience", "startTurnId": "t1", "endTurnId": "t2", "value": ""},
            "no value",
        ),
    ],
)
def test_invalid_scene_ranges_fail_atomically(row, message):
    source = turns(3)
    plan = plan_enrichment(source, EnrichmentOptions(ambience=True))

    with pytest.raises(EnrichmentValidationError, match=message):
        validate(source, plan, complete_output(source, ranges=[row]))


def test_scene_ranges_cannot_cross_chapter_boundaries():
    source = turns(2, "chapter-1") + [
        {**turns(1, "chapter-2")[0], "id": "t3", "chapterId": "chapter-2"}
    ]
    plan = plan_enrichment(source, EnrichmentOptions(ambience=True))
    output = complete_output(
        source,
        ranges=[
            {
                "kind": "ambience",
                "startTurnId": "t2",
                "endTurnId": "t3",
                "value": "rain",
            }
        ],
    )

    with pytest.raises(EnrichmentValidationError, match="chapter"):
        validate(source, plan, output)


def test_disabled_decorators_cannot_appear_in_output():
    source = turns(2)
    plan = plan_enrichment(source, EnrichmentOptions(ambience=False))
    output = complete_output(
        source,
        ranges=[
            {
                "kind": "ambience",
                "startTurnId": "t1",
                "endTurnId": "t2",
                "value": "rain",
            }
        ],
    )

    with pytest.raises(EnrichmentValidationError, match="disabled"):
        validate(source, plan, output)


def test_tampered_owner_plan_is_rejected_before_output_validation():
    source = turns(3)
    plan = plan_enrichment(source)
    plan["windows"][0]["ownerTurnIds"].pop()

    with pytest.raises(EnrichmentValidationError, match="own every turn"):
        validate(source, plan, complete_output(source))
