"""Accepted page seams change only compatible rendered speech, never source evidence."""

from copy import deepcopy

import pytest

from meowdiobooks.backend import recording_script
from meowdiobooks.backend.recording_script import (
    RecordingScriptContractError,
    build_recording_script,
    split_recording_script_chapter,
)
from meowdiobooks.backend.render_plan import RenderPlanError, compile_render_plan
from test_render_plan import _artifacts, _span


def _inputs(
    monkeypatch, left="She saw her", right="eyes close.", action="SPACE", *, role="narration"
):
    dialogue, cast, _ = _artifacts()
    dialogue["spans"] = [
        _span("s1", left, 0, role=role, label="Alice" if role == "dialogue" else None),
        {
            **_span("s2", right, 0, role=role, label="Alice" if role == "dialogue" else None),
            "blockId": "b2",
        },
    ]
    lsource = left.rsplit(" ", 1)[-1]
    rsource = right.split(" ", 1)[0].rstrip(".")
    anchors = [
        {
            "blockId": "b1",
            "spanId": "s1",
            "sourceStart": len(left) - len(lsource),
            "sourceEnd": len(left),
            "source": lsource,
            "page": 1,
        },
        {
            "blockId": "b2",
            "spanId": "s2",
            "sourceStart": 0,
            "sourceEnd": len(rsource),
            "source": rsource,
            "page": 2,
        },
    ]
    repair = {
        "occurrenceId": "boundary-1",
        "windowId": "w1",
        "anchors": anchors,
        "boundaryDecision": action,
        "source": lsource + rsource,
        "replacement": lsource.rstrip("-\u00ad")
        + {"SPACE": " ", "JOIN": "", "HYPHEN": "-"}[action]
        + rsource,
    }
    monkeypatch.setattr(recording_script, "accepted_boundary_repairs", lambda _review: [repair])
    review = {
        "revision": "review-1",
        "dialogueRevision": "dialogue-1",
        "canStartCast": True,
        "blockers": [],
    }
    return dialogue, cast, review, repair


@pytest.mark.parametrize(
    "left,right,action,expected",
    [
        ("She saw her", "eyes close.", "SPACE", "She saw her eyes close."),
        ("A fair num-", "ber survived.", "JOIN", "A fair number survived."),
        ("The black-", "haired child.", "HYPHEN", "The black-haired child."),
    ],
)
@pytest.mark.parametrize("role", ["narration", "dialogue"])
def test_accepted_boundary_preserves_source_and_changes_exact_spoken_seam(
    monkeypatch, left, right, action, expected, role
):
    dialogue, cast, review, repair = _inputs(monkeypatch, left, right, action, role=role)
    original = deepcopy(dialogue)
    script = build_recording_script(dialogue, review, cast, revision="script-1")
    assert dialogue == original
    assert [row["text"] for row in script["entries"]] == [left, right]
    assert [row["sourceText"] for row in script["entries"]] == [left, right]
    assert script["boundaryRepairs"][0]["anchors"] == repair["anchors"]
    (segment,) = compile_render_plan(dialogue, cast, script, ["chapter-1"])["chapters"][0][
        "segments"
    ]
    assert segment["text"] == expected
    assert segment["sourceSpanIds"] == ["s1", "s2"]
    assert segment["scriptEntryIds"] == ["script:s1", "script:s2"]


def test_unaccepted_boundary_keeps_existing_source_concatenation(monkeypatch):
    dialogue, cast, review, _ = _inputs(monkeypatch)
    monkeypatch.setattr(recording_script, "accepted_boundary_repairs", lambda _review: [])
    script = build_recording_script(dialogue, review, cast, revision="script-1")
    assert script["boundaryRepairs"] == []
    assert (
        compile_render_plan(dialogue, cast, script, ["chapter-1"])["chapters"][0]["segments"][0][
            "text"
        ]
        == "She saw hereyes close."
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "source",
        "offset",
        "omission",
        "edit",
        "chapter",
        "role",
        "speaker",
        "overlap",
        "replacement",
    ],
)
def test_stale_or_conflicting_repair_fails_before_rendering(monkeypatch, mutation):
    dialogue, cast, review, _ = _inputs(monkeypatch)
    script = build_recording_script(dialogue, review, cast, revision="script-1")
    repair = script["boundaryRepairs"][0]
    if mutation == "source":
        repair["anchors"][0]["source"] = "his"
    if mutation == "offset":
        repair["anchors"][0]["sourceStart"] -= 1
    if mutation == "omission":
        script["entries"][1]["kind"] = "omission"
    if mutation == "edit":
        script["entries"][0]["text"] = "She saw him"
    if mutation == "chapter":
        script["entries"][1]["chapterId"] = "other"
    if mutation == "role":
        for span in dialogue["spans"]:
            span["renderRole"] = "dialogue"
    if mutation == "speaker":
        for span in dialogue["spans"]:
            span["sourceSpeakerLabel"] = "Alice"
    if mutation == "overlap":
        script["boundaryRepairs"].append(deepcopy(repair))
    if mutation == "replacement":
        repair["replacement"] = "rewritten sentence"
    with pytest.raises(RenderPlanError, match="Boundary|boundary"):
        compile_render_plan(dialogue, cast, script, ["chapter-1"])


def test_script_build_rejects_exclusion_at_accepted_boundary(monkeypatch):
    dialogue, cast, review, _ = _inputs(monkeypatch)
    dialogue["spans"][1]["reviewAction"] = "exclude"
    with pytest.raises(RecordingScriptContractError, match="exclusion"):
        build_recording_script(dialogue, review, cast, revision="script-1")


def test_layered_voice_cannot_silently_skip_accepted_boundary(monkeypatch):
    dialogue, cast, review, _ = _inputs(monkeypatch, role="dialogue")
    for span in dialogue["spans"]:
        span["speakerLabels"] = ["Alice", "Rabbit"]
    script = build_recording_script(dialogue, review, cast, revision="script-1")
    with pytest.raises(RenderPlanError, match="voice routing"):
        compile_render_plan(dialogue, cast, script, ["chapter-1"])


def test_chapter_split_keeps_boundary_pair_together(monkeypatch):
    dialogue, cast, review, _ = _inputs(monkeypatch)
    dialogue["spans"].append({**_span("s3", "Next scene.", 0), "blockId": "b3"})
    script = build_recording_script(dialogue, review, cast, revision="script-1")
    split = split_recording_script_chapter(
        script,
        dialogue,
        cast,
        chapter_id="chapter-1",
        revision="split",
        target_seconds=1,
        minimum_seconds=1,
    )
    assert split["entries"][0]["chapterId"] == split["entries"][1]["chapterId"]
    assert split["entries"][1]["chapterId"] != split["entries"][2]["chapterId"]
    chapters = compile_render_plan(dialogue, cast, split, [r["id"] for r in split["chapters"]])[
        "chapters"
    ]
    assert chapters[0]["segments"][0]["text"] == "She saw her eyes close."


def test_real_review_receipt_reaches_script_and_reopens_only_changed_audio(monkeypatch, tmp_path):
    from test_boundary_review import review_workspace
    from test_generation_status import _publish, _stale
    from meowdiobooks.backend.review import accept_review_revision

    _extraction, dialogue, workspace = review_workspace(monkeypatch)
    _, cast, _ = _artifacts()
    rows = [row for warning in workspace["warnings"] for row in warning["occurrences"]]
    keep = accept_review_revision(
        workspace, [{"occurrenceIds": [row["id"]], "action": "keep"} for row in rows], revision="r1"
    )
    repaired = accept_review_revision(
        workspace,
        [
            {
                "occurrenceIds": [row["id"]],
                "action": "repair" if row.get("boundaryDecision") else "keep",
            }
            for row in rows
        ],
        revision="r2",
    )
    for accepted in (keep, repaired):
        accepted["spanChapterIds"] = {row["id"]: row["chapterId"] for row in dialogue["spans"]}
    inputs = {"dialogue": dialogue, "review": keep, "cast": cast}
    pinned = _publish(tmp_path, inputs, "1")
    inputs["review"] = repaired
    current = _publish(tmp_path, inputs, "2")
    chapter = next(iter(repaired["spanChapterIds"].values()))
    assert _stale(tmp_path, pinned, current, chapter)
    reaccepted = _publish(tmp_path, inputs, "3")
    assert _stale(tmp_path, current, reaccepted, chapter) == []
