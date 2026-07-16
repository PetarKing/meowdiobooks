import pytest

from meowdiobooks.backend.review import (
    ReviewContractError,
    accept_review_revision,
    apply_review_render_policies,
    build_review_workspace,
    preview_bulk_decision,
    preview_review_transcript_page,
    review_progression_blockers,
)


def _span(block_id, start, end, source):
    return {
        "id": f"span:{block_id}:{start}-{end}",
        "blockId": block_id,
        "sourceStart": start,
        "sourceEnd": end,
        "source": source,
        "renderRole": "narration",
    }


def _artifacts(blocks, *, spans=None, warnings=None, boundaries=None):
    extraction = {
        "revision": "extract-1",
        "blocks": blocks,
        "warnings": warnings or [],
        "boundaryCandidates": boundaries or [],
    }
    if spans is None:
        spans = [_span(row["id"], 0, len(row["text"]), row["text"]) for row in blocks]
    dialogue = {
        "revision": "dialogue-1",
        "extractionRevision": "extract-1",
        "spans": spans,
    }
    return extraction, dialogue


def _warning(workspace, kind):
    return next(row for row in workspace["warnings"] if row["kind"] == kind)


def _single_decisions(workspace, overrides=None):
    overrides = overrides or {}
    decisions = []
    for warning in workspace["warnings"]:
        for occurrence in warning["occurrences"]:
            action = overrides.get(occurrence["id"])
            if action is None:
                action = (
                    "keep"
                    if "keep" in occurrence["availableActions"]
                    else occurrence["availableActions"][0]
                )
            decisions.append({"occurrenceIds": [occurrence["id"]], "action": action})
    return decisions


def test_detects_groups_with_exact_source_context_and_not_dialogue_identity_review():
    header = "Wonderland Edition"
    blocks = [
        {
            "id": "p1",
            "page": 1,
            "text": f"{header}\nCopyright 1865\nAlice saw � smoke and a bro-\nken sign.\n1\n",
        },
        {
            "id": "p2",
            "page": 2,
            "text": f"{header}\n[1] A footnote here.\nStory text.\n2\n",
        },
    ]
    extraction, dialogue = _artifacts(
        blocks,
        warnings=[{"kind": "reading-order", "blockId": "p2", "start": 0, "end": 18}],
        boundaries=[{"kind": "chapter-boundary", "blockId": "p2", "start": 19, "end": 39}],
    )

    workspace = build_review_workspace(extraction, dialogue)

    kinds = {row["kind"] for row in workspace["warnings"]}
    assert {
        "suspicious-extraction",
        "reading-order",
        "repeated-matter",
        "page-number",
        "footnote",
        "front-back-matter",
    } <= kinds
    assert not kinds & {"unknown-speaker", "alias", "dialogue", "attribution"}
    occurrence = _warning(workspace, "suspicious-extraction")["occurrences"][0]
    assert occurrence["source"] == "Alice saw � smoke and a bro-"
    assert occurrence["contextBefore"].endswith("Copyright 1865\n")
    assert occurrence["contextAfter"].startswith("\nken sign.")
    assert occurrence["blockId"] == "p1"
    assert workspace["sourceReconstruction"]["status"] == "exact"
    assert not any(row["kind"] == "boundary" for row in workspace["warnings"])


def test_narrator_override_is_only_offered_when_it_changes_the_reader():
    blocks = [{"id": "p1", "page": 1, "text": "Copyright 1865"}]
    extraction, narration = _artifacts(blocks)

    narrator_warning = _warning(
        build_review_workspace(extraction, narration), "front-back-matter"
    )

    assert narrator_warning["readerState"] == "narrator"
    assert narrator_warning["availableActions"] == ["keep", "exclude"]
    assert narrator_warning["occurrences"][0]["availableActions"] == [
        "keep",
        "exclude",
    ]

    dialogue_span = {
        **_span("p1", 0, len(blocks[0]["text"]), blocks[0]["text"]),
        "renderRole": "dialogue",
        "sourceSpeakerLabel": "Copyright",
        "resolvedSpeakerLabel": "Copyright",
        "speakerStatus": "resolved",
    }
    _, dialogue = _artifacts(blocks, spans=[dialogue_span])

    assigned_warning = _warning(
        build_review_workspace(extraction, dialogue), "front-back-matter"
    )

    assert assigned_warning["readerState"] == "assigned-speaker"
    assert assigned_warning["availableActions"] == ["keep", "narrate", "exclude"]

    mixed_dialogue = {
        **dialogue_span,
        "sourceEnd": 9,
        "source": blocks[0]["text"][:9],
    }
    mixed_narration = _span(
        "p1", 9, len(blocks[0]["text"]), blocks[0]["text"][9:]
    )
    _, mixed = _artifacts(blocks, spans=[mixed_dialogue, mixed_narration])

    mixed_warning = _warning(
        build_review_workspace(extraction, mixed), "front-back-matter"
    )

    assert mixed_warning["readerState"] == "mixed"
    assert mixed_warning["availableActions"] == ["keep", "narrate", "exclude"]


def test_empty_layout_fragments_are_not_reported_as_missing_content():
    blocks = [
        {"id": "p1-empty", "page": 1, "text": ""},
        {"id": "p1-story", "page": 1, "text": "Story text."},
        {"id": "p2-empty-a", "page": 2, "text": ""},
        {"id": "p2-empty-b", "page": 2, "text": ""},
    ]
    extraction, dialogue = _artifacts(blocks)

    workspace = build_review_workspace(extraction, dialogue)

    missing = _warning(workspace, "empty-page")["occurrences"]
    assert len(missing) == 1
    assert missing[0]["page"] == 2
    assert missing[0]["reason"] == "No text was extracted from this page."
    assert missing[0]["contextBefore"] == "Story text."


def test_numbered_chapter_list_is_not_misclassified_as_footnotes():
    blocks = [
        {
            "id": "toc",
            "page": 1,
            "text": (
                "1. Chapter 61: Welcome to the Island\n"
                "2. Chapter 62: The Island's Order\n"
                "[1] A genuine translation note.\n"
            ),
        }
    ]
    extraction, dialogue = _artifacts(blocks)

    workspace = build_review_workspace(extraction, dialogue)

    footnote = _warning(workspace, "footnote")
    assert [row["source"].strip() for row in footnote["occurrences"]] == [
        "[1] A genuine translation note."
    ]
    assert footnote["decisionScope"] == "warning-kind"
    assert footnote["bulkScope"] == "identical-evidence"


def test_explicit_note_section_groups_wrapped_lines_into_complete_footnotes():
    text = (
        "Story text.\n"
        "Translation notes:\n"
        "  [1] Clothing reference https://example.test/Ki-\n"
        "mono#Layering\n"
        "  [2] A single-line note.\n"
    )
    extraction, dialogue = _artifacts([{"id": "p1", "page": 1, "text": text}])

    workspace = build_review_workspace(extraction, dialogue)
    footnotes = _warning(workspace, "footnote")["occurrences"]

    assert [row["source"] for row in footnotes] == [
        "  [1] Clothing reference https://example.test/Ki-\nmono#Layering",
        "  [2] A single-line note.",
    ]


def test_web_addresses_are_source_anchored_without_sentence_punctuation():
    text = (
        "Project page: https://example.test/books/11?lang=en#sample.\n"
        "Mirror (www.example.test/archive).\n"
        "A bare example.test domain stays ordinary prose.\n"
    )
    extraction, dialogue = _artifacts([{"id": "p1", "page": 1, "text": text}])

    workspace = build_review_workspace(extraction, dialogue)
    warning = _warning(workspace, "web-address")

    assert warning["availableActions"] == ["keep", "exclude"]
    assert [row["source"] for row in warning["occurrences"]] == [
        "https://example.test/books/11?lang=en#sample",
        "www.example.test/archive",
    ]


def test_nested_web_address_policy_overrides_only_its_exact_footnote_range():
    text = "Translation Notes:\n[1] Details at https://example.test/source for readers.\n"
    extraction, dialogue = _artifacts([{"id": "p1", "page": 1, "text": text}])
    workspace = build_review_workspace(extraction, dialogue)
    footnote = _warning(workspace, "footnote")["occurrences"][0]
    web_address = _warning(workspace, "web-address")["occurrences"][0]
    review = {
        "warningSnapshot": workspace["warnings"],
        "decisions": [
            {"occurrenceId": footnote["id"], "action": "narrate"},
            {"occurrenceId": web_address["id"], "action": "exclude"},
        ],
    }

    rendered = apply_review_render_policies(dialogue, review)

    assert "".join(row["source"] for row in rendered["spans"]) == text
    assert [row["source"] for row in rendered["spans"] if row["reviewAction"] == "exclude"] == [
        "https://example.test/source"
    ]


def test_note_continuation_crosses_adjacent_page_and_stops_at_chapter_heading():
    blocks = [
        {
            "id": "p1",
            "page": 1,
            "text": "Translation Note:\n[1] Several terms translate as the\n",
        },
        {
            "id": "p2",
            "page": 2,
            "text": "same word in English.\n[2] Another note.\n",
        },
        {
            "id": "p3",
            "page": 3,
            "text": "Chapter 2\nStory text continues.\n",
        },
    ]
    extraction, dialogue = _artifacts(blocks)

    workspace = build_review_workspace(extraction, dialogue)
    footnotes = _warning(workspace, "footnote")["occurrences"]

    assert [row["source"] for row in footnotes] == [
        "[1] Several terms translate as the",
        "same word in English.",
        "[2] Another note.",
    ]
    assert not any("Chapter 2" in row["source"] for row in footnotes)


def test_note_section_without_an_immediate_note_does_not_capture_later_text():
    blocks = [
        {"id": "p1", "page": 1, "text": "Translation notes:\n"},
        {"id": "p2", "page": 2, "text": "Story text.\n[1] Isolated marker.\nMore story.\n"},
    ]
    extraction, dialogue = _artifacts(blocks)

    workspace = build_review_workspace(extraction, dialogue)
    footnotes = _warning(workspace, "footnote")["occurrences"]

    assert [row["source"] for row in footnotes] == ["[1] Isolated marker."]


def test_excluding_wrapped_footnote_removes_its_continuation_from_preview():
    text = "Translation note:\n[1] A linked ref Ki-\nmono#Layering\n"
    extraction, dialogue = _artifacts([{"id": "p1", "page": 1, "text": text}])
    workspace = build_review_workspace(extraction, dialogue)
    footnote = _warning(workspace, "footnote")

    preview = preview_review_transcript_page(
        extraction,
        dialogue,
        workspace,
        [
            {
                "warningId": warning["id"],
                "action": "exclude" if warning["id"] == footnote["id"] else "keep",
            }
            for warning in workspace["warnings"]
        ],
        page=1,
    )

    assert [row["kind"] for row in preview["spans"]] == ["narration", "excluded"]
    assert preview["spans"][-1]["text"] == "[1] A linked ref Ki-\nmono#Layering"


def test_unanchored_page_warning_does_not_turn_whole_prose_block_into_editable_evidence():
    blocks = [{"id": "p1", "page": 1, "text": "Decorative mark\nActual novel prose."}]
    extraction, dialogue = _artifacts(
        blocks,
        warnings=[{"code": "line-hyphenation", "page": 1, "label": "Possible hyphenation"}],
    )

    workspace = build_review_workspace(extraction, dialogue)

    assert not any(row["kind"] == "suspicious-extraction" for row in workspace["warnings"])


def test_empty_source_and_malformed_dialogue_coverage_are_unwaivable_blockers():
    blocks = [
        {"id": "p1", "page": 1, "text": "Alpha beta"},
        {"id": "p2", "page": 2, "text": ""},
    ]
    extraction, dialogue = _artifacts(
        blocks,
        spans=[_span("p1", 0, 5, "Alpha"), _span("p2", 0, 0, "")],
    )
    workspace = build_review_workspace(extraction, dialogue)

    assert workspace["sourceReconstruction"]["status"] == "failed"
    assert _warning(workspace, "empty-page")["severity"] == "blocking"
    assert workspace["recovery"]["kind"] == "source-coverage"
    assert workspace["recovery"]["availableActions"] == [
        "rerun-dialogue",
        "rerun-extraction",
    ]
    assert workspace["recovery"]["occurrences"][0]["kind"] == "malformed-coverage"

    review = accept_review_revision(
        workspace,
        _single_decisions(workspace),
        revision="review-1",
    )
    assert review["canStartCast"] is False
    assert "Restore exact Extraction-to-Dialogue source coverage" in review["blockers"]
    assert review["requiresNewUpstreamRevision"] is False


def test_bulk_identical_decision_requires_preview_and_records_consequences():
    blocks = [
        {"id": "p1", "page": 1, "text": "Wonderland Edition\nStory\n"},
        {"id": "p2", "page": 2, "text": "Wonderland Edition\nMore story\n"},
    ]
    extraction, dialogue = _artifacts(blocks)
    workspace = build_review_workspace(extraction, dialogue)
    occurrences = _warning(workspace, "repeated-matter")["occurrences"]
    preview = preview_bulk_decision(workspace, occurrences[0]["id"], "exclude")

    assert preview["targetOccurrenceIds"] == sorted(row["id"] for row in occurrences)
    assert preview["affectedCount"] == 2
    assert preview["consequence"]["audio"] == "excluded"
    with pytest.raises(ReviewContractError, match="matching consequence preview"):
        accept_review_revision(
            workspace,
            [{"occurrenceIds": preview["targetOccurrenceIds"], "action": "exclude"}],
            revision="review-1",
        )

    review = accept_review_revision(
        workspace,
        [
            {
                "occurrenceIds": preview["targetOccurrenceIds"],
                "action": "exclude",
                "previewToken": preview["previewToken"],
            }
        ],
        revision="review-1",
    )
    assert review["canStartCast"] is True
    assert review["consequencePreview"]["byAction"] == {"exclude": 2}
    assert review["consequencePreview"]["sourcePreserved"] is True


def test_final_transcript_preview_applies_policies_and_keeps_speaker_cues():
    blocks = [{"id": "p1", "page": 1, "text": "Alice: Hello\n12\n"}]
    spans = [
        {
            **_span("p1", 0, 13, "Alice: Hello\n"),
            "page": 1,
            "renderRole": "dialogue",
            "text": "\n  Hello  \n",
            "resolvedSpeakerLabel": "Alice",
        },
        {**_span("p1", 13, 16, "12\n"), "page": 1, "text": "12\n"},
    ]
    extraction, dialogue = _artifacts(blocks, spans=spans)
    workspace = build_review_workspace(extraction, dialogue)
    page_number = _warning(workspace, "page-number")

    preview = preview_review_transcript_page(
        extraction,
        dialogue,
        workspace,
        [
            {
                "warningId": warning["id"],
                "action": "exclude" if warning["id"] == page_number["id"] else "keep",
            }
            for warning in workspace["warnings"]
        ],
        page=1,
    )

    assert preview["pageCount"] == 1
    assert preview["spans"][0]["kind"] == "dialogue"
    assert preview["spans"][0]["reader"] == "Alice"
    assert preview["spans"][0]["text"] == "Hello"
    assert preview["spans"][-1]["kind"] == "excluded"
    assert preview["spans"][-1]["text"] == "12"
    assert preview["spans"][-1]["warningKind"] == "page-number"
    assert preview["summary"] == {"spoken": 1, "dialogue": 1, "excluded": 1}


def test_final_transcript_preview_matches_renderer_for_symbol_only_speech():
    blocks = [{"id": "p1", "page": 1, "text": "----"}]
    spans = [
        {
            **_span("p1", 0, 4, "----"),
            "page": 1,
            "renderRole": "dialogue",
            "text": "----",
            "resolvedSpeakerLabel": "Alice",
        }
    ]
    extraction, dialogue = _artifacts(blocks, spans=spans)
    workspace = build_review_workspace(extraction, dialogue)

    preview = preview_review_transcript_page(
        extraction,
        dialogue,
        workspace,
        [
            {"warningId": warning["id"], "action": "keep"}
            for warning in workspace["warnings"]
        ],
        page=1,
    )

    assert preview["spans"] == []
    assert preview["summary"] == {"spoken": 0, "dialogue": 0, "excluded": 0}


def test_final_transcript_preview_shows_unresolved_dialogue_as_narrator():
    blocks = [{"id": "p1", "page": 1, "text": '"Hello"'}]
    spans = [
        {
            **_span("p1", 0, 7, '"Hello"'),
            "page": 1,
            "renderRole": "dialogue",
            "text": "Hello",
            "resolvedSpeakerLabel": "?",
            "speakerStatus": "unresolved",
            "fallback": "narrator",
        }
    ]
    extraction, dialogue = _artifacts(blocks, spans=spans)
    workspace = build_review_workspace(extraction, dialogue)

    preview = preview_review_transcript_page(
        extraction,
        dialogue,
        workspace,
        [{"warningId": warning["id"], "action": "keep"} for warning in workspace["warnings"]],
        page=1,
    )

    assert preview["spans"][0]["reader"] == "Narrator"


def test_bulk_decision_rejects_mixed_evidence_even_with_computed_token():
    blocks = [{"id": "p1", "page": 1, "text": "A � word.\n1\n"}]
    extraction, dialogue = _artifacts(blocks)
    workspace = build_review_workspace(extraction, dialogue)
    occurrences = [row for warning in workspace["warnings"] for row in warning["occurrences"]]
    mixed = [occurrences[0]["id"], occurrences[-1]["id"]]

    with pytest.raises(ReviewContractError, match="identical warning evidence"):
        accept_review_revision(
            workspace,
            [
                {
                    "occurrenceIds": mixed,
                    "action": "defer",
                    "previewToken": "irrelevant",
                }
            ],
            revision="review-1",
        )


def test_defer_is_not_a_supported_new_review_decision():
    blocks = [{"id": "p1", "page": 1, "text": "A � word."}]
    extraction, dialogue = _artifacts(blocks)
    workspace = build_review_workspace(extraction, dialogue)
    decisions = _single_decisions(workspace)
    decisions[0]["action"] = "defer"

    with pytest.raises(ReviewContractError, match="not supported"):
        accept_review_revision(workspace, decisions, revision="review-1")


def test_repeated_body_paragraphs_are_not_misclassified_as_page_furniture():
    blocks = [
        {"id": "p1-head", "page": 1, "text": "Alice in Wonderland\n\n"},
        {"id": "p1-body", "page": 1, "text": "The room was quiet.\n\n"},
        {"id": "p1-foot", "page": 1, "text": "1\n"},
        {"id": "p2-head", "page": 2, "text": "Alice in Wonderland\n\n"},
        {"id": "p2-body", "page": 2, "text": "The room was quiet.\n\n"},
        {"id": "p2-foot", "page": 2, "text": "2\n"},
    ]
    extraction, dialogue = _artifacts(blocks)

    workspace = build_review_workspace(extraction, dialogue)

    repeated = _warning(workspace, "repeated-matter")["occurrences"]
    assert {row["source"].strip() for row in repeated} == {"Alice in Wonderland"}
    assert all("body" not in row["blockId"] for row in repeated)


def test_repeated_dialogue_with_decorative_dashes_is_not_page_furniture():
    blocks = [
        {"id": "p1", "page": 1, "text": "Story\nTodd: [----]\n"},
        {"id": "p2", "page": 2, "text": "More story\nTodd: [----]\n"},
    ]
    extraction, dialogue = _artifacts(blocks)

    workspace = build_review_workspace(extraction, dialogue)

    assert not any(row["kind"] == "repeated-matter" for row in workspace["warnings"])


def test_no_silent_defaults_and_receipt_is_history_ready_and_linked():
    blocks = [{"id": "p1", "page": 1, "text": "Alice saw � smoke."}]
    extraction, dialogue = _artifacts(blocks)
    workspace = build_review_workspace(extraction, dialogue)

    with pytest.raises(ReviewContractError, match="No silent defaults"):
        accept_review_revision(workspace, [], revision="review-1")

    review = accept_review_revision(
        workspace,
        _single_decisions(workspace),
        revision="review-1",
    )
    assert review["contract"] == "meowdiobooks.review.v2"
    assert review["extractionRevision"] == "extract-1"
    assert review["dialogueRevision"] == "dialogue-1"
    assert review["warningSnapshot"] == workspace["warnings"]
    assert review["receipt"]["occurrencesReviewed"] == 1
    assert len(review["receipt"]["decisionDigest"]) == 64
    assert review_progression_blockers(review) == []


def test_review_rejects_dialogue_linked_to_another_extraction():
    extraction, dialogue = _artifacts([{"id": "p1", "page": 1, "text": "Text"}])
    dialogue["extractionRevision"] = "extract-old"

    with pytest.raises(ReviewContractError, match="does not reference"):
        build_review_workspace(extraction, dialogue)


@pytest.mark.parametrize(
    ("kind", "action"),
    [
        ("empty-page", "rerun-extraction"),
        ("empty-page", "keep"),
        ("suspicious-extraction", "keep"),
        ("suspicious-extraction", "narrate"),
        ("suspicious-extraction", "exclude"),
        ("suspicious-extraction", "rerun-extraction"),
        ("reading-order", "keep"),
        ("reading-order", "rerun-extraction"),
        ("repeated-matter", "keep"),
        ("repeated-matter", "exclude"),
        ("page-number", "keep"),
        ("page-number", "exclude"),
        ("web-address", "keep"),
        ("web-address", "exclude"),
        ("footnote", "keep"),
        ("footnote", "narrate"),
        ("footnote", "exclude"),
        ("front-back-matter", "keep"),
        ("front-back-matter", "narrate"),
        ("front-back-matter", "exclude"),
    ],
)
def test_every_declared_local_action_is_executable(kind, action):
    occurrence_id = f"review:{kind}:p1:0-1"
    workspace = {
        "extractionRevision": "extract-1",
        "dialogueRevision": "dialogue-1",
        "sourceReconstruction": {"status": "exact"},
        "warnings": [
            {
                "id": f"review:{kind}",
                "kind": kind,
                "severity": "blocking"
                if kind == "empty-page"
                else "warning",
                "occurrences": [
                    {
                        "id": occurrence_id,
                        "warningId": f"review:{kind}",
                        "kind": kind,
                        "severity": (
                            "blocking"
                            if kind == "empty-page"
                            else "warning"
                        ),
                        "availableActions": [action],
                        "matchKey": "same",
                    }
                ],
            }
        ],
    }

    review = accept_review_revision(
        workspace,
        [{"occurrenceIds": [occurrence_id], "action": action}],
        revision="review-1",
    )

    assert review["decisions"][0]["action"] == action
    assert review["decisions"][0]["consequence"]["sourcePreserved"] is True


def test_user_can_confirm_an_intentionally_blank_page_after_visual_review():
    extraction, dialogue = _artifacts([{"id": "p1", "page": 1, "text": ""}])
    workspace = build_review_workspace(extraction, dialogue)
    occurrence = _warning(workspace, "empty-page")["occurrences"][0]

    review = accept_review_revision(
        workspace,
        [{"occurrenceIds": [occurrence["id"]], "action": "keep"}],
        revision="review-blank-confirmed",
    )

    assert review["canStartCast"] is True
    assert review["decisions"][0]["action"] == "keep"


def test_review_exclude_splits_narration_source_exactly_and_marks_only_target_range():
    dialogue = {
        "revision": "dialogue-1",
        "spans": [_span("p1", 0, 17, "HeaderStory text.")],
    }
    review = {
        "warningSnapshot": [
            {
                "occurrences": [
                    {
                        "id": "o1",
                        "blockId": "p1",
                        "sourceStart": 0,
                        "sourceEnd": 6,
                    }
                ]
            }
        ],
        "decisions": [{"occurrenceId": "o1", "action": "exclude"}],
    }

    result = apply_review_render_policies(dialogue, review)

    assert "".join(row["source"] for row in result["spans"]) == "HeaderStory text."
    assert result["spans"][0]["text"] == ""
    assert result["spans"][0]["reviewAction"] == "exclude"
    assert result["spans"][1]["text"] == "Story text."


@pytest.mark.parametrize(("action", "expected_text"), [("exclude", ""), ("narrate", "12")])
def test_review_policy_splits_dialogue_without_losing_source_or_speaker(
    action, expected_text
):
    dialogue = {
        "revision": "dialogue-1",
        "spans": [
            {
                **_span("p1", 0, 18, "Alice: Hello\n12\n"),
                "renderRole": "dialogue",
                "sourceSpeakerLabel": "Alice",
                "resolvedSpeakerLabel": "Alice",
                "speakerStatus": "resolved",
            }
        ],
    }
    review = {
        "warningSnapshot": [
            {
                "occurrences": [
                    {
                        "id": "page-number-1",
                        "blockId": "p1",
                        "sourceStart": 13,
                        "sourceEnd": 15,
                    }
                ]
            }
        ],
        "decisions": [{"occurrenceId": "page-number-1", "action": action}],
    }

    result = apply_review_render_policies(dialogue, review)

    assert "".join(row["source"] for row in result["spans"]) == "Alice: Hello\n12\n"
    assert [row["renderRole"] for row in result["spans"]] == [
        "dialogue",
        "narration",
        "dialogue",
    ]
    assert result["spans"][1]["text"] == expected_text
    assert result["spans"][1]["reviewAction"] == action
    assert result["spans"][0]["resolvedSpeakerLabel"] == "Alice"
    assert result["spans"][2]["resolvedSpeakerLabel"] == "Alice"
