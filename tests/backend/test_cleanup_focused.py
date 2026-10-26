"""Focused inference must preserve complete units and source ownership."""
import json
from copy import deepcopy
from pathlib import Path

import pytest

from meowdiobooks.backend import cleanup_remote as cleanup
from meowdiobooks.backend.cleanup_candidates import editorial_candidates
from meowdiobooks.backend.cleanup_editorial import verified_editorial_occurrences


def artifacts(texts):
    blocks = [{"id": f"b{i}", "page": i + 1, "text": text} for i, text in enumerate(texts)]
    spans = [{"id": f"s{i}", "blockId": block["id"], "renderRole": "narration",
              "sourceStart": 0, "sourceEnd": len(block["text"]), "source": block["text"]}
             for i, block in enumerate(blocks)]
    return {"blocks": blocks}, {"spans": spans}


def fake_models(monkeypatch, *, production="review", complete=True, role="EDITORIAL"):
    calls = {"decisions": [], "luna": []}
    def decisions(root, config, prompt, questions, **kwargs):
        calls["decisions"].append(json.loads(prompt))
        return {"answers": [{"type": "choice", "name": "production", "choice": production},
                            {"type": "choice", "name": "word_damage", "choice": "clean"}]}
    def luna(root, config, system, prompt, **kwargs):
        payload = json.loads(prompt)
        calls["luna"].append(payload)
        return {"text": json.dumps({"assessments": [
            {"windowId": row["windowId"], "role": role, "complete": complete}
            for row in payload["examples"]], "reason": "Complete non-story unit."})}
    monkeypatch.setattr(cleanup, "remote_decisions_completion", decisions)
    monkeypatch.setattr(cleanup, "remote_chat_completion", luna)
    monkeypatch.setattr(cleanup, "review_hyphens", lambda *a, **k: {"occurrences": [], "windows": [], "summary": {}})
    monkeypatch.setattr(cleanup, "review_script_directions", lambda *a, **k: {})
    return calls


def run(extraction, dialogue):
    return cleanup.run_cleanup_review(Path(__file__).resolve().parents[2], extraction, dialogue, lambda *a: None)


def test_whole_units_never_edge_line_fragments():
    text = "A distribution notice starts on this line.\nIts condition continues on the next line."
    extraction, dialogue = artifacts([text])
    manifest = editorial_candidates(extraction, dialogue)
    assert [row["source"] for row in manifest["candidates"]] == [text]
    assert manifest["candidates"][0]["sourceEnd"] == len(text)


def test_long_or_cross_reader_units_are_preserved_without_truncation():
    extraction, dialogue = artifacts(["A long complete paragraph. " * 200])
    assert editorial_candidates(extraction, dialogue)["summary"]["oversizedUnits"] == 1
    extraction, dialogue = artifacts(["A complete paragraph containing two accepted reader intervals."])
    dialogue["spans"][0]["sourceEnd"] = 20
    dialogue["spans"].append({**dialogue["spans"][0], "id": "s2", "sourceStart": 20,
                              "sourceEnd": len(extraction["blocks"][0]["text"])})
    assert not editorial_candidates(extraction, dialogue)["candidates"]


def test_no_all_prose_remote_scan(monkeypatch):
    calls = fake_models(monkeypatch, production="clean")
    extraction, dialogue = artifacts([f"Distinct ordinary authored passage {i}, with its own contextual words." for i in range(12)])
    result = run(extraction, dialogue)
    assert len(calls["decisions"]) == 6
    assert not calls["luna"] and not result["occurrences"]
    assert result["focusedReview"]["summary"]["interiorUnrepeatedUnits"] == 6


@pytest.mark.parametrize("production,complete,role", [
    ("uncertain", True, "EDITORIAL"), ("review", False, "EDITORIAL"),
    ("review", True, "AUTHORED"), ("review", True, "UNCERTAIN"),
])
def test_uncertain_mixed_or_incomplete_blocks_do_not_create_review_tasks(monkeypatch, production, complete, role):
    fake_models(monkeypatch, production=production, complete=complete, role=role)
    extraction, dialogue = artifacts(["The notice begins here but may continue outside its source block."])
    result = run(extraction, dialogue)
    assert result["occurrences"] == []
    assert verified_editorial_occurrences(extraction, dialogue, result["focusedReview"]) == []


def test_exact_repeated_complete_unit_uses_one_verifier_and_replayable_anchors(monkeypatch):
    calls = fake_models(monkeypatch)
    text = "Synthetic publication notice. This entire paragraph is the complete notice."
    extraction, dialogue = artifacts([text] * 8)
    result = run(extraction, dialogue)
    assert len(calls["decisions"]) == 8
    assert len(calls["luna"]) == 1
    assert len(calls["luna"][0]["examples"]) == 3
    assert len(result["occurrences"]) == 8
    assert verified_editorial_occurrences(extraction, dialogue, result["focusedReview"]) == result["occurrences"]
    assert all(row["source"] == text and row["replacement"] == "" for row in result["occurrences"])
    evidence = deepcopy(result["focusedReview"])
    evidence["candidates"][0]["sourceEnd"] -= 1
    with pytest.raises(ValueError):
        verified_editorial_occurrences(extraction, dialogue, evidence)


def test_forged_eligibility_or_partial_verifier_does_not_authorize_omission(monkeypatch):
    fake_models(monkeypatch)
    extraction, dialogue = artifacts(["A complete, synthetic non-story production unit for source evidence tests."])
    evidence = run(extraction, dialogue)["focusedReview"]
    altered = deepcopy(evidence)
    altered["assessments"][0]["answers"]["production"] = "uncertain"
    with pytest.raises(ValueError):
        verified_editorial_occurrences(extraction, dialogue, altered)
    altered = deepcopy(evidence)
    altered["groups"][0]["verification"]["assessments"] = []
    with pytest.raises(ValueError):
        verified_editorial_occurrences(extraction, dialogue, altered)


@pytest.mark.parametrize("field", ["candidates", "assessments", "groups"])
def test_malformed_evidence_is_rejected_as_contract_error(monkeypatch, field):
    fake_models(monkeypatch)
    extraction, dialogue = artifacts(["A complete synthetic publication notice retained as exact source evidence."])
    evidence = run(extraction, dialogue)["focusedReview"]
    evidence[field] = [None]
    with pytest.raises(ValueError):
        verified_editorial_occurrences(extraction, dialogue, evidence)


def test_unsampled_repeat_with_attached_context_is_vetoed_individually(monkeypatch):
    calls = fake_models(monkeypatch)
    notice = "Synthetic complete distribution notice with its standalone condition."
    texts = [notice] * 8
    texts[3] = notice + "\n\nThis attached paragraph continues the preceding condition and must retain its lead-in."
    extraction, dialogue = artifacts(texts)
    original = cleanup.remote_decisions_completion
    def decide(root, config, prompt, questions, **kwargs):
        packet = json.loads(prompt)
        assert "self-contained" in questions[0]["instructions"]
        if packet["TARGET"] == notice and packet["context_after"].startswith("\n\nThis attached"):
            return {"answers": [{"type": "choice", "name": "production", "choice": "uncertain"},
                                {"type": "choice", "name": "word_damage", "choice": "clean"}]}
        return original(root, config, prompt, questions, **kwargs)
    monkeypatch.setattr(cleanup, "remote_decisions_completion", decide)
    result = run(extraction, dialogue)
    assert len(calls["luna"]) == 1
    assert len(result["occurrences"]) == 7
    assert all(row["blockId"] != "b3" for row in result["occurrences"])
    assert verified_editorial_occurrences(extraction, dialogue, result["focusedReview"]) == result["occurrences"]


def test_ornament_regions_include_complete_list_and_notice_not_separator_or_story():
    credits = "Édition collective :\n阿青\n山田\nMaría Fernández\nИван Петров"
    notice = "A complete synthetic distribution notice.\nIts second line finishes the condition."
    story = "An authored scene follows the ornament and must not enter either candidate."
    text = credits + "\n※ ※ ※\n" + notice + "\n※ ※ ※\n" + story
    extraction, dialogue = artifacts(["Ordinary authored surrounding passage for boundary control."] * 2 + ["A complete previous block.\n***"] + [text] + ["Another distinct authored surrounding passage for boundary control."] * 3)
    rows = [row for row in editorial_candidates(extraction, dialogue)["candidates"] if row["blockId"] == "b3"]
    assert [row["source"] for row in rows] == [credits, notice]
    assert all(row["candidateBasis"] == "ornament-bounded-unit" for row in rows)
    assert all("※" not in row["source"] and story not in row["source"] for row in rows)


def test_lone_ornament_or_oversized_region_does_not_create_cropped_candidate():
    text = "A full interior scene with ordinary source content." + "\n***\n" + "Another authored scene continues here without a closing rule."
    extraction, dialogue = artifacts(["Edge filler."] * 3 + [text] + ["Other edge filler."] * 3)
    assert not editorial_candidates(extraction, dialogue)["candidates"]
    oversized = "A" * 2500 + "\n***\n" + "B" * 2500 + "\n***\n" + "Authored tail."
    extraction, dialogue = artifacts(["Edge filler."] * 3 + [oversized] + ["Other edge filler."] * 3)
    manifest = editorial_candidates(extraction, dialogue)
    assert not manifest["candidates"] and manifest["summary"]["oversizedUnits"] >= 1


def test_multiparagraph_notice_is_one_candidate_with_no_partial_alternative():
    paragraphs = ["A standalone synthetic publication notice begins with this complete paragraph.",
                  "Its second paragraph supplies the condition attached to the opening statement.",
                  "Its final paragraph closes the notice without requiring further source text."]
    text = "\n\n".join(paragraphs)
    extraction, dialogue = artifacts([text])
    rows = editorial_candidates(extraction, dialogue)["candidates"]
    assert len(rows) == 1 and rows[0]["source"] == text
    assert rows[0]["unitBasis"] == "multiparagraph-narrator-unit"


def test_ornament_region_crossing_reader_ownership_remains_unselected():
    text = "Complete attributed production text before the dividing ornament.\n***\nAnother complete notice with two source reader intervals.\n***"
    extraction, dialogue = artifacts(["Edge filler."] * 2 + ["A complete previous block.\n***"] + [text] + ["Other edge filler."] * 3)
    span = dialogue["spans"][3]
    split = text.index("two source")
    span.update(sourceEnd=split, source=text[:split])
    dialogue["spans"].append({**span, "id": "extra", "sourceStart": split, "sourceEnd": len(text), "source": text[split:]})
    rows = [row for row in editorial_candidates(extraction, dialogue)["candidates"] if row["blockId"] == "b3"]
    assert len(rows) == 1 and rows[0]["source"] == text.split("\n")[0]


def test_mixed_chapter_metadata_unit_is_preserved_without_cropping_heading():
    text = "Chapter 9: The Returning Traveler\nJanuary 2\nPublisher example\nhttps://example.invalid/edition\n***\nA complete non-story notice finishes in this bounded region.\n***"
    extraction, dialogue = artifacts([text])
    rows = editorial_candidates(extraction, dialogue)["candidates"]
    assert all("Chapter 9" not in row["source"] for row in rows)
    assert not any(row["source"].startswith("January") for row in rows)


def test_page_prefix_continuation_cannot_be_omitted_as_whole_credit_block():
    previous = "Production participants:\nAn example contributor\nAnother contributor"
    continuation = "Further participants:\nA third contributor\nAn additional contributor\n***\nA complete separate notice ends here without any missing source.\n***"
    extraction, dialogue = artifacts([previous, continuation])
    rows = [row for row in editorial_candidates(extraction, dialogue)["candidates"] if row["blockId"] == "b1"]
    assert all("Further participants" not in row["source"] for row in rows)
    assert any("complete separate notice" in row["source"] for row in rows)


def test_no_multiparagraph_envelope_or_paragraph_can_delete_ornament_rules():
    text = "First complete synthetic distribution statement with sufficient source text.\n\n***\n\nSecond complete statement with sufficient source text.\n\n***\n\nAn authored scene follows this retained separator and must stay spoken."
    extraction, dialogue = artifacts([text])
    rows = editorial_candidates(extraction, dialogue)["candidates"]
    assert rows and all("***" not in row["source"] for row in rows)
    assert all(row["unitBasis"] != "multiparagraph-narrator-unit" for row in rows)
