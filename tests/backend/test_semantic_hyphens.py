"""Exact Decisions proposals retain source identity through acceptance and rendering."""

from copy import deepcopy
from types import SimpleNamespace

import pytest

from meowdiobooks.backend import hyphen_review as hyphens
from meowdiobooks.backend.review import (
    ReviewContractError,
    accept_review_revision,
    add_cleanup_proposals,
    apply_review_render_policies,
    build_review_workspace,
    preview_review_transcript_page,
)


def artifacts(word):
    text = f"We saw {word} yesterday."
    extraction = {"revision": "e1", "blocks": [{"id": "b", "page": 1, "text": text}]}
    dialogue = {
        "revision": "d1",
        "extractionRevision": "e1",
        "spans": [
            {
                "id": "s",
                "blockId": "b",
                "sourceStart": 0,
                "sourceEnd": len(text),
                "source": text,
                "text": text,
                "renderRole": "narration",
                "chapterId": "c",
            }
        ],
    }
    return extraction, dialogue


def answer(choice, probability=0.9, *, verification=False):
    return {
        "answers": [
            {
                "name": "verification" if verification else "spelling",
                "type": "choice",
                "choice": choice,
                "probabilities": [
                    {
                        "value": value,
                        "probability": probability if value == choice else (1 - probability) / 2,
                    }
                    for value in (
                        ("CORRECT", "INCORRECT", "UNSURE")
                        if verification
                        else ("KEEP", "JOIN", "UNSURE")
                    )
                ],
            }
        ]
    }


def run(monkeypatch, word, choice, probability=0.9):
    extraction, dialogue = artifacts(word)
    monkeypatch.setattr(
        hyphens,
        "remote_decisions_completion",
        lambda *a, **k: (
            answer("CORRECT", verification=True)
            if a[3][0]["name"] == "verification"
            else answer(choice, probability)
        ),
    )
    result = hyphens.review_hyphens(
        ".", extraction, dialogue, (SimpleNamespace(model="decisions"), None), lambda *a: None
    )
    return extraction, dialogue, result


@pytest.mark.parametrize(
    ("word", "choice", "expected"),
    [
        ("confi-\ndence", "JOIN", "confidence"),
        ("self-\nconfidence", "KEEP", "self-confidence"),
        ("Kiryūin-\nsenpai", "KEEP", "Kiryūin-senpai"),
        ("co\u00ad\noperate", "JOIN", "cooperate"),
        ("Wort-\ntrennung", "JOIN", "Worttrennung"),
        ("first-\nyear", "KEEP", "first-year"),
    ],
)
def test_exact_choice_preview_accept_preserves_source(monkeypatch, word, choice, expected):
    extraction, dialogue, result = run(monkeypatch, word, choice)
    before = deepcopy((extraction, dialogue))
    assert hyphens.validated_hyphen_proposals(extraction, dialogue, result) == result["occurrences"]
    workspace = add_cleanup_proposals(
        build_review_workspace(extraction, dialogue),
        extraction,
        dialogue,
        {"occurrences": result["occurrences"], "hyphenReview": result, "unifiedSuggestions": True},
    )
    (warning,) = workspace["warnings"]
    (row,) = warning["occurrences"]
    assert warning["kind"] == "ai-cleanup"
    assert row["availableActions"] == ["keep", "repair"]
    preview = preview_review_transcript_page(
        extraction,
        dialogue,
        workspace,
        [],
        page=1,
        occurrence_policies=[{"occurrenceId": row["id"], "action": "repair"}],
    )
    accepted = accept_review_revision(
        workspace, [{"occurrenceIds": [row["id"]], "action": "repair"}], revision="r1"
    )
    rendered = apply_review_render_policies(dialogue, accepted)
    assert (
        preview["spans"][0]["text"]
        == rendered["spans"][0]["text"]
        == f"We saw {expected} yesterday."
    )
    assert accepted["hyphenReviewEvidence"] == result
    assert (extraction, dialogue) == before
    with pytest.raises(ReviewContractError):
        accept_review_revision(
            workspace, [{"occurrenceIds": [row["id"]], "action": "exclude"}], revision="r2"
        )


@pytest.mark.parametrize(
    ("choice", "probability"), [("UNSURE", 0.99), ("JOIN", 0.74), ("KEEP", 0.65)]
)
def test_abstention_is_unchanged_and_nonblocking(monkeypatch, choice, probability):
    e, d, result = run(monkeypatch, "points-\nThat", choice, probability)
    workspace = add_cleanup_proposals(
        build_review_workspace(e, d), e, d, {"occurrences": [], "hyphenReview": result}
    )
    assert workspace["warnings"] == []
    accepted = accept_review_revision(workspace, [], revision="r")
    assert apply_review_render_policies(d, accepted)["spans"][0]["text"] == d["spans"][0]["text"]


@pytest.mark.parametrize(
    "mutation",
    ["replacement", "anchor", "borrowed-evidence", "missing-evidence", "duplicate-evidence"],
)
def test_tampered_proposals_rejected(monkeypatch, mutation):
    e, d, r = run(monkeypatch, "self-\nconfidence", "KEEP")
    if mutation == "replacement":
        r["occurrences"][0]["replacement"] = ""
    if mutation == "anchor":
        r["occurrences"][0]["sourceStart"] += 1
    if mutation == "borrowed-evidence":
        r["windows"][0]["source"] = "wrong"
    if mutation == "missing-evidence":
        r["windows"] = []
    if mutation == "duplicate-evidence":
        r["windows"] *= 2
    with pytest.raises(ReviewContractError):
        add_cleanup_proposals(
            build_review_workspace(e, d), e, d, {"occurrences": r["occurrences"], "hyphenReview": r}
        )


@pytest.mark.parametrize("value", [None, {}, {"answers": []}, {"answers": [True]}])
def test_malformed_is_preserved(value):
    assert hyphens.hyphen_choice(value) is None


def test_invalid_probability_and_ambiguous_ownership():
    for value in [True, float("nan"), -1, 2]:
        a = answer("JOIN")
        a["answers"][0]["probabilities"][1]["probability"] = value
        assert hyphens.hyphen_choice(a) is None
    e, d = artifacts("self-\nconfidence")
    d["spans"] *= 2
    assert hyphens.hyphen_candidates(e, d) == []
    d["spans"] = d["spans"][:1]
    d["spans"][0]["spokenStart"] = None
    assert hyphens.hyphen_candidates(e, d) == []


def test_transport_error_does_not_publish_clean_result(monkeypatch):
    def fail(*a, **k):
        raise RuntimeError("network failed")

    monkeypatch.setattr(hyphens, "remote_decisions_completion", fail)
    e, d = artifacts("confi-\ndence")
    with pytest.raises(RuntimeError, match="network failed"):
        hyphens.review_hyphens(".", e, d, (None, None), lambda *a: None)


@pytest.mark.parametrize(
    ("heading", "chapter"),
    [
        ("Translator notes:", "Chapter 2"),
        ("Notes du traducteur:", "Chapitre 2"),
        ("Anmerkungen des Übersetzers:", "Kapitel 2"),
        ("Note del traduttore:", "Capitolo 2"),
        ("Notas del traductor:", "Capítulo 2"),
        ("Notas do tradutor:", "Capítulo 2"),
        ("Примечания переводчика:", "Глава 2"),
        ("译者注：", "第二章"),
        ("訳注：", "第二章"),
        ("역자 주:", "제2장"),
    ],
)
def test_multilingual_note_hints_do_not_consume_new_sections(heading, chapter):
    from meowdiobooks.backend.review import _footnote_occurrences

    text = f"{heading}\n[1] A complete explanatory note.\n{chapter}\nThe story continues."
    rows = _footnote_occurrences([{"id": "b", "page": 1, "text": text}])
    assert [r["source"] for r in rows] == ["[1] A complete explanatory note."]
    # Mentioning the label in prose never opens a numbered-note section.
    text = f"Someone wrote {heading} in a letter.\n1. A story list item."
    assert _footnote_occurrences([{"id": "b", "page": 1, "text": text}]) == []


def test_unknown_language_standalone_label_ends_note_without_keyword_match():
    from meowdiobooks.backend.review import _footnote_occurrences

    text = "Translation notes:\n[1] A note\nNuwe afdeling:\nAuthored content."
    rows = _footnote_occurrences([{"id": "b", "page": 1, "text": text}])
    assert [r["source"] for r in rows] == ["[1] A note"]


def test_unified_pipeline_does_not_admit_legacy_unverified_arbitrary_deletion():
    e, d = artifacts("perfectly normal prose")
    proposal = {"blockId": "b", "sourceStart": 0, "sourceEnd": 2, "source": "We", "replacement": ""}
    with pytest.raises(ReviewContractError, match="verified source-bound"):
        add_cleanup_proposals(
            build_review_workspace(e, d),
            e,
            d,
            {"unifiedSuggestions": True, "occurrences": [proposal]},
        )


def test_unhashable_decision_values_preserve():
    response = answer("JOIN")
    response["answers"][0]["choice"] = []
    assert hyphens.hyphen_choice(response) is None
    response = answer("JOIN")
    response["answers"][0]["probabilities"][0]["value"] = []
    assert hyphens.hyphen_choice(response) is None


def test_chapter_confirmation_requires_matching_semantic_assessment():
    from copy import deepcopy
    from meowdiobooks.backend.chapter_semantic import chapter_review_plan, assemble_chapter_review
    from meowdiobooks.backend.dialogue import scan_dialogue

    e = scan_dialogue([{"id": "b", "page": 1, "pageStart": 0,
                       "text": "Chapter 2\n\nThe next scene begins."}])
    e["revision"] = "e1"
    d = {"revision": "d1", "extractionRevision": "e1", "spans": e["partition"]}
    plan = chapter_review_plan(e, d)
    batches = [{"targets": packet, "response": {"assessments": [
        {"boundaryId": row["boundaryId"], "role": "chapter", "reason": "Actual chapter start."}
        for row in packet]}} for packet in plan["packets"]]
    evidence = assemble_chapter_review(plan, batches)
    assert evidence["boundaryCandidates"]
    for mutate in [
        lambda row: row.update(assessments=[]),
        lambda row: row["assessments"][0].update(role="other"),
        lambda row: row["assessments"].append(dict(row["assessments"][0])),
    ]:
        broken = deepcopy(evidence)
        mutate(broken)
        with pytest.raises(ReviewContractError, match="assessment"):
            add_cleanup_proposals(build_review_workspace(e, d), e, d,
                                  {"occurrences": [], "chapterReview": broken})


@pytest.mark.parametrize("verdict", ["INCORRECT", "UNSURE", "malformed", "low-score"])
def test_independent_verifier_vetoes_wrong_join_without_keyword_rules(monkeypatch, verdict):
    import json

    calls = []

    def provider(_root, _config, prompt, questions, **kwargs):
        calls.append((json.loads(prompt), questions))
        if questions[0]["name"] == "spelling":
            return answer("JOIN", 0.79)
        assert json.loads(prompt)["proposed_spelling"] == "firstyears"
        assert json.loads(prompt)["alternative_spelling"] == "first-years"
        assert "firstyears" in json.loads(prompt)["sentence_with_proposal"]
        if verdict == "malformed":
            return {"answers": [{"name": "verification", "type": "choice", "choice": []}]}
        return answer(
            "CORRECT" if verdict == "low-score" else verdict,
            0.74 if verdict == "low-score" else 0.9,
            verification=True,
        )

    monkeypatch.setattr(hyphens, "remote_decisions_completion", provider)
    e, d = artifacts("first-\nyears")
    result = hyphens.review_hyphens(".", e, d, (None, None), lambda *a: None)
    assert len(calls) == 2
    assert result["occurrences"] == []
    assert hyphens.validated_hyphen_proposals(e, d, result) == []
    workspace = add_cleanup_proposals(
        build_review_workspace(e, d), e, d, {"occurrences": [], "hyphenReview": result}
    )
    assert workspace["warnings"] == []


def test_failed_verification_aborts_before_publication(monkeypatch):
    def provider(_root, _config, _prompt, questions, **kwargs):
        if questions[0]["name"] == "verification":
            raise RuntimeError("verification transport failure")
        return answer("JOIN")

    monkeypatch.setattr(hyphens, "remote_decisions_completion", provider)
    e, d = artifacts("confi-\ndence")
    with pytest.raises(RuntimeError, match="verification transport failure"):
        hyphens.review_hyphens(".", e, d, (None, None), lambda *a: None)


def test_verifier_evidence_required_at_admission(monkeypatch):
    e, d, result = run(monkeypatch, "confi-\ndence", "JOIN")
    result["windows"][0]["verification"] = answer("UNSURE", verification=True)
    with pytest.raises(ValueError, match="decision evidence"):
        hyphens.validated_hyphen_proposals(e, d, result)


def test_exact_duplicate_contexts_share_calls_but_keep_distinct_source_anchors(monkeypatch):
    calls = []

    def provider(_root, _config, _prompt, questions, **kwargs):
        calls.append(questions[0]["name"])
        return (
            answer("CORRECT", verification=True)
            if questions[0]["name"] == "verification"
            else answer("JOIN")
        )

    monkeypatch.setattr(hyphens, "remote_decisions_completion", provider)
    e, d = artifacts("confi-\ndence")
    e["blocks"].append({**e["blocks"][0], "id": "other", "page": 2})
    d["spans"].append({**d["spans"][0], "id": "other-span", "blockId": "other"})
    result = hyphens.review_hyphens(".", e, d, (None, None), lambda *a: None)
    assert calls == ["spelling", "verification"]
    assert len(result["occurrences"]) == 2
    assert len({r["windowId"] for r in result["occurrences"]}) == 2
    assert hyphens.validated_hyphen_proposals(e, d, result) == result["occurrences"]
    # Different context must not borrow this verification.
    e["blocks"][1]["text"] += " Another sentence."
    d["spans"][1].update(source=e["blocks"][1]["text"], sourceEnd=len(e["blocks"][1]["text"]))
    calls.clear()
    hyphens.review_hyphens(".", e, d, (None, None), lambda *a: None)
    assert sorted(calls) == ["spelling", "spelling", "verification", "verification"]


def test_cancellation_before_verification_admission_does_not_call_provider_twice(monkeypatch):
    calls = []

    def admission(_config, _metadata):
        if calls:
            raise RuntimeError("cancelled before verification")

    def provider(_root, config, _prompt, questions, **kwargs):
        kwargs["request_admission"](config, {})
        calls.append(questions[0]["name"])
        return answer("JOIN")

    monkeypatch.setattr(hyphens, "remote_decisions_completion", provider)
    e, d = artifacts("confi-\ndence")
    with pytest.raises(RuntimeError, match="cancelled before verification"):
        hyphens.review_hyphens(
            ".", e, d, (None, None), lambda *a: None, request_admission=admission
        )
    assert calls == ["spelling"]


def test_opposite_initial_choice_cannot_reuse_verifier_spelling(monkeypatch):
    e, d, result = run(monkeypatch, "self-\nconfidence", "KEEP")
    result["windows"][0]["response"] = answer("JOIN")
    result["occurrences"][0].update(hyphenDecision="JOIN", replacement="selfconfidence")
    with pytest.raises(ValueError, match="decision evidence"):
        hyphens.validated_hyphen_proposals(e, d, result)
