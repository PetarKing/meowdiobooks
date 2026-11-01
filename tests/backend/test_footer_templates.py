"""Synthetic footers exercise discovery, bounded proof, and accepted spoken text."""
from copy import deepcopy
import json

import pytest

from meowdiobooks.backend import cleanup_remote as cleanup
from meowdiobooks.backend.cleanup_patterns import numbered_family_manifest
from meowdiobooks.backend.review import (
    ReviewContractError, accept_review_revision, add_cleanup_proposals,
    apply_review_render_policies, build_review_workspace, numbered_edge_candidates,
)
from tests.backend.test_cleanup_patterns import ROOT, artifacts, mocks


def footer_artifacts(n=12, template="Page {folio}    Example Press | https://books2.example/volume7"):
    extraction, dialogue = artifacts(n)
    for block, span in zip(extraction["blocks"], dialogue["spans"]):
        text = "A different story sentence.\n\n" + template.format(folio=block["page"] + 7)
        block["text"] = text
        span.update(source=text, text=text, sourceEnd=len(text))
    return extraction, dialogue


@pytest.mark.parametrize("template", [
    "Page {folio}    Example Press | https://books2.example/volume7",
    "{folio} | Example Press | https://books2.example/volume7",
    "Example Press | https://books2.example/volume7 | {folio}",
    "Page {folio}\nExample Press | https://books2.example/volume7",
    "{folio}\nExample Press | https://books2.example/volume7",
    "Page {folio}\nExample Press",
    "Example Press | https://books2.example/volume7\nPage {folio}",
    "Example Press\nPage {folio} | https://books2.example/volume7",
    "https://books2.example/volume7\nPage {folio} Example Press",
    "頁 {folio} 青空文庫 | https://books.example/",
])
def test_full_footer_is_one_exact_proposal_and_acceptance_keeps_story(monkeypatch, template):
    extraction, dialogue = footer_artifacts(template=template)
    original = deepcopy((extraction, dialogue))
    calls = mocks(monkeypatch)
    from meowdiobooks.backend import boundary_review
    monkeypatch.setattr(boundary_review, "remote_decisions_completion", lambda *args, **kwargs: {
        "answers": [{"name": q["name"], "type": "choice", "choice": "preserve"}
                    for q in args[3]]})
    rows = numbered_edge_candidates(extraction["blocks"])
    assert len(rows) == 12 and len({r["patternGroupId"] for r in rows}) == 1
    assert all(r["source"] == template.format(folio=r["page"] + 7) for r in rows)
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert len([r for r in result["occurrences"] if r.get("patternGroupId")]) == 12
    assert len(calls["decisions"]) == len(calls["verification"]) == 1
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)
    proposed = [r for w in workspace["warnings"] for r in w["occurrences"] if r.get("patternGroupId")]
    assert len(proposed) == 12
    accepted = accept_review_revision(workspace, [
        {"occurrenceIds": [r["id"]], "action": "repair" if r.get("patternGroupId") else "keep"}
        for w in workspace["warnings"] for r in w["occurrences"]], revision="fixed")
    spoken = apply_review_render_policies(dialogue, accepted)
    assert all("".join(r["text"] for r in spoken["spans"] if r["blockId"] == b["id"]).strip()
               == "A different story sentence." for b in extraction["blocks"])
    assert "".join(r["source"] for r in spoken["spans"]) == "".join(b["text"] for b in extraction["blocks"])
    assert (extraction, dialogue) == original


def test_one_and_two_line_layouts_share_static_template_but_both_are_sampled(monkeypatch):
    extraction, dialogue = footer_artifacts(40)
    for block, span in zip(extraction["blocks"], dialogue["spans"]):
        if block["page"] == 7:
            text = block["text"].replace("    Example", "\nExample")
            block["text"] = text
            span.update(source=text, text=text, sourceEnd=len(text))
    mocks(monkeypatch)
    family, = numbered_family_manifest(extraction, dialogue)
    assert len(family["eligible"]) == 40
    assert any("\n" in r["source"] for r in family["representatives"])
    assert len(family["representatives"]) <= 6


@pytest.mark.parametrize("template", [
    "“Page {folio} Example Press | https://books.example/”",
    "Page {folio} | Shelf {folio} | https://books.example/",
    "Story {folio}.\nhttps://books.example/",
    "Page {folio}\nA story sentence follows.",
])
def test_prose_quotes_multiple_counters_and_nonfooter_tails_are_not_candidates(template):
    extraction, _ = footer_artifacts(template=template)
    assert numbered_edge_candidates(extraction["blocks"]) == []


def test_different_literal_url_digits_and_folio_resets_do_not_borrow_family():
    extraction, _ = footer_artifacts(8)
    extraction["blocks"][2]["text"] = extraction["blocks"][2]["text"].replace("books2", "books3")
    extraction["blocks"][3]["text"] = extraction["blocks"][3]["text"].replace("Page 11", "Page 1")
    rows = numbered_edge_candidates(extraction["blocks"])
    assert {r["page"] for r in rows} == {1, 2, 5, 6, 7, 8}


def quoted_artifacts(n=10):
    extraction, dialogue = footer_artifacts(n)
    blocks, spans = [], []
    for block, span in zip(extraction["blocks"], dialogue["spans"]):
        page = block["page"]
        if page >= 4:
            text = f"A continuing spoken sentence on leaf {page}."
            body = {"id": f"body-{page}", "page": page, "text": text}
            blocks.append(body)
            spans.append({**span, "id": body["id"], "blockId": body["id"],
                          "source": text, "text": text, "sourceEnd": len(text),
                          "renderRole": "dialogue", "turnGroupId": "quote", "sourceSpeakerLabel": "Alice"})
        if 4 <= page < n:
            text = block["text"].split("\n\n", 1)[1]
            block["text"] = text
            span.update(source=text, text=text, sourceEnd=len(text), renderRole="dialogue",
                        turnGroupId="quote", sourceSpeakerLabel="Alice")
        blocks.append(block)
        spans.append(span)
    extraction["blocks"], dialogue["spans"] = blocks, spans
    return extraction, dialogue


def test_every_swallowed_quote_footer_gets_its_own_bounded_assessment(monkeypatch):
    extraction, dialogue = quoted_artifacts(18)
    calls = mocks(monkeypatch)
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    family, = numbered_family_manifest(extraction, dialogue)
    assert len(family["quoted"]) == 14
    quote_calls = [p for p in calls["verification"] if any("quoteContinuation" in r for r in p["examples"])]
    assert len(quote_calls) == 3
    assert all(len(p["examples"]) <= 6 for p in calls["verification"])
    checked = [r["windowId"] for p in quote_calls for r in p["examples"]]
    assert checked == [r["windowId"] for r in family["quoted"]]
    assert len(result["occurrences"]) == 18
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)
    accepted = accept_review_revision(workspace, [
        {"occurrenceIds": [r["id"]], "action": "repair"}
        for w in workspace["warnings"] for r in w["occurrences"] if r["kind"] == "ai-cleanup"], revision="quoted-fixed")
    rendered = apply_review_render_policies(dialogue, accepted)
    assert "https://" not in "".join(r["text"] for r in rendered["spans"])
    assert all("A continuing spoken sentence" in r["text"]
               for r in rendered["spans"] if r["blockId"].startswith("body-"))
    assert "".join(r["source"] for r in rendered["spans"]) == "".join(b["text"] for b in extraction["blocks"])


@pytest.mark.parametrize("mutation", ["speaker", "group", "source", "inline", "no-url", "no-narrator", "partial"])
def test_unsupported_dialogue_and_ownership_remain_spoken(mutation):
    extraction, dialogue = quoted_artifacts()
    target = next(b for b in extraction["blocks"] if b["id"] == "4")
    owner = next(s for s in dialogue["spans"] if s["blockId"] == "4")
    if mutation == "speaker":
        owner["sourceSpeakerLabel"] = "Bob"
    elif mutation == "group":
        owner["turnGroupId"] = "other"
    elif mutation == "source":
        owner["source"] = "forged"
    elif mutation == "partial":
        owner["spokenEnd"] = len(owner["source"]) - 1
    elif mutation in {"inline", "no-url"}:
        text = ("Real spoken story.\n" + target["text"] if mutation == "inline"
                else target["text"].split(" | ")[0])
        target["text"] = text
        owner.update(source=text, text=text, sourceEnd=len(text))
    else:
        for span in dialogue["spans"]:
            span["renderRole"] = "dialogue"
    families = numbered_family_manifest(extraction, dialogue)
    if mutation == "no-narrator":
        assert all(len(f["eligible"]) == 0 for f in families)
    else:
        assert not any(r["blockId"] == "4" for f in families for r in f["members"])


def test_unassessed_or_vetoed_quotes_cannot_borrow_narrator_proof(monkeypatch):
    extraction, dialogue = quoted_artifacts()
    mocks(monkeypatch)
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    original = deepcopy(result)
    result["patternGroups"][0]["quoteVerifications"] = []
    with pytest.raises(ReviewContractError, match="[Ff]ooter"):
        add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)
    result = original
    result["patternGroups"][0]["quoteVerifications"][0]["verification"]["assessments"][0]["role"] = "PRESERVE"
    with pytest.raises(ReviewContractError, match="[Ff]ooter"):
        add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)


def test_uncertain_quote_batch_preserves_it_without_vetoing_verified_narration(monkeypatch):
    extraction, dialogue = quoted_artifacts()
    mocks(monkeypatch)
    original = cleanup.remote_chat_completion

    def verify(*args, **kwargs):
        response = original(*args, **kwargs)
        if "quoteContinuation" in args[3]:
            payload = json.loads(response["text"])
            payload["assessments"][0]["role"] = "UNCERTAIN"
            return {"text": json.dumps(payload)}
        return response

    monkeypatch.setattr(cleanup, "remote_chat_completion", verify)
    from meowdiobooks.backend import chapter_semantic
    def classify(_root, _config, _system, packet, **kwargs):
        return {"text": json.dumps({"assessments": [
            {"boundaryId": r["boundaryId"], "role": "running", "reason": "Printed footer."}
            for r in json.loads(packet)["targets"]]})}
    monkeypatch.setattr(chapter_semantic, "remote_chat_completion", classify)
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert len(result["occurrences"]) == 4
    assert not any("quoteContinuation" in r for r in result["occurrences"])
    add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)


def test_repeated_numbered_prose_with_url_is_preserved_after_semantic_veto(monkeypatch):
    extraction, dialogue = footer_artifacts(template="She counted {folio} birds beside https://books.example/.")
    assert len(numbered_edge_candidates(extraction["blocks"])) == 12
    mocks(monkeypatch, verdict="PRESERVE")
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert result["occurrences"] == []


@pytest.mark.parametrize("quoted", [False, True])
def test_proof_cannot_be_reused_after_assessed_context_changes(monkeypatch, quoted):
    extraction, dialogue = quoted_artifacts() if quoted else footer_artifacts()
    mocks(monkeypatch)
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    target = "body-4" if quoted else "1"
    block = next(b for b in extraction["blocks"] if b["id"] == target)
    owner = next(s for s in dialogue["spans"] if s["blockId"] == target)
    if quoted:
        text = "She read the printed footers aloud to them."
    else:
        text = block["text"].replace("A different story sentence.", "She read the printed footers aloud.")
    block["text"] = text
    owner.update(source=text, text=text, sourceEnd=len(text))
    with pytest.raises(ReviewContractError, match="[Ff]ooter|source"):
        add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)


def test_casefold_labels_preserve_legacy_recall_without_casefolding_url_paths():
    extraction, _ = footer_artifacts(6, template="Publisher Press {folio}")
    for i, block in enumerate(extraction["blocks"]):
        label = ["Publisher Press", "PUBLISHER PRESS", "publisher press"][i % 3]
        block["text"] = block["text"].replace("Publisher Press", label)
    assert len(numbered_edge_candidates(extraction["blocks"])) == 6
    extraction, _ = footer_artifacts(6, template="Page {folio} Example | https://books.example/Volume7")
    for i, block in enumerate(extraction["blocks"]):
        path = ["Volume7", "VOLUME7", "volume7"][i % 3]
        block["text"] = block["text"].replace("Volume7", path)
    assert numbered_edge_candidates(extraction["blocks"]) == []


def test_failure_during_quote_verification_publishes_no_partial_result(monkeypatch):
    extraction, dialogue = quoted_artifacts()
    unchanged = deepcopy((extraction, dialogue))
    mocks(monkeypatch)
    original = cleanup.remote_chat_completion

    def unavailable(*args, **kwargs):
        if 'quoteContinuation' in args[3]:
            raise RuntimeError('provider unavailable during quoted footer verification')
        return original(*args, **kwargs)

    monkeypatch.setattr(cleanup, 'remote_chat_completion', unavailable)
    with pytest.raises(RuntimeError, match='provider unavailable'):
        cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert (extraction, dialogue) == unchanged


@pytest.mark.parametrize("digits", ["٠١٢٣٤٥٦٧٨٩", "۰۱۲۳۴۵۶۷۸۹", "०१२३४५६७८९", "０１２３４５６７８９"])
@pytest.mark.parametrize("with_url", [False, True])
def test_unicode_decimal_folios_retain_legacy_and_complete_footer_support(monkeypatch, digits, with_url):
    template = "دار النشر {folio}" + (" | https://books2.example/volume7" if with_url else "")
    extraction, dialogue = footer_artifacts(6, template=template)
    table = str.maketrans("0123456789", digits)
    for block, span in zip(extraction["blocks"], dialogue["spans"]):
        text = block["text"].replace(str(block["page"] + 7), str(block["page"] + 7).translate(table))
        block["text"] = text
        span.update(source=text, text=text, sourceEnd=len(text))
    rows = numbered_edge_candidates(extraction["blocks"])
    assert len(rows) == 6 and len({r["patternGroupId"] for r in rows}) == 1
    assert all(r["patternEvidence"]["folioOffset"] == 7 for r in rows)
    mocks(monkeypatch)
    result = cleanup.run_cleanup_review(ROOT, extraction, dialogue, lambda *a: None)
    assert len(result["occurrences"]) == 6
    add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)
