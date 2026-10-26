"""The accepted Review spelling remains authoritative through paced TTS planning."""

from copy import deepcopy
from types import SimpleNamespace

import pytest

from meowdiobooks.backend import hyphen_review
from meowdiobooks.backend.recording_script import build_recording_script
from meowdiobooks.backend.render_plan import compile_render_plan
from meowdiobooks.backend.review import (
    accept_review_revision,
    add_cleanup_proposals,
    apply_review_render_policies,
    build_review_workspace,
    preview_review_transcript_page,
)
from test_render_plan import _voice
from test_semantic_hyphens import answer


@pytest.mark.parametrize(
    "choice,user_choice,expected",
    [
        ("UNSURE", None, "re-\ncreation"),
        ("KEEP", "keep", "re-\ncreation"),
        ("KEEP", "repair", "re-creation"),
        ("JOIN", "repair", "recreation"),
        ("JOIN", "keep", "re-\ncreation"),
        ("malformed", None, "re-\ncreation"),
        ("low-confidence", None, "re-\ncreation"),
        ("rejected-verification", None, "re-\ncreation"),
    ],
)
def test_review_to_script_to_render_preserves_exact_spelling_and_pacing(
    monkeypatch, choice, user_choice, expected
):
    source = (
        "The actor performs a re-\ncreation, distinct from recreation.\n\nThe audience applauds."
    )
    extraction = {"revision": "e1", "blocks": [{"id": "b1", "page": 1, "text": source}]}
    dialogue = {
        "revision": "d1",
        "extractionRevision": "e1",
        "spans": [
            {
                "id": "s1",
                "blockId": "b1",
                "page": 1,
                "chapterId": "c1",
                "renderRole": "narration",
                "sourceStart": 0,
                "sourceEnd": len(source),
                "source": source,
                "text": source,
            }
        ],
    }
    original = deepcopy((extraction, dialogue))

    def model(*args, **_kwargs):
        if args[3][0]["name"] == "verification":
            return answer(
                "INCORRECT" if choice == "rejected-verification" else "CORRECT", verification=True
            )
        if choice == "malformed":
            return {"answers": [{"type": "choice", "choice": "JOIN"}]}
        return answer(
            "JOIN" if choice in ("low-confidence", "rejected-verification") else choice,
            probability=0.74 if choice == "low-confidence" else 0.99,
        )

    monkeypatch.setattr(hyphen_review, "remote_decisions_completion", model)
    evidence = hyphen_review.review_hyphens(
        ".", extraction, dialogue, (SimpleNamespace(model="decisions"), None), lambda *_: None
    )
    workspace = add_cleanup_proposals(
        build_review_workspace(extraction, dialogue),
        extraction,
        dialogue,
        {
            "occurrences": evidence["occurrences"],
            "hyphenReview": evidence,
            "unifiedSuggestions": True,
        },
    )
    rows = [row for warning in workspace["warnings"] for row in warning["occurrences"]]
    assert bool(rows) == (user_choice is not None)
    preview = preview_review_transcript_page(
        extraction,
        dialogue,
        workspace,
        [],
        page=1,
        occurrence_policies=[{"occurrenceId": row["id"], "action": user_choice} for row in rows],
    )
    accepted = accept_review_revision(
        workspace,
        [{"occurrenceIds": [row["id"]], "action": user_choice} for row in rows],
        revision="r1",
    )
    rendered = apply_review_render_policies(dialogue, accepted)
    cast = {
        "revision": "cast1",
        "identities": [],
        "labelToCharacterId": {},
        "narrator": _voice("narrator", "Narrator", category="narrator"),
    }
    script = build_recording_script(rendered, accepted, cast, revision="script1")
    plan = compile_render_plan(rendered, cast, script, ["c1"])
    segments = plan["chapters"][0]["segments"]
    expected_text = source.replace("re-\ncreation", expected)
    assert preview["spans"][0]["text"] == expected_text
    assert script["entries"][0]["text"] == expected_text
    assert "".join(segment["text"] for segment in segments) == expected_text
    assert [segment["boundaryBefore"]["kind"] for segment in segments] == ["start", "paragraph"]
    assert plan["summary"]["repairedLineBreakHyphenations"] == 0
    assert script["entries"][0]["sourceText"] == source
    assert (extraction, dialogue) == original
