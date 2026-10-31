from pathlib import Path

import pytest
import json

from meowdiobooks.backend import chapter_semantic
from meowdiobooks.backend.chapter_partition import partition_chapter_headings
from meowdiobooks.backend.chapters import (
    ChapterContractError, chapter_span_position, compile_reviewed_chapters,
    detect_chapter_candidates, is_chapter_heading_hint, validate_chapter_candidates,
)
from meowdiobooks.backend.dialogue import scan_dialogue
from meowdiobooks.backend.dialogue_ai import resolve_dialogue


@pytest.mark.parametrize("heading", [
    "CHAPTER I", "Chapitre 2", "Kapitel 3", "Capitolo IV", "Capítulo 5",
    "Capítulo 6: O jardim", "Глава 7", "第八章", "第九章　帰還", "제10장",
])
def test_supported_language_hints_are_source_anchored(heading):
    blocks = [{"id": "b", "page": 1, "text": f"  {heading}  \n\nA long narrative sentence."}]
    assert is_chapter_heading_hint(heading)
    [candidate] = detect_chapter_candidates(blocks)
    assert blocks[0]["text"][candidate["sourceStart"]:candidate["sourceEnd"]] == heading
    assert validate_chapter_candidates(blocks, [candidate]) == [candidate]


def test_prose_line_and_repeated_running_headers_are_not_candidates():
    blocks = [{"id": str(i), "page": i, "text": "Глава 2\n\nOrdinary sentence."}
              for i in range(1, 5)]
    blocks += [{"id": "prose", "page": 5, "text": "He opened the book and read\nChapter 7 to her."}]
    assert not detect_chapter_candidates(blocks)


def test_dense_contents_are_local_candidates_for_semantic_confirmation():
    blocks = [{"id": str(i), "page": 1, "text": f"第{i}章"} for i in range(1, 5)]
    assert len(detect_chapter_candidates(blocks)) == 4


def test_model_cannot_invent_or_shift_a_boundary():
    blocks = [{"id": "b", "page": 1, "text": "CHAPTER I"}]
    [candidate] = detect_chapter_candidates(blocks)
    with pytest.raises(ChapterContractError):
        validate_chapter_candidates(blocks, [{**candidate, "sourceStart": 1}])
    with pytest.raises(ChapterContractError):
        validate_chapter_candidates(blocks, [candidate, candidate])


def _scan(text):
    return scan_dialogue([{"id": "b", "page": 1, "pageStart": 0, "text": text}])


def test_unpublished_narration_split_preserves_source_and_exact_chapter_position():
    text = "Opening prose.\n\nChapitre 2\n\nThe next story begins."
    scan = _scan(text)
    original = list(scan["partition"])
    draft = partition_chapter_headings(scan)
    assert scan["partition"] == original
    assert "".join(row["source"] for row in draft["partition"]) == text
    result = resolve_dialogue(draft, "narrate", lambda *_: "")
    [candidate] = detect_chapter_candidates(scan["blocks"])
    assert chapter_span_position(candidate, scan["partition"]) is None
    assert chapter_span_position(candidate, result["partition"]) == 1
    chapters = compile_reviewed_chapters(result["partition"], [candidate], [
        {"boundaryId": candidate["id"], "action": "chapter-start"},
    ])
    assert chapters["chapters"][0]["sourceSpanIds"] == [result["partition"][0]["id"]]
    assert partition_chapter_headings(draft) == draft


def test_does_not_split_quoted_or_transformed_source():
    scan = _scan("Opening.\n\nChapitre 2\n\nStory.")
    span = scan["partition"][0]
    for update in ({"renderRole": "dialogue"}, {"origin": "note"}, {"text": "rewritten"}):
        modified = {**scan, "partition": [{**span, **update}]}
        assert partition_chapter_headings(modified)["partition"] == modified["partition"]




def test_unanchorable_old_dialogue_abstains_without_a_paid_call(monkeypatch):
    scan = _scan("Opening prose.\n\nKapitel 2\n\nStory.")
    def fail(*args, **kwargs):
        pytest.fail("An unanchorable heading must not request semantic confirmation")
    monkeypatch.setattr(chapter_semantic, "remote_chat_completion", fail)
    review = chapter_semantic.confirm_chapter_candidates(Path("."), scan, {"spans": scan["partition"]}, None)
    assert review["boundaryCandidates"] == []
    assert "indivisible" in review["assessments"][0]["reason"]


def test_attribution_coalescing_keeps_draft_heading_anchor():
    from meowdiobooks.backend.dialogue_ai import _coalesce_narration

    scan = partition_chapter_headings(_scan("Opening prose.\n\n第十章\n\nStory."))
    assert len(_coalesce_narration(scan["partition"])) == 2




def test_contents_and_first_chapter_in_same_chunk_keep_actual_heading():
    text = "Contents\nChapter 1\nChapter 2\nChapter 3\n\nChapter 1\n\nA title\n\nThe narrative begins."
    rows = detect_chapter_candidates([{"id": "b", "page": 1, "text": text}])
    assert any(row["source"] == "Chapter 1" and row["sourceStart"] > 30 for row in rows)
    assert not any(row["source"] == "A title" for row in rows)


def test_actual_act_after_act_drop_is_not_a_subtitle():
    text = "[Exit actor.]\n\nACT DROP\n\nSECOND ACT\n\nSCENE\n\nA garden."
    rows = detect_chapter_candidates([{"id": "b", "page": 1, "text": text}])
    assert any(row["source"] == "SECOND ACT" for row in rows)


def test_indented_unlabelled_title_followed_by_prose_is_candidate():
    text = "        Unfamiliar Story Title\n        Subtitle\n      Narrative starts immediately here."
    [row] = detect_chapter_candidates([{"id": "b", "page": 1, "text": text}])
    assert row["source"] == "Unfamiliar Story Title"


def test_adjacent_block_subtitle_is_not_a_second_boundary():
    blocks = [{"id": "a", "page": 1, "text": "Chapitre 2\n\n"},
              {"id": "b", "page": 1, "text": "Le jardin\n\n"},
              {"id": "c", "page": 1, "text": "The story begins."}]
    assert [row["source"] for row in detect_chapter_candidates(blocks)] == ["Chapitre 2"]


def test_partition_keeps_whole_indented_numbered_footer_with_one_owner():
    from meowdiobooks.backend.review import numbered_edge_candidates

    blocks = [{"id": str(page), "page": page, "pageStart": 0,
               "text": f"A complete narrative paragraph.\n\n        印刷所 {page}"}
              for page in range(1, 5)]
    scan = partition_chapter_headings(scan_dialogue(blocks))
    for candidate in numbered_edge_candidates(blocks):
        owners = [row for row in scan["partition"] if row["blockId"] == candidate["blockId"]
                  and row["sourceStart"] <= candidate["sourceStart"]
                  and row["sourceEnd"] >= candidate["sourceEnd"]]
        assert len(owners) == 1
    assert len(numbered_edge_candidates(blocks)) == 4
    assert "".join(row["source"] for row in scan["partition"]) == "".join(b["text"] for b in blocks)




@pytest.mark.parametrize("labels", [["Chapitre 1", "Chapitre 2", "Chapitre 3"],
                                     ["第1章", "第2章", "第3章"],
                                     ["Kapitel 1", "Kapitel 2", "Kapitel 3"]])
def test_local_contents_list_never_suppresses_later_real_heading(labels):
    text = "\n".join(labels) + "\n\n" + labels[0] + "\n\nStory follows."
    rows = detect_chapter_candidates([{"id": "b", "page": 1, "text": text}])
    first = next(row for row in rows if row["sourceStart"] == 0)
    later = next(row for row in rows if row["source"] == labels[0] and row["sourceStart"] > 0)
    assert chapter_semantic._local_role(first, text, "story")[0] == "contents"
    assert chapter_semantic._local_role(later, text, "story") is None


def test_numeric_page_edge_abstains_without_semantic_request(monkeypatch):
    scan = _scan("Narrative prose.\n\n3")
    scan = partition_chapter_headings(scan)
    monkeypatch.setattr(chapter_semantic, "remote_chat_completion", lambda *a, **k: pytest.fail("page edge"))
    result = chapter_semantic.confirm_chapter_candidates(Path("."), scan, {"spans": scan["partition"]}, None)
    assert not result["boundaryCandidates"]
    assert result["assessments"][0]["role"] == "uncertain"




def test_cancellation_is_rechecked_before_transport_retry(monkeypatch):
    scan = _scan("Chapitre 2")
    cancelled = False
    admissions = []
    def check():
        if cancelled:
            raise RuntimeError("cancelled")
    def completion(*args, **kwargs):
        nonlocal cancelled
        kwargs["request_admission"](None, {"attempt": 1})
        cancelled = True
        kwargs["request_admission"](None, {"attempt": 2})
    monkeypatch.setattr(chapter_semantic, "remote_chat_completion", completion)
    with pytest.raises(RuntimeError, match="cancelled"):
        chapter_semantic.confirm_chapter_candidates(
            Path("."), scan, {"spans": scan["partition"]}, None,
            check_cancelled=check, request_admission=lambda config, metadata: admissions.append(metadata),
        )
    assert admissions == [{"attempt": 1}]






def test_verified_footer_family_skips_chapter_calls_and_replays_exact_coverage(monkeypatch):
    from meowdiobooks.backend.cleanup_patterns import (
        FAMILY_RULE_MODE, numbered_family_manifest, rule_group, rule_windows,
    )

    blocks = [{"id": str(page), "page": page, "pageStart": 0,
               "text": f"A complete narrative paragraph.\n\n        印刷所 {page}"}
              for page in range(1, 5)]
    extraction = {"method": "native", "blocks": blocks}
    scan = partition_chapter_headings(scan_dialogue(blocks))
    dialogue = {"spans": scan["partition"]}
    [family] = numbered_family_manifest(extraction, dialogue)
    screen = {"answers": [{"name": "family", "type": "choice", "choice": "FOOTER"}]}
    proof = {"assessments": [{"windowId": row["windowId"], "role": "FOOTER"}
                             for row in family["representatives"]], "reason": "Repeated printed folios."}
    group = rule_group(family, screen, proof)
    footer = {"patternAssessmentMode": FAMILY_RULE_MODE, "patternGroups": [group],
              "windows": rule_windows(family, group)}
    monkeypatch.setattr(chapter_semantic, "remote_chat_completion", lambda *a, **k: pytest.fail("verified footer must not call chapter API"))
    evidence = chapter_semantic.confirm_chapter_candidates(Path("."), extraction, dialogue, None, footer_evidence=footer)
    assert len(evidence["footerExclusions"]) == 4
    assert not evidence["boundaryCandidates"]
    assert chapter_semantic.validate_chapter_review(extraction, dialogue, evidence, footer_evidence=footer) == []
    with pytest.raises(ChapterContractError):
        chapter_semantic.validate_chapter_review(extraction, dialogue, evidence)
    tampered = {**evidence, "footerExclusions": {}}
    with pytest.raises(ChapterContractError):
        chapter_semantic.validate_chapter_review(extraction, dialogue, tampered, footer_evidence=footer)


def _mock_luna(role):
    def complete(_root, _config, _system, prompt, **kwargs):
        packet = json.loads(prompt)
        return {"text": json.dumps({"assessments": [
            {"boundaryId": row["boundaryId"], "role": role, "reason": "Source-context role."}
            for row in packet["targets"]]})}
    return complete


@pytest.mark.parametrize("role,accepted", [("chapter", 1), ("section", 0), ("contents", 0),
                                         ("running", 0), ("other", 0), ("uncertain", 0)])
def test_luna_roles_leave_nonchapters_unchanged(monkeypatch, role, accepted):
    scan = _scan("第十章\n\nA new story begins.")
    monkeypatch.setattr(chapter_semantic, "remote_chat_completion", _mock_luna(role))
    evidence = chapter_semantic.confirm_chapter_candidates(Path("."), scan, {"spans": scan["partition"]}, None)
    assert len(evidence["boundaryCandidates"]) == accepted
    assert evidence["assessments"][0]["role"] == role
    assert chapter_semantic.validate_chapter_review(scan, {"spans": scan["partition"]}, evidence) == evidence["boundaryCandidates"]


def test_luna_batch_failure_stops_queued_paid_requests(monkeypatch):
    blocks = [{"id": str(i), "page": i, "pageStart": 0, "text": f"Chapitre {i}"}
              for i in range(1, 8)]
    scan = scan_dialogue(blocks)
    calls = []
    def fail(*args, **kwargs):
        calls.append(args)
        return {"text": '{"assessments": []}'}
    monkeypatch.setattr(chapter_semantic, "MAX_REPAIR_REQUESTS", 1)
    monkeypatch.setattr(chapter_semantic, "MAX_BATCH_CANDIDATES", 1)
    monkeypatch.setattr(chapter_semantic, "remote_chat_completion", fail)
    with pytest.raises(ChapterContractError):
        chapter_semantic.confirm_chapter_candidates(Path("."), scan, {"spans": scan["partition"]}, None)
    assert len(calls) == 1


def test_admission_rejects_invented_context_missing_target_and_forged_roles(monkeypatch):
    from copy import deepcopy

    scan = _scan("第十章\n\nNarrative follows.")
    dialogue = {"spans": scan["partition"]}
    monkeypatch.setattr(chapter_semantic, "remote_chat_completion", _mock_luna("chapter"))
    evidence = chapter_semantic.confirm_chapter_candidates(Path("."), scan, dialogue, None)
    for mutate in [
        lambda e: e["batches"][0]["targets"][0].update(currentBlockAfter="invented story"),
        lambda e: e["batches"][0]["response"].update(assessments=[]),
        lambda e: e["assessments"][0].update(role="other"),
        lambda e: e.update(boundaryCandidates=[]),
    ]:
        broken = deepcopy(evidence)
        mutate(broken)
        with pytest.raises(ChapterContractError):
            chapter_semantic.validate_chapter_review(scan, dialogue, broken)


@pytest.mark.parametrize("response", [None, [], {"assessments": [{"boundaryId": "b", "role": [], "reason": "x"}]}])
def test_malformed_batch_answer_is_a_contract_error(response):
    with pytest.raises(ChapterContractError):
        chapter_semantic._batch_answers(response, [{"boundaryId": "b"}])


def test_neighbor_page_contents_is_separate_from_current_story_context():
    blocks = [{"id": "a", "page": 1, "pageStart": 0, "text": "Chapitre 2\n\nUne histoire commence."},
              {"id": "b", "page": 2, "pageStart": 0, "text": "Table des matières\n\nChapitre 2\nChapitre 3\nChapitre 4"}]
    scan = scan_dialogue(blocks)
    plan = chapter_semantic.chapter_review_plan(scan, {"spans": scan["partition"]})
    target = next(t for packet in plan["packets"] for t in packet if t["blockId"] == "a")
    assert "matières" not in target["currentBlockAfter"]
    assert target["nextBlock"]["page"] == 2 and "matières" in target["nextBlock"]["source"]


def test_batches_are_bounded_and_complete():
    blocks = [{"id": str(i), "page": i, "pageStart": 0, "text": f"Chapitre {i}"} for i in range(1, 52)]
    scan = scan_dialogue(blocks)
    plan = chapter_semantic.chapter_review_plan(scan, {"spans": scan["partition"]})
    assert [len(packet) for packet in plan["packets"]] == [24, 24, 3]


def _all_chapters_evidence(blocks, role="chapter"):
    scan = scan_dialogue(blocks)
    dialogue = {"spans": scan["partition"]}
    plan = chapter_semantic.chapter_review_plan(scan, dialogue)
    batches = [{"targets": packet, "response": {"assessments": [
        {"boundaryId": row["boundaryId"], "role": role, "reason": "Synthetic classification."}
        for row in packet]}} for packet in plan["packets"]]
    return scan, dialogue, chapter_semantic.assemble_chapter_review(plan, batches)


def test_wrapped_title_keeps_first_anchor_and_all_source_text():
    blocks = [{"id": "a", "page": 3, "text": "THE OPEN\n\n"},
              {"id": "b", "page": 3, "text": "   WINDOW\n\n"},
              {"id": "c", "page": 3, "text": "The story begins beside the window."}]
    scan, dialogue, evidence = _all_chapters_evidence(blocks)
    assert [row["source"] for row in evidence["boundaryCandidates"]] == ["THE OPEN"]
    assert evidence["titleContinuations"] == {"boundary:b:3-9": "boundary:a:0-8"}
    assert chapter_semantic.validate_chapter_review(scan, dialogue, evidence) == evidence["boundaryCandidates"]
    assert [row["text"] for row in scan["blocks"]] == [row["text"] for row in blocks]
    assert "".join(row["source"] for row in dialogue["spans"]) == "".join(row["text"] for row in blocks)
    evidence["titleContinuations"] = {}
    with pytest.raises(ChapterContractError):
        chapter_semantic.validate_chapter_review(scan, dialogue, evidence)


@pytest.mark.parametrize("second,page,between", [
    ("Chapter 2", 3, ""), ("II", 3, ""), ("OTHER TITLE", 4, ""),
    ("OTHER TITLE", 3, "Narrative belongs between these two headings.\n\n"),
])
def test_distinct_heading_boundaries_do_not_coalesce(second, page, between):
    blocks = [{"id": "a", "page": 3, "text": "THE OPEN WINDOW\n\n" + between},
              {"id": "b", "page": page, "text": second + "\n\nA new narrative begins."}]
    _, _, evidence = _all_chapters_evidence(blocks)
    assert len(evidence["boundaryCandidates"]) == 2
    assert evidence["titleContinuations"] == {}


def test_contents_roles_do_not_become_wrapped_chapter_boundaries():
    blocks = [{"id": "a", "page": 3, "text": "THE OPEN WINDOW\n\n"},
              {"id": "b", "page": 3, "text": "THE CLOSED DOOR\n\n"}]
    _, _, evidence = _all_chapters_evidence(blocks, "contents")
    assert evidence["boundaryCandidates"] == []
    assert evidence["titleContinuations"] == {}
