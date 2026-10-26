import pytest

from meowdiobooks.backend.chapters import (
    ChapterContractError,
    compile_reviewed_chapters,
    detect_chapter_candidates,
)


def _span(span_id, block_id, page, text):
    return {"id": span_id, "blockId": block_id, "page": page, "text": text, "source": text}


def test_drafts_structural_titles_without_deciding_their_semantic_role():
    blocks = [
        {"id": "p1-b1", "page": 1, "text": "Preface\n\n"},
        {"id": "p2-b1", "page": 2, "text": "CHAPTER I\nThe Rabbit Sends in a Little Bill"},
        {"id": "p3-b1", "page": 3, "text": "A SMALL DOOR\n\nOrdinary prose."},
        {"id": "p4-b1", "page": 4, "text": "Part 2: Down the Rabbit Hole"},
    ]

    candidates = detect_chapter_candidates(blocks)

    assert [row["source"] for row in candidates] == [
        "Preface",
        "CHAPTER I",
        "A SMALL DOOR",
        "Part 2: Down the Rabbit Hole",
    ]


def test_reviewed_boundaries_assign_every_span_and_preserve_opening_matter():
    spans = [
        _span("s1", "p1-b1", 1, "Title"),
        _span("s2", "p2-b1", 2, "CHAPTER I"),
        _span("s3", "p2-b2", 2, "First."),
        _span("s4", "p3-b1", 3, "CHAPTER II"),
        _span("s5", "p3-b2", 3, "Second."),
    ]
    candidates = detect_chapter_candidates(
        [
            {"id": "p2-b1", "page": 2, "text": "CHAPTER I"},
            {"id": "p3-b1", "page": 3, "text": "CHAPTER II"},
        ]
    )

    result = compile_reviewed_chapters(
        spans,
        candidates,
        [
            {"boundaryId": candidates[0]["id"], "action": "chapter-start"},
            {"boundaryId": candidates[1]["id"], "action": "chapter-start"},
        ],
    )

    assert [row["id"] for row in result["chapters"]] == [
        "opening-matter",
        "chapter-1",
        "chapter-2",
    ]
    assert result["chapters"][1]["sourceSpanIds"] == ["s2", "s3"]
    assert result["spanChapterIds"]["s5"] == "chapter-2"


def test_no_candidates_yields_a_complete_document_chapter():
    spans = [_span("s1", "p1-b1", 1, "One."), _span("s2", "p2-b1", 2, "Two.")]

    result = compile_reviewed_chapters(spans, [], [])

    assert result["chapters"][0]["id"] == "complete-document"
    assert result["chapters"][0]["sourceSpanIds"] == ["s1", "s2"]


def test_every_candidate_requires_an_explicit_review_decision():
    spans = [_span("s1", "p1-b1", 1, "CHAPTER I")]
    candidates = detect_chapter_candidates([{"id": "p1-b1", "page": 1, "text": "CHAPTER I"}])

    with pytest.raises(ChapterContractError, match="decisions are missing"):
        compile_reviewed_chapters(spans, candidates, [])


def test_drafts_arc_heading_and_leaves_contents_role_for_semantic_review():
    candidates = detect_chapter_candidates(
        [
            {
                "id": "p1-b1",
                "page": 1,
                "text": 'Arc 7, Chapter 40 – "The Last Gate"',
            },
            {"id": "p2-b1", "page": 2, "text": "CONTENTS\nChapter 1\nChapter 2\nChapter 3"},
        ]
    )

    assert [row["source"] for row in candidates] == ['Arc 7, Chapter 40 – "The Last Gate"']
