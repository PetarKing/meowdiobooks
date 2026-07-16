import pytest

from meowdiobooks.backend.recording_script import (
    RecordingScriptContractError,
    build_recording_script,
    recording_script_blockers,
    recording_script_matches,
    split_recording_script_chapter,
)


def _span(span_id, text, *, chapter="chapter-1", role="narration", label=None):
    row = {
        "id": span_id,
        "chapterId": chapter,
        "blockId": chapter,
        "sourceStart": 0,
        "sourceEnd": len(text),
        "source": text,
        "text": text,
        "renderRole": role,
        "speakerStatus": "explicit" if label else "not-applicable",
    }
    if label:
        row["sourceSpeakerLabel"] = label
    return row


def _upstream():
    dialogue = {
        "revision": "dialogue-1",
        "spans": [
            _span("s1", "Alice entered. "),
            _span("s2", "Hello!", role="dialogue", label="Alice"),
            _span("s3", " Appendix", chapter="chapter-2"),
        ],
    }
    review = {
        "revision": "review-1",
        "dialogueRevision": "dialogue-1",
        "canStartCast": True,
        "blockers": [],
    }
    cast = {
        "revision": "cast-1",
        "dialogueRevision": "dialogue-1",
        "reviewRevision": "review-1",
        "labelToCharacterId": {"Alice": "alice"},
        "identities": [{"characterId": "alice", "name": "Alice"}],
    }
    enrichment = {
        "revision": "enrichment-1",
        "dialogueRevisionId": "dialogue-1",
        "castRevisionId": "cast-1",
    }
    return dialogue, review, cast, enrichment


def test_builds_one_faithful_source_linked_script_from_accepted_inputs():
    dialogue, review, cast, enrichment = _upstream()

    script = build_recording_script(
        dialogue,
        review,
        cast,
        revision="script-1",
        enrichment=enrichment,
    )

    assert script["status"] == "ready"
    assert script["inputRevisions"] == {
        "dialogue": "dialogue-1",
        "review": "review-1",
        "cast": "cast-1",
        "enrichment": "enrichment-1",
    }
    assert all(row["kind"] == "source" for row in script["entries"])
    assert script["sourceCoverage"]["sourceSpanIds"] == ["s1", "s2", "s3"]
    assert script["summary"]["retainedSpans"] == 3
    assert script["summary"]["emptyChapterIds"] == []
    assert recording_script_blockers(script) == []
    assert recording_script_matches(script, dialogue, review, cast, enrichment)


def test_review_exclusions_become_explicit_omissions_and_empty_chapters():
    dialogue, review, cast, _enrichment = _upstream()
    dialogue["spans"][2].update(
        reviewAction="exclude",
        reviewOccurrenceId="warning:s3",
    )

    script = build_recording_script(dialogue, review, cast, revision="script-2")

    omission = next(row for row in script["entries"] if row["sourceSpanIds"] == ["s3"])
    assert omission == {
        **omission,
        "kind": "omission",
        "text": "",
        "sourceText": " Appendix",
        "provenance": "review:warning:s3:exclude",
    }
    assert script["summary"]["emptyChapterIds"] == ["chapter-2"]


def test_cache_match_requires_every_current_input_revision():
    dialogue, review, cast, enrichment = _upstream()
    script = build_recording_script(
        dialogue, review, cast, revision="script-1", enrichment=enrichment
    )

    enrichment["revision"] = "enrichment-2"

    assert not recording_script_matches(script, dialogue, review, cast, enrichment)


def test_superseded_or_blocked_inputs_fail_closed():
    dialogue, review, cast, enrichment = _upstream()
    review["canStartCast"] = False
    with pytest.raises(RecordingScriptContractError, match="progression blockers"):
        build_recording_script(dialogue, review, cast, revision="script")

    review["canStartCast"] = True
    cast["reviewRevision"] = "review-old"
    with pytest.raises(RecordingScriptContractError, match="accepted Review"):
        build_recording_script(dialogue, review, cast, revision="script")

    cast["reviewRevision"] = "review-1"
    enrichment["castRevisionId"] = "cast-old"
    with pytest.raises(RecordingScriptContractError, match="accepted Dialogue and Cast"):
        build_recording_script(
            dialogue, review, cast, revision="script", enrichment=enrichment
        )


def test_splits_a_long_script_chapter_into_balanced_source_safe_chapters():
    text = "A" * 9_000
    spans = [
        {
            **_span(f"s{index}", text),
            "blockId": f"b{index}",
            "page": index,
        }
        for index in range(1, 13)
    ]
    dialogue = {"revision": "dialogue-1", "spans": spans}
    review = {
        "revision": "review-1",
        "dialogueRevision": "dialogue-1",
        "canStartCast": True,
        "blockers": [],
        "chapters": [
            {
                "id": "chapter-1",
                "title": "Complete document",
                "startPage": 1,
                "endPage": 12,
            }
        ],
    }
    cast = {
        "revision": "cast-1",
        "dialogueRevision": "dialogue-1",
        "reviewRevision": "review-1",
        "labelToCharacterId": {},
    }
    script = build_recording_script(dialogue, review, cast, revision="script-1")

    split = split_recording_script_chapter(
        script,
        dialogue,
        cast,
        chapter_id="chapter-1",
        revision="script-2",
    )

    assert [row["id"] for row in split["chapters"]] == [
        "chapter-1--part-01",
        "chapter-1--part-02",
        "chapter-1--part-03",
        "chapter-1--part-04",
    ]
    assert [row["title"] for row in split["chapters"]] == [
        "Complete document · Part 1",
        "Complete document · Part 2",
        "Complete document · Part 3",
        "Complete document · Part 4",
    ]
    assert [(row["startPage"], row["endPage"]) for row in split["chapters"]] == [
        (1, 3),
        (4, 6),
        (7, 9),
        (10, 12),
    ]
    assert [row["estimatedSeconds"] for row in split["summary"]["chapters"]] == [
        1_800,
        1_800,
        1_800,
        1_800,
    ]
    assert split["sourceCoverage"] == script["sourceCoverage"]
    assert split["inputRevisions"] == script["inputRevisions"]
    assert {row["chapterId"] for row in split["entries"]} == {
        row["id"] for row in split["chapters"]
    }
