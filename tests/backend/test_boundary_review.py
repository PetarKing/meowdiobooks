"""Synthetic boundary evidence, batching, confidence and source-fidelity guards."""
from copy import deepcopy

import pytest

from meowdiobooks.backend import boundary_review as br


def artifacts(texts=("She shut her", "eyes.")):
    blocks = [{"id": f"b{i}", "page": i + 1, "text": text}
              for i, text in enumerate(texts)]
    spans = [{"id": f"s{i}", "blockId": block["id"], "sourceStart": 0,
              "sourceEnd": len(block["text"]), "source": block["text"],
              "renderRole": "narration", "chapterId": "c1"}
             for i, block in enumerate(blocks)]
    return {"blocks": blocks}, {"spans": spans}


def answer(name, choice, choices, probability=1):
    others = (1 - probability) / (len(choices) - 1)
    return {"name": name, "type": "choice", "choice": choice,
            "probabilities": [{"value": c, "probability": probability if c == choice else others}
                              for c in choices]}


def mock_model(monkeypatch, choice="SPACE", probability=1, verification="CORRECT"):
    calls = []

    def complete(root, config, prompt, questions, **kwargs):
        admission = kwargs.get("request_admission")
        if admission:
            admission(config, {})
        calls.append(questions)
        rows = []
        for question in questions:
            values = [c["value"] for c in question["choices"]]
            verify = "CORRECT" in values
            rows.append(answer(question["name"], verification if verify else choice,
                               values, 1 if verify else probability))
        return {"answers": rows}

    monkeypatch.setattr(br, "remote_decisions_completion", complete)
    return calls


def review(extraction, dialogue, **kwargs):
    return br.review_boundaries(None, extraction, dialogue, [object()], lambda *args: None, **kwargs)


def test_exact_two_source_anchors_and_possessive_are_preserved():
    extraction, dialogue = artifacts(("Between one's", "fingers."))
    original = deepcopy((extraction, dialogue))
    candidate, = br.boundary_candidates(extraction, dialogue)
    assert candidate["options"]["SPACE"] == "one's fingers"
    assert candidate["source"] == "one'sfingers"
    for anchor in candidate["anchors"]:
        block = next(b for b in extraction["blocks"] if b["id"] == anchor["blockId"])
        assert block["text"][anchor["sourceStart"]:anchor["sourceEnd"]] == anchor["source"]
    assert (extraction, dialogue) == original


@pytest.mark.parametrize("texts", [("her ", "eyes"), ("her", "\neyes"),
                                    ("her.", "Eyes"), ("room12", "eyes"),
                                    ("her", "room12"), ("", "eyes")])
def test_clear_whitespace_punctuation_and_nonword_edges_are_not_candidates(texts):
    assert br.boundary_candidates(*artifacts(texts)) == []


def test_cross_block_hyphen_includes_layout_and_exact_options():
    candidate, = br.boundary_candidates(*artifacts(("An inter-\n", "  national matter.")))
    assert candidate["source"] == "inter-\n  national"
    assert candidate["options"] == {"SPACE": "inter national", "JOIN": "international",
                                    "HYPHEN": "inter-national"}
    assert br.boundary_candidates(*artifacts(("An inter-\nnational matter.",))) == []


@pytest.mark.parametrize("change", ["chapter", "role", "speaker", "excluded", "range", "source",
                                    "ambiguous", "duplicate_block", "spoken"])
def test_incompatible_or_unproven_owners_are_not_candidates(change):
    extraction, dialogue = artifacts()
    right = dialogue["spans"][1]
    if change == "chapter":
        right["chapterId"] = "other"
    elif change == "role":
        right["renderRole"] = "dialogue"
    elif change == "speaker":
        right["sourceSpeakerLabel"] = "Someone"
    elif change == "excluded":
        right["reviewAction"] = "exclude"
    elif change == "range":
        right["sourceEnd"] = 999
    elif change == "source":
        right["source"] = "invented"
    elif change == "ambiguous":
        dialogue["spans"].append({**right, "id": "duplicate"})
    elif change == "duplicate_block":
        extraction["blocks"][1]["id"] = "b0"
    elif change == "spoken":
        right["spokenStart"] = 1
    assert br.boundary_candidates(extraction, dialogue) == []


def test_does_not_skip_intervening_footer():
    extraction, dialogue = artifacts(("She shut her", "12", "eyes."))
    assert br.boundary_candidates(extraction, dialogue) == []


@pytest.mark.parametrize("choice", ["SPACE", "JOIN", "HYPHEN"])
def test_verified_choice_is_exact_and_requires_no_source_mutation(monkeypatch, choice):
    calls = mock_model(monkeypatch, choice)
    extraction, dialogue = artifacts()
    original = deepcopy((extraction, dialogue))
    result = review(extraction, dialogue)
    row, = br.validated_boundary_rows(extraction, dialogue, result)
    assert row["replacement"] == row["options"][choice]
    assert row["boundaryDecision"] == choice and row["proposalStatus"] == "proposed"
    assert len(calls) == 2
    assert (extraction, dialogue) == original


@pytest.mark.parametrize("choice,probability,verification,decision", [
    ("SPACE", .74, "CORRECT", "UNSURE"),
    ("SPACE", 1, "INCORRECT", "UNSURE"),
    ("SPACE", 1, "UNSURE", "UNSURE"),
    ("UNSURE", 1, "CORRECT", "UNSURE"),
    ("NO_CONTINUATION", 1, "CORRECT", "NO_CONTINUATION"),
])
def test_unresolved_candidates_are_durable_without_replacement(
        monkeypatch, choice, probability, verification, decision):
    mock_model(monkeypatch, choice, probability, verification)
    extraction, dialogue = artifacts()
    result = review(extraction, dialogue)
    assert len(result["windows"]) == 1
    row, = br.validated_boundary_rows(extraction, dialogue, result)
    assert row["proposalStatus"] == "source_review"
    assert row["boundaryDecision"] == decision
    assert "replacement" not in row


def test_batches_ten_and_keeps_source_order(monkeypatch):
    calls = mock_model(monkeypatch)
    extraction, dialogue = artifacts(tuple("first last" for _ in range(24)))
    result = review(extraction, dialogue)
    assert sorted(len(q) for q in calls) == [3, 3, 10, 10, 10, 10]
    assert [r["windowId"] for r in result["occurrences"]] == [
        r["windowId"] for r in br.boundary_candidates(extraction, dialogue)]
    assert br.validated_boundary_rows(extraction, dialogue, result) == result["occurrences"]


@pytest.mark.parametrize("tamper", ["anchor", "replacement", "missing", "duplicate", "verification"])
def test_persisted_evidence_is_revalidated(monkeypatch, tamper):
    mock_model(monkeypatch)
    extraction, dialogue = artifacts()
    result = review(extraction, dialogue)
    if tamper == "anchor":
        result["windows"][0]["anchors"][0]["sourceStart"] += 1
    elif tamper == "replacement":
        result["occurrences"][0]["replacement"] = "invented"
    elif tamper == "missing":
        result["windows"] = []
    elif tamper == "duplicate":
        result["windows"] *= 2
    elif tamper == "verification":
        result["windows"][0]["verificationSpelling"] = "invented"
    with pytest.raises(ValueError):
        br.validated_boundary_rows(extraction, dialogue, result)


@pytest.mark.parametrize("malformed", ["missing", "duplicate", "unexpected"])
def test_bad_batch_answer_envelopes_fail_closed(monkeypatch, malformed):
    def complete(root, config, prompt, questions, **kwargs):
        row = answer("unexpected" if malformed == "unexpected" else questions[0]["name"],
                     "SPACE", br._CHOICES)
        return {"answers": [] if malformed == "missing" else [row, row]
                if malformed == "duplicate" else [row]}
    monkeypatch.setattr(br, "remote_decisions_completion", complete)
    with pytest.raises(ValueError, match="answers"):
        review(*artifacts())


def test_admission_failure_stops_before_verification(monkeypatch):
    calls = mock_model(monkeypatch)

    def denied(config, metadata):
        raise RuntimeError("cancelled")

    with pytest.raises(RuntimeError, match="cancelled"):
        review(*artifacts(), request_admission=denied)
    assert not calls


def test_no_candidates_does_not_call_provider(monkeypatch):
    calls = mock_model(monkeypatch)
    assert review(*artifacts(("one block",)))["windows"] == []
    assert calls == []


@pytest.mark.parametrize("malformation", ["nan", "bool", "missing", "duplicate", "sum", "type"])
def test_invalid_probability_evidence_never_grants_a_suggestion(monkeypatch, malformation):
    mock_model(monkeypatch)
    extraction, dialogue = artifacts()
    result = review(extraction, dialogue)
    window = result["windows"][0]
    evidence = window["response"]
    if malformation == "nan":
        evidence["probabilities"][0]["probability"] = float("nan")
    elif malformation == "bool":
        evidence["probabilities"][0]["probability"] = True
    elif malformation == "missing":
        evidence["probabilities"].pop()
    elif malformation == "duplicate":
        evidence["probabilities"][1] = evidence["probabilities"][0]
    elif malformation == "sum":
        evidence["probabilities"][1]["probability"] = .5
    elif malformation == "type":
        evidence["type"] = "text"
    with pytest.raises(ValueError, match="rows"):
        br.validated_boundary_rows(extraction, dialogue, result)
    assert br._selected(evidence, br._CHOICES) is None


def test_verification_probability_also_requires_threshold(monkeypatch):
    mock_model(monkeypatch)
    extraction, dialogue = artifacts()
    result = review(extraction, dialogue)
    result["windows"][0]["verification"] = answer("verify0", "CORRECT", br._VERIFY, .74)
    with pytest.raises(ValueError, match="rows"):
        br.validated_boundary_rows(extraction, dialogue, result)


def test_changed_question_identity_is_rejected(monkeypatch):
    mock_model(monkeypatch)
    extraction, dialogue = artifacts()
    result = review(extraction, dialogue)
    result["windows"][0]["response"]["name"] = "other"
    with pytest.raises(ValueError, match="question"):
        br.validated_boundary_rows(extraction, dialogue, result)


def review_workspace(monkeypatch, choice="SPACE", probability=1):
    from meowdiobooks.backend.review import add_cleanup_proposals, build_review_workspace
    mock_model(monkeypatch, choice, probability)
    extraction, dialogue = artifacts()
    extraction["revision"] = "e1"
    dialogue.update(revision="d1", extractionRevision="e1")
    evidence = review(extraction, dialogue)
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction,
                                     dialogue, {"boundaryReview": evidence,
                                                "occurrences": br.boundary_cleanup_rows(evidence["occurrences"]),
                                                "unifiedSuggestions": True})
    return extraction, dialogue, workspace


def test_boundary_acceptance_keeps_dual_evidence_out_of_single_span_repairs(monkeypatch):
    from meowdiobooks.backend.review import (
        _accepted_repairs, accept_review_revision, accepted_boundary_repairs,
    )
    extraction, dialogue, workspace = review_workspace(monkeypatch)
    rows = [r for w in workspace["warnings"] for r in w["occurrences"]]
    target = next(r for r in rows if r.get("boundaryDecision"))
    assert target["source"] == "her" and target["boundarySource"] == "hereyes"
    assert target["replacement"] == "her eyes"
    decisions = [{"occurrenceIds": [r["id"]],
                  "action": "repair" if r is target else "keep"} for r in rows]
    accepted = accept_review_revision(workspace, decisions, revision="r1")
    repair, = accepted_boundary_repairs(accepted)
    assert repair["anchors"] == target["boundaryAnchors"]
    assert repair["replacement"] == "her eyes" and repair["renderRole"] == "narration"
    assert _accepted_repairs(accepted) == {}
    assert accepted["boundaryReviewEvidence"] == workspace["boundaryReviewEvidence"]
    assert extraction["blocks"][0]["text"] == "She shut her"
    assert dialogue["spans"][1]["source"] == "eyes."


@pytest.mark.parametrize("choice,probability", [("UNSURE", 1), ("NO_CONTINUATION", 1), ("SPACE", .7)])
def test_unresolved_boundary_defaults_keep_on_accept(monkeypatch, choice, probability):
    from meowdiobooks.backend.review import accept_review_revision, accepted_boundary_repairs
    _, _, workspace = review_workspace(monkeypatch, choice, probability)
    rows = [r for w in workspace["warnings"] for r in w["occurrences"]]
    decisions = [{"occurrenceIds": [r["id"]], "action": "keep"}
                 for r in rows if not r.get("boundaryDecision")]
    accepted = accept_review_revision(workspace, decisions, revision="r1")
    target = next(r for r in rows if r.get("boundaryDecision"))
    assert next(d for d in accepted["decisions"] if d["occurrenceId"] == target["id"])["action"] == "keep"
    assert accepted_boundary_repairs(accepted) == []


def test_proposed_boundary_has_no_silent_acceptance_default(monkeypatch):
    from meowdiobooks.backend.review import ReviewContractError, accept_review_revision
    _, _, workspace = review_workspace(monkeypatch)
    with pytest.raises(ReviewContractError, match="explicit decisions"):
        accept_review_revision(workspace, [], revision="r1")


@pytest.mark.parametrize("tamper", ["anchors", "replacement", "decision", "evidence", "missing_warning"])
def test_accepted_boundary_replay_rejects_tampered_receipt(monkeypatch, tamper):
    from meowdiobooks.backend.review import (
        ReviewContractError, accept_review_revision, accepted_boundary_repairs,
    )
    _, _, workspace = review_workspace(monkeypatch)
    rows = [r for w in workspace["warnings"] for r in w["occurrences"]]
    accepted = accept_review_revision(workspace, [
        {"occurrenceIds": [r["id"]], "action": "repair" if r.get("boundaryDecision") else "keep"}
        for r in rows], revision="r1")
    target = next(r for w in accepted["warningSnapshot"] for r in w["occurrences"]
                  if r.get("boundaryDecision"))
    if tamper == "anchors":
        target["boundaryAnchors"][1]["source"] = "oops"
    elif tamper == "replacement":
        target["replacement"] = "invented"
    elif tamper == "decision":
        target["boundaryDecision"] = "JOIN"
    elif tamper == "evidence":
        accepted["boundaryReviewEvidence"] = None
    elif tamper == "missing_warning":
        accepted["warningSnapshot"] = []
    with pytest.raises(ReviewContractError):
        accepted_boundary_repairs(accepted)


@pytest.mark.parametrize("left,right,expected", [
    ("Un cafe\u0301", "chaud", "cafe\u0301 chaud"),
    ("Un", "cafe\u0301 chaud", "Un cafe\u0301"),
    ("वह", "किताब पढ़ता है", "वह किताब"),
])
def test_unicode_combining_marks_remain_inside_exact_word_options(left, right, expected):
    candidate, = br.boundary_candidates(*artifacts((left, right)))
    assert candidate["options"]["SPACE"] == expected
    anchors = candidate["anchors"]
    assert br.boundary_spellings(anchors[0]["source"], anchors[1]["source"]) == candidate["options"]


def test_overlapping_shared_word_yields_one_applyable_boundary():
    candidates = br.boundary_candidates(*artifacts(("the", "very", "long")))
    assert len(candidates) == 1
    assert candidates[0]["options"]["SPACE"] == "the very"


def test_layered_source_speakers_are_not_offered_unsupported_boundary_repairs():
    extraction, dialogue = artifacts()
    for span in dialogue["spans"]:
        span.update(renderRole="dialogue", speakerLabels=["Alice", "Rabbit"])
    assert br.boundary_candidates(extraction, dialogue) == []


def test_cleanup_runner_persists_boundary_proof_and_adapted_occurrences(monkeypatch):
    from types import SimpleNamespace
    from meowdiobooks.backend import cleanup_remote as cleanup
    calls = mock_model(monkeypatch)
    config = SimpleNamespace(model="gpt-6-luna")
    monkeypatch.setattr(cleanup, "cleanup_model_configs", lambda *a, **k: (config, config))
    monkeypatch.setattr(cleanup, "confirm_chapter_candidates", lambda *a, **k: {})
    monkeypatch.setattr(cleanup, "review_hyphens",
                        lambda *a, **k: {"occurrences": [], "windows": []})
    monkeypatch.setattr(cleanup, "review_script_directions", lambda *a, **k: {})
    extraction, dialogue = artifacts()
    result = cleanup.run_cleanup_review(None, extraction, dialogue, lambda *a: None)
    assert result["summary"]["boundaryCandidates"] == 1
    row, = result["occurrences"]
    assert row["source"] == "her" and row["boundarySource"] == "hereyes"
    assert row["boundaryAnchors"] == result["boundaryReview"]["windows"][0]["anchors"]
    assert len(calls) == 2


def test_preview_projects_full_boundary_repair_and_preserves_source(monkeypatch):
    from meowdiobooks.backend.review import preview_review_transcript_page
    extraction, dialogue, workspace = review_workspace(monkeypatch)
    original = deepcopy((extraction, dialogue, workspace))
    occurrence_policies = [{"occurrenceId": row["id"],
                            "action": "repair" if row.get("boundaryDecision") else "keep"}
                           for warning in workspace["warnings"] for row in warning["occurrences"]]
    left = preview_review_transcript_page(extraction, dialogue, workspace, [], page=1,
                                         occurrence_policies=occurrence_policies)
    right = preview_review_transcript_page(extraction, dialogue, workspace, [], page=2,
                                          occurrence_policies=occurrence_policies)
    assert left["spans"][0]["text"] == "She shut her eyes"
    assert right["spans"][0]["text"] == "."
    assert (extraction, dialogue, workspace) == original


def test_uncertain_preview_defaults_keep_without_user_action(monkeypatch):
    from meowdiobooks.backend.review import preview_review_transcript_page
    extraction, dialogue, workspace = review_workspace(monkeypatch, "UNSURE")
    preview = preview_review_transcript_page(extraction, dialogue, workspace, [], page=1)
    assert preview["spans"][0]["text"] == "She shut her"


def test_overlapping_hyphen_proposal_owns_repair_without_losing_boundary_proof(monkeypatch):
    from meowdiobooks.backend import hyphen_review as hr
    from meowdiobooks.backend.review import (
        add_cleanup_proposals, build_review_workspace, accept_review_revision, accepted_boundary_repairs,
    )
    mock_model(monkeypatch)
    extraction, dialogue = artifacts(("She had self-\nconfidence", "today."))
    extraction["revision"] = "e1"
    dialogue.update(revision="d1", extractionRevision="e1")

    def hyphen_complete(root, config, prompt, questions, **kwargs):
        question, = questions
        values = [c["value"] for c in question["choices"]]
        return {"answers": [answer(question["name"], "KEEP" if "KEEP" in values else "CORRECT", values)]}

    monkeypatch.setattr(hr, "remote_decisions_completion", hyphen_complete)
    hyphens = hr.review_hyphens(None, extraction, dialogue, [object()], lambda *a: None)
    boundary = br.suppress_boundary_conflicts(review(extraction, dialogue), hyphens["occurrences"])
    assert boundary["windows"][0]["response"]["choice"] == "SPACE"
    assert boundary["windows"][0]["suppressedBy"][0]["source"] == "self-\nconfidence"
    assert boundary["occurrences"][0]["boundaryDecision"] == "UNSURE"
    assert "replacement" not in boundary["occurrences"][0]
    result = {"hyphenReview": hyphens, "boundaryReview": boundary, "unifiedSuggestions": True,
              "occurrences": hyphens["occurrences"] + br.boundary_cleanup_rows(boundary["occurrences"])}
    workspace = add_cleanup_proposals(build_review_workspace(extraction, dialogue), extraction, dialogue, result)
    rows = [r for w in workspace["warnings"] for r in w["occurrences"]]
    actionable = [r for r in rows if r.get("proposalStatus") == "proposed"]
    assert len(actionable) == 1 and actionable[0]["hyphenDecision"] == "KEEP"
    accepted = accept_review_revision(workspace, [
        {"occurrenceIds": [r["id"]], "action": "repair"} for r in actionable], revision="r1")
    assert accepted_boundary_repairs(accepted) == []


def test_chapter_assigned_review_rejects_cross_chapter_repair_before_publication(monkeypatch):
    from meowdiobooks.backend.app_v2 import _dialogue_with_chapters
    from meowdiobooks.backend.review import ReviewContractError, accept_review_revision
    _, dialogue, workspace = review_workspace(monkeypatch)
    rows = [r for w in workspace["warnings"] for r in w["occurrences"]]
    accepted = accept_review_revision(workspace, [
        {"occurrenceIds": [r["id"]], "action": "repair" if r.get("boundaryDecision") else "keep"}
        for r in rows], revision="r1")
    accepted["spanChapterIds"] = {"s0": "chapter-1", "s1": "chapter-2"}
    with pytest.raises(ReviewContractError, match="one chapter"):
        _dialogue_with_chapters(dialogue, accepted)
