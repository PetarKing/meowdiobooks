import contextlib

import pytest

from meowdiobooks.backend.dialogue import (
    DialogueContractError,
    reconstruct_partition,
    scan_dialogue,
)
from meowdiobooks.backend.dialogue_ai import (
    apply_dialogue_corrections,
    parse_attribution_answer,
    plan_dialogue_windows,
    resolve_dialogue,
    run_dialogue_qwen,
)


def test_subaru_explicit_label_is_preserved_and_only_open_turn_is_sent_to_qwen():
    scan = scan_dialogue(
        [{"page": 1, "text": "Subaru: [Where?]\n\n???: [Here.]\n\nLouis entered."}],
        enabled_profile_ids=["label-brackets"],
    )
    seen = []

    def complete(_system, prompt, owner_ids):
        seen.append((prompt, list(owner_ids)))
        return "Louis"

    result = resolve_dialogue(scan, "fill-gaps", complete)

    assert len(seen[0][1]) == 1
    assert "SPEECH\nHere." in seen[0][0]
    assert "AFTER\nLouis entered." in seen[0][0]
    assert "span:p1" not in seen[0][0]
    assert "T001" not in seen[0][0]
    explicit = next(row for row in result["partition"] if row.get("sourceSpeakerLabel") == "Subaru")
    assert explicit["speakerStatus"] == "explicit"
    assert "resolvedSpeakerLabel" not in explicit
    attributed = next(
        row for row in result["partition"] if row.get("resolvedSpeakerLabel") == "Louis"
    )
    assert attributed["sourceSpeakerLabel"] == "???"
    assert attributed["speakerStatus"] == "ai"


def test_attribution_scope_targets_only_selected_class_and_narrates_the_other():
    scan = scan_dialogue(
        [{"page": 1, "text": "???: [Here.]\n\n“Who are you?” Alice asked."}],
        enabled_profile_ids=["label-brackets", "unlabeled-curly-quotes"],
    )
    seen = []

    def complete(_system, _prompt, owner_ids):
        seen.extend(owner_ids)
        return "Alice"

    result = resolve_dialogue(scan, "fill-gaps", complete, ["unlabelled-candidates"])

    assert len(seen) == 1
    open_turn = next(row for row in result["partition"] if row.get("sourceSpeakerLabel") == "???")
    quote = next(row for row in result["partition"] if row.get("resolvedSpeakerLabel") == "Alice")
    assert open_turn["speakerStatus"] == "unresolved"
    assert open_turn["fallback"] == "narrator"
    assert open_turn["origin"] == "policy:narrate-unselected-dialogue"
    assert quote["speakerStatus"] == "ai"
    assert result["attributionTargets"] == ["unlabelled-candidates"]


def test_alice_post_quote_attribution_is_visible_in_focused_after_context():
    source = "“But I don’t want to go among mad people,” Alice remarked."
    scan = scan_dialogue([{"page": 1, "text": source}])
    windows = plan_dialogue_windows(
        scan["partition"],
        [next(row["id"] for row in scan["partition"] if row["renderRole"] == "dialogue")],
    )

    dossier = windows[0]["dossiers"][0]
    assert dossier["target"] == "“But I don’t want to go among mad people,”"
    assert dossier["after"] == "Alice remarked."


def test_context_crosses_line_block_and_page_boundaries_without_changing_anchors():
    scan = scan_dialogue(
        [
            {"page": 1, "text": "Alice leaned closer.\n\n“Who are you?”\n\n"},
            {"page": 2, "text": "The White Rabbit answered from the doorway."},
        ]
    )
    target = next(row for row in scan["partition"] if row["renderRole"] == "dialogue")
    original = dict(target)
    window = plan_dialogue_windows(scan["partition"], [target["id"]])[0]

    assert "Alice leaned closer." in window["dossiers"][0]["before"]
    assert "White Rabbit answered" in window["dossiers"][0]["after"]
    assert target == original
    assert reconstruct_partition(scan) == {
        1: "Alice leaned closer.\n\n“Who are you?”\n\n",
        2: "The White Rabbit answered from the doorway.",
    }


def test_subaru_context_counts_semantic_turns_and_reaches_later_medium_reveal():
    scan = scan_dialogue(
        [
            {
                "page": 1,
                "text": (
                    "???: [Who said that?]\n\n"
                    "Subaru froze.\n\n"
                    "Emilia: [Did you hear it too?]\n\n"
                    "A chair scraped across the floor.\n\n"
                    "Medium: [It was me.]"
                ),
            }
        ],
        enabled_profile_ids=["label-brackets"],
    )
    target = next(row for row in scan["partition"] if row.get("sourceSpeakerLabel") == "???")

    dossier = plan_dialogue_windows(scan["partition"], [target["id"]])[0]["dossiers"][0]

    assert "Subaru froze." in dossier["after"]
    assert "Emilia: [Did you hear it too?]" in dossier["after"]
    assert "Medium: [It was me.]" in dossier["after"]


def test_tiny_model_windows_default_to_one_target_and_enforce_hard_prompt_budget():
    scan = scan_dialogue([{"page": 1, "text": "Alice waited. “One?” Bob waited. “Two?”"}])
    targets = [row["id"] for row in scan["partition"] if row["renderRole"] == "dialogue"]

    default_windows = plan_dialogue_windows(scan["partition"], targets)
    bounded_windows = plan_dialogue_windows(
        scan["partition"],
        targets,
        max_prompt_characters=1_000,
        context_characters=100,
        max_target_characters=200,
    )

    assert [len(row["ownerIds"]) for row in default_windows] == [1, 1]
    assert all(len(row["ownerIds"]) == 1 for row in bounded_windows)
    assert all(len(row["prompt"]) <= 1_000 for row in bounded_windows)


def test_context_budget_does_not_cut_words_in_half():
    scan = scan_dialogue(
        [{"page": 1, "text": "“Who?” " + "Nearby evidence " * 20 + "Alice answered."}]
    )
    target = next(row["id"] for row in scan["partition"] if row["renderRole"] == "dialogue")

    after = plan_dialogue_windows(scan["partition"], [target], context_characters=83)[0][
        "dossiers"
    ][0]["after"]

    assert not after.endswith("evid")
    assert after.endswith(("evidence", "Alice answered."))


def test_cross_page_quote_is_one_logical_target_and_attribution_propagates_to_fragments():
    pages = [
        {"page": 1, "text": "Alice began, then whispered:\n\n“Down the hole we go\n\n"},
        {"page": 2, "text": "and perhaps we never return,” said Alice."},
    ]
    scan = scan_dialogue(pages)
    fragments = [row for row in scan["partition"] if row.get("turnGroupId")]
    assert len(fragments) == 2
    assert len({row["turnGroupId"] for row in fragments}) == 1
    curly_profile = next(row for row in scan["profiles"] if row["id"] == "unlabeled-curly-quotes")
    assert curly_profile["matchCount"] == 1
    assert len(curly_profile["examples"][0]["sourceFragments"]) == 2
    seen = []

    def complete(_system, prompt, owner_ids):
        seen.append((prompt, owner_ids))
        return "Alice"

    result = resolve_dialogue(scan, "fill-gaps", complete)

    assert len(seen) == 1
    assert len(seen[0][1]) == 1
    assert "Down the hole we go" in seen[0][0]
    assert "perhaps we never return" in seen[0][0]
    resolved = [row for row in result["partition"] if row.get("turnGroupId")]
    assert {row["resolvedSpeakerLabel"] for row in resolved} == {"Alice"}
    assert [(row["sourceStart"], row["sourceEnd"]) for row in resolved] == [(0, 22), (0, 29)]
    assert reconstruct_partition(result) == {1: pages[0]["text"], 2: pages[1]["text"]}


def test_dangling_earlier_closer_does_not_hide_a_later_cross_block_quote():
    pages = [
        {
            "page": 1,
            "text": "A quotation from the previous page ends here.”\n\n“First half\n\n",
        },
        {"page": 2, "text": "second half,” said Alice."},
    ]

    scan = scan_dialogue(pages)

    fragments = [row for row in scan["partition"] if row.get("turnGroupId")]
    assert len(fragments) == 2
    assert len({row["turnGroupId"] for row in fragments}) == 1
    assert "".join(row["text"] for row in fragments) == "First half\n\nsecond half,"
    assert reconstruct_partition(scan) == {1: pages[0]["text"], 2: pages[1]["text"]}


def test_narrator_policy_keeps_detected_turn_separate_from_surrounding_text():
    source = "Alice opened the door. “Come inside,” the voice said. She hesitated."
    scan = scan_dialogue([{"page": 1, "text": source}])

    result = resolve_dialogue(scan, "narrate", lambda *_args: pytest.fail("no Qwen call"))

    assert len(result["partition"]) == 3
    dialogue = next(row for row in result["partition"] if row["renderRole"] == "dialogue")
    assert dialogue["source"] == "“Come inside,”"
    assert dialogue["speakerStatus"] == "unresolved"
    assert dialogue["fallback"] == "narrator"
    assert dialogue["origin"] == "policy:narrate-dialogue"
    assert reconstruct_partition(result) == {1: source}


def test_full_book_strategy_and_role_classification_are_removed():
    scan = scan_dialogue([{"page": 1, "text": "“Hello,” said Alice."}])

    with pytest.raises(DialogueContractError, match="Unsupported Dialogue strategy"):
        resolve_dialogue(scan, "full-book", lambda *_args: "Alice")
    with pytest.raises(DialogueContractError, match="only supports targeted"):
        run_dialogue_qwen(None, scan, "full-book")
    with pytest.raises(DialogueContractError, match="Invalid speaker"):
        parse_attribution_answer("T001|D|Alice")


def test_attribution_answer_is_one_name_question_or_slash():
    assert parse_attribution_answer("Alice") == "Alice"
    assert parse_attribution_answer("?") == "?"
    assert parse_attribution_answer("/") == "/"
    with pytest.raises(DialogueContractError, match="exactly one answer"):
        parse_attribution_answer("Alice\nBob")
    with pytest.raises(DialogueContractError, match="Invalid speaker"):
        parse_attribution_answer("T001|Alice")


def test_attribution_row_strips_one_copied_source_label_colon():
    assert parse_attribution_answer("???:") == "???"
    assert parse_attribution_answer("Alice:") == "Alice"


def test_not_vocalisation_result_restores_one_contiguous_narration_span():
    source = 'He swallowed the packaged "drug" and waited.'
    scan = scan_dialogue(
        [{"page": 1, "text": source}],
        enabled_profile_ids=["unlabeled-straight-quotes"],
    )

    result = resolve_dialogue(scan, "fill-gaps", lambda *_args: "/")

    assert result["partition"] == [
        {
            **result["partition"][0],
            "source": source,
            "text": source,
            "renderRole": "narration",
            "sourceStart": 0,
            "sourceEnd": len(source),
            "spokenStart": 0,
            "spokenEnd": len(source),
            "speakerStatus": "not-applicable",
            "origin": "qwen:not-vocalisation",
        }
    ]
    assert reconstruct_partition(result) == {1: source}


def test_user_can_restore_ai_rejected_text_as_character_dialogue():
    source = 'He called the warning "Alice" and waited.'
    scan = scan_dialogue(
        [{"page": 1, "text": source}],
        enabled_profile_ids=["unlabeled-straight-quotes"],
    )
    result = resolve_dialogue(scan, "fill-gaps", lambda *_args: "/")
    candidate = {**result, "revision": "ai-candidate", "spans": result["partition"]}
    span_id = result["aiWindows"][0]["ownerIds"][0]

    corrected = apply_dialogue_corrections(
        candidate,
        [{"spanId": span_id, "action": "speaker", "speakerLabel": "Bob"}],
        revision="user-corrected",
    )

    dialogue = next(row for row in corrected["spans"] if row["renderRole"] == "dialogue")
    assert dialogue["resolvedSpeakerLabel"] == "Bob"
    assert dialogue["speakerStatus"] == "user"
    assert dialogue["origin"] == "user:dialogue-speaker"
    assert reconstruct_partition(corrected) == {1: source}


def test_user_can_route_ai_attribution_to_narrator():
    source = 'Alice waited. "Hello." Then she waved.'
    scan = scan_dialogue(
        [{"page": 1, "text": source}],
        enabled_profile_ids=["unlabeled-straight-quotes"],
    )
    result = resolve_dialogue(scan, "fill-gaps", lambda *_args: "Alice")
    candidate = {**result, "revision": "ai-candidate", "spans": result["partition"]}
    span_id = result["aiWindows"][0]["ownerIds"][0]

    corrected = apply_dialogue_corrections(
        candidate,
        [{"spanId": span_id, "action": "narrator"}],
        revision="user-corrected",
    )

    target = next(
        row for row in corrected["spans"] if row["origin"] == "user:dialogue-narrator"
    )
    assert target["renderRole"] == "dialogue"
    assert target["speakerStatus"] == "unresolved"
    assert corrected["resultSummary"]["aiAttributed"] == 0
    assert corrected["resultSummary"]["aiContributions"] == 0
    assert corrected["resultSummary"]["userCorrected"] == 1
    assert reconstruct_partition(corrected) == {1: source}


def test_user_correction_contract_rejects_removed_prose_action():
    source = 'Alice waited. "Hello." Then she waved.'
    scan = scan_dialogue(
        [{"page": 1, "text": source}],
        enabled_profile_ids=["unlabeled-straight-quotes"],
    )
    result = resolve_dialogue(scan, "fill-gaps", lambda *_args: "Alice")
    candidate = {**result, "revision": "ai-candidate", "spans": result["partition"]}
    span_id = result["aiWindows"][0]["ownerIds"][0]

    with pytest.raises(DialogueContractError, match="Unsupported Dialogue correction"):
        apply_dialogue_corrections(
            candidate,
            [{"spanId": span_id, "action": "not-dialogue"}],
            revision="user-corrected",
        )


def test_invented_speaker_fails_the_entire_revision():
    scan = scan_dialogue([{"page": 1, "text": "Alice waited. “Who is there?”"}])

    with pytest.raises(DialogueContractError, match="no literal support"):
        resolve_dialogue(scan, "fill-gaps", lambda *_args: "Bob")
    original = next(row for row in scan["partition"] if row["renderRole"] == "dialogue")
    assert original["speakerStatus"] == "unlabelled"
    assert "resolvedSpeakerLabel" not in original


def test_configured_open_markers_remain_honestly_unresolved_after_ai():
    scan = scan_dialogue(
        [{"page": 1, "text": "???: [Stop.]"}],
        enabled_profile_ids=["label-brackets"],
        open_speaker_literals=["???"],
    )
    result = resolve_dialogue(scan, "fill-gaps", lambda *_args: "???")
    dialogue = next(row for row in result["partition"] if row["renderRole"] == "dialogue")
    assert dialogue["resolvedSpeakerLabel"] == "?"
    assert dialogue["speakerStatus"] == "unresolved"
    assert dialogue["fallback"] == "narrator"


def test_qwen_retries_mechanical_failure_but_publishes_only_complete_result(monkeypatch):
    from meowdiobooks.backend import dialogue_ai

    scan = scan_dialogue([{"page": 1, "text": "Alice waited. “Hello?”"}])
    outputs = iter(["", "Alice", "", "Alice"])
    calls = []

    @contextlib.contextmanager
    def server(_repo):
        yield "http://local"

    monkeypatch.setattr(dialogue_ai, "qwen_server", server)
    monkeypatch.setattr(
        dialogue_ai,
        "complete_text",
        lambda *args, **kwargs: (calls.append((args, kwargs)), next(outputs))[1],
    )

    result = dialogue_ai.run_dialogue_qwen(None, scan, "fill-gaps")

    dialogue = next(row for row in result["partition"] if row["renderRole"] == "dialogue")
    assert dialogue["resolvedSpeakerLabel"] == "Alice"
    assert len(calls) == 4
    assert calls[0][0][2] == calls[2][0][2]
    assert "TRY AGAIN" in calls[1][0][2]
    assert "TRY AGAIN" in calls[3][0][2]


def test_local_double_check_uses_identical_frozen_prompt_and_exact_normalized_agreement(
    monkeypatch,
):
    from meowdiobooks.backend import dialogue_ai

    scan = scan_dialogue([{"page": 1, "text": "Alice waited. “Hello?”"}])
    outputs = iter(["Alice", " alice "])
    calls = []
    progress = []

    @contextlib.contextmanager
    def server(_repo):
        yield "http://local"

    def complete(_base, system, prompt, **_kwargs):
        calls.append((system, prompt))
        return next(outputs)

    monkeypatch.setattr(dialogue_ai, "qwen_server", server)
    monkeypatch.setattr(dialogue_ai, "complete_text", complete)

    result = dialogue_ai.run_dialogue_qwen(
        None,
        scan,
        "fill-gaps",
        lambda percent, message=None: progress.append((percent, message)),
    )

    dialogue = next(row for row in result["partition"] if row["renderRole"] == "dialogue")
    assert dialogue["resolvedSpeakerLabel"] == "Alice"
    assert calls[0][0] == dialogue_ai.SYSTEM
    assert calls[1][0] == dialogue_ai.VERIFIER_SYSTEM
    assert calls[0][1] == calls[1][1]
    assert result["attributionChecks"] == [
        {
            "spanId": result["aiWindows"][0]["ownerIds"][0],
            "firstPass": "Alice",
            "secondPass": "alice",
            "final": "Alice",
            "outcome": "agreed",
            "suggestedSpeakers": [],
        }
    ]
    assert result["resultSummary"]["aiVerifierCalls"] == 1
    assert result["resultSummary"]["aiConsensusAccepted"] == 1
    assert result["resultSummary"]["aiConsensusWithheld"] == 0
    assert progress[-2][1] == "Using AI to identify speakers from nearby text"


def test_local_double_check_collates_supported_short_and_full_names(monkeypatch):
    from meowdiobooks.backend import dialogue_ai

    scan = scan_dialogue([{"page": 1, "text": "Lady Emilia waited. “Hello?”"}])
    outputs = iter(["Emilia", "Lady Emilia"])

    @contextlib.contextmanager
    def server(_repo):
        yield "http://local"

    monkeypatch.setattr(dialogue_ai, "qwen_server", server)
    monkeypatch.setattr(
        dialogue_ai,
        "complete_text",
        lambda *_args, **_kwargs: next(outputs),
    )

    result = dialogue_ai.run_dialogue_qwen(None, scan, "fill-gaps")

    dialogue = next(row for row in result["partition"] if row["renderRole"] == "dialogue")
    assert dialogue["resolvedSpeakerLabel"] == "Lady Emilia"
    assert dialogue["speakerStatus"] == "ai"
    assert result["attributionChecks"] == [
        {
            "spanId": dialogue["id"],
            "firstPass": "Emilia",
            "secondPass": "Lady Emilia",
            "final": "Lady Emilia",
            "outcome": "agreed",
            "suggestedSpeakers": [],
        }
    ]


def test_local_double_check_skips_verifier_for_question_marker_and_configured_unknown(
    monkeypatch,
):
    from meowdiobooks.backend import dialogue_ai

    @contextlib.contextmanager
    def server(_repo):
        yield "http://local"

    monkeypatch.setattr(dialogue_ai, "qwen_server", server)
    for marker in ("?", "???", "UNKNOWN"):
        scan = scan_dialogue(
            [{"page": 1, "text": f"{marker}: [Stop.]"}],
            enabled_profile_ids=["label-brackets"],
            open_speaker_literals=[marker],
        )
        calls = []
        monkeypatch.setattr(
            dialogue_ai,
            "complete_text",
            lambda *_args, **_kwargs: (calls.append(marker), marker)[1],
        )

        result = dialogue_ai.run_dialogue_qwen(None, scan, "fill-gaps")

        dialogue = next(row for row in result["partition"] if row["renderRole"] == "dialogue")
        assert calls == [marker]
        assert dialogue["resolvedSpeakerLabel"] == "?"
        assert dialogue["speakerStatus"] == "unresolved"
        assert result["attributionChecks"][0] == {
            "spanId": result["aiWindows"][0]["ownerIds"][0],
            "firstPass": "?",
            "secondPass": None,
            "final": "?",
            "outcome": "base-unresolved",
            "suggestedSpeakers": [],
        }
        assert result["resultSummary"]["aiVerifierCalls"] == 0

    scan = scan_dialogue(
        [{"page": 1, "text": "Unidentified Voice: [Stop.]"}],
        enabled_profile_ids=["label-brackets"],
        open_speaker_patterns=[r"Unidentified\s+Voice"],
    )
    calls = []
    monkeypatch.setattr(
        dialogue_ai,
        "complete_text",
        lambda *_args, **_kwargs: (
            calls.append("Unidentified Voice"),
            "Unidentified Voice",
        )[1],
    )

    result = dialogue_ai.run_dialogue_qwen(None, scan, "fill-gaps")

    assert calls == ["Unidentified Voice"]
    assert result["attributionChecks"][0]["final"] == "?"
    assert result["resultSummary"]["aiVerifierCalls"] == 0

    scan = scan_dialogue(
        [{"page": 1, "text": "???: [Stop.]"}],
        enabled_profile_ids=["label-brackets"],
        open_speaker_literals=["Unidentified Voice", "???"],
    )
    calls = []
    monkeypatch.setattr(
        dialogue_ai,
        "complete_text",
        lambda *_args, **_kwargs: (
            calls.append("Unidentified   Voice"),
            "Unidentified   Voice",
        )[1],
    )

    result = dialogue_ai.run_dialogue_qwen(None, scan, "fill-gaps")

    assert calls == ["Unidentified   Voice"]
    assert result["attributionChecks"][0]["final"] == "?"
    assert result["resultSummary"]["aiVerifierCalls"] == 0


def test_local_double_check_requires_verifier_agreement_for_surrounding_text(monkeypatch):
    from meowdiobooks.backend import dialogue_ai

    scan = scan_dialogue(
        [{"page": 1, "text": 'He called it "night glass" in the report.'}],
        enabled_profile_ids=["unlabeled-straight-quotes"],
    )
    calls = []

    @contextlib.contextmanager
    def server(_repo):
        yield "http://local"

    monkeypatch.setattr(dialogue_ai, "qwen_server", server)
    monkeypatch.setattr(
        dialogue_ai,
        "complete_text",
        lambda *_args, **_kwargs: (calls.append("/"), "/")[1],
    )

    result = dialogue_ai.run_dialogue_qwen(None, scan, "fill-gaps")

    assert calls == ["/", "/"]
    assert result["partition"][0]["renderRole"] == "narration"
    assert result["partition"][0]["origin"] == "qwen:not-vocalisation"
    assert result["attributionChecks"][0]["outcome"] == "agreed"
    assert result["resultSummary"]["aiVerifierCalls"] == 1


def test_local_double_check_keeps_a_slash_disagreement_as_separate_narrator_dialogue(
    monkeypatch,
):
    from meowdiobooks.backend import dialogue_ai

    scan = scan_dialogue(
        [{"page": 1, "text": 'Alice waited. "Hello."'}],
        enabled_profile_ids=["unlabeled-straight-quotes"],
    )
    outputs = iter(["/", "Alice"])

    @contextlib.contextmanager
    def server(_repo):
        yield "http://local"

    monkeypatch.setattr(dialogue_ai, "qwen_server", server)
    monkeypatch.setattr(
        dialogue_ai, "complete_text", lambda *_args, **_kwargs: next(outputs)
    )

    result = dialogue_ai.run_dialogue_qwen(None, scan, "fill-gaps")

    dialogue = next(row for row in result["partition"] if row["renderRole"] == "dialogue")
    assert dialogue["speakerStatus"] == "unresolved"
    assert dialogue["fallback"] == "narrator"
    assert result["attributionChecks"][0]["final"] == "?"
    assert result["attributionChecks"][0]["suggestedSpeakers"] == ["Alice"]


def test_local_double_check_withholds_disagreement_or_unsupported_exact_name(monkeypatch):
    from meowdiobooks.backend import dialogue_ai

    @contextlib.contextmanager
    def server(_repo):
        yield "http://local"

    monkeypatch.setattr(dialogue_ai, "qwen_server", server)
    cases = [
        ("Alice and Bob waited. “Hello.”", ["Alice", "Bob"], ["Alice", "Bob"]),
        ("Alice waited. “Hello.”", ["Alice", "?"], ["Alice"]),
        ("Alice waited. “Hello.”", ["Bob", "Bob"], []),
    ]
    for source, answers, suggestions in cases:
        scan = scan_dialogue([{"page": 1, "text": source}])
        outputs = iter(answers)
        monkeypatch.setattr(
            dialogue_ai,
            "complete_text",
            lambda *_args, **_kwargs: next(outputs),
        )

        result = dialogue_ai.run_dialogue_qwen(None, scan, "fill-gaps")

        dialogue = next(row for row in result["partition"] if row["renderRole"] == "dialogue")
        assert dialogue["resolvedSpeakerLabel"] == "?"
        assert dialogue["speakerStatus"] == "unresolved"
        assert result["attributionChecks"][0]["outcome"] == "withheld"
        assert result["attributionChecks"][0]["suggestedSpeakers"] == suggestions
        assert result["resultSummary"]["aiConsensusWithheld"] == 1


def test_verifier_mechanical_exhaustion_aborts_without_mutating_scan(monkeypatch):
    from meowdiobooks.backend import dialogue_ai

    scan = scan_dialogue([{"page": 1, "text": "Alice waited. “Hello?”"}])
    original = [dict(row) for row in scan["partition"]]
    outputs = iter(["Alice", "", "Alice\nBob", "T001|Alice"])

    @contextlib.contextmanager
    def server(_repo):
        yield "http://local"

    monkeypatch.setattr(dialogue_ai, "qwen_server", server)
    monkeypatch.setattr(dialogue_ai, "complete_text", lambda *_args, **_kwargs: next(outputs))

    with pytest.raises(DialogueContractError, match="failed complete speaker-attribution"):
        dialogue_ai.run_dialogue_qwen(None, scan, "fill-gaps")

    assert scan["partition"] == original


def test_cross_page_double_check_keeps_one_owner_and_correction_updates_every_fragment(
    monkeypatch,
):
    from meowdiobooks.backend import dialogue_ai

    pages = [
        {"page": 1, "text": "Alice whispered:\n\n“Down the hole\n\n"},
        {"page": 2, "text": "and back again,” said Alice."},
    ]
    scan = scan_dialogue(pages)
    outputs = iter(["Alice", "Alice"])

    @contextlib.contextmanager
    def server(_repo):
        yield "http://local"

    monkeypatch.setattr(dialogue_ai, "qwen_server", server)
    monkeypatch.setattr(dialogue_ai, "complete_text", lambda *_args, **_kwargs: next(outputs))

    result = dialogue_ai.run_dialogue_qwen(None, scan, "fill-gaps")

    assert len(result["aiWindows"]) == 1
    assert len(result["attributionChecks"]) == 1
    fragments = [row for row in result["partition"] if row.get("turnGroupId")]
    assert len(fragments) == 2
    assert {row["resolvedSpeakerLabel"] for row in fragments} == {"Alice"}

    corrected = apply_dialogue_corrections(
        {**result, "revision": "candidate", "spans": result["partition"]},
        [
            {
                "spanId": result["aiWindows"][0]["ownerIds"][0],
                "action": "speaker",
                "speakerLabel": "White Rabbit",
            }
        ],
        revision="corrected",
    )

    corrected_fragments = [row for row in corrected["partition"] if row.get("turnGroupId")]
    assert len(corrected_fragments) == 2
    assert {row["resolvedSpeakerLabel"] for row in corrected_fragments} == {"White Rabbit"}
    assert {row["speakerStatus"] for row in corrected_fragments} == {"user"}
    assert corrected["attributionChecks"] == result["attributionChecks"]
    assert reconstruct_partition(corrected) == {1: pages[0]["text"], 2: pages[1]["text"]}


def test_fill_gaps_skips_model_load_when_every_detected_turn_has_explicit_label(monkeypatch):
    scan = scan_dialogue([{"page": 1, "text": "Subaru: [Run!]"}])
    monkeypatch.setattr(
        "meowdiobooks.backend.dialogue_ai.qwen_server",
        lambda *_args: pytest.fail("Qwen server should not load"),
    )

    result = run_dialogue_qwen(None, scan, "fill-gaps")

    assert result["resultSummary"]["explicitTurns"] == 1
    assert result["attributionChecks"] == []
    assert result["resultSummary"]["aiVerifierCalls"] == 0
    assert result["resultSummary"]["aiConsensusAccepted"] == 0
    assert result["resultSummary"]["aiConsensusWithheld"] == 0


def test_window_plan_rejects_unknown_ids():
    with pytest.raises(DialogueContractError, match="Unknown Dialogue targets"):
        plan_dialogue_windows([{"id": "s1", "source": "One"}], ["missing"])
