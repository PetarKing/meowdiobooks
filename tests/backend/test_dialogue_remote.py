from pathlib import Path
from threading import Barrier

from meowdiobooks.backend.dialogue import scan_dialogue
from meowdiobooks.backend.dialogue_remote import (
    parse_remote_rows,
    remote_dialogue_windows,
    run_dialogue_remote,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_remote_rows_enforce_order_and_classification_contract():
    assert parse_remote_rows("T001|D|Alice\nT002|D|?\nT003|N", ["T001", "T002", "T003"]) == {
        "T001": "Alice",
        "T002": "?",
        "T003": "/",
    }


def test_remote_dialogue_batches_targets_by_configured_size_without_capping_it():
    spans = [{"id": f"span-{index}", "page": 1} for index in range(13)]
    target_ids = [str(span["id"]) for span in spans]

    windows = remote_dialogue_windows(spans, target_ids, max_targets_per_batch=6)

    assert [window["ownerIds"] for window in windows] == [
        target_ids[:6],
        target_ids[6:12],
        target_ids[12:],
    ]
    assert all(window["partition"] == spans for window in windows)
    assert (
        remote_dialogue_windows(spans, target_ids, max_targets_per_batch=100)[0]["ownerIds"]
        == target_ids
    )


def test_remote_dialogue_runs_six_batches_with_two_matching_passes_each(monkeypatch):
    scan = scan_dialogue(
        [
            {"page": page, "text": f"“Dialogue on page {page},” someone said."}
            for page in range(1, 12, 2)
        ]
    )
    all_requests_started = Barrier(12, timeout=5)

    def complete(_repo_root, _config, _system, _prompt, **_kwargs):
        all_requests_started.wait()
        return {
            "text": "T001|D|?",
            "usage": {},
            "model": "test-luna",
            "attempts": 1,
        }

    monkeypatch.setattr("meowdiobooks.backend.dialogue_remote.remote_chat_completion", complete)

    result = run_dialogue_remote(
        REPO_ROOT, scan, "fill-gaps", attribution_targets=["unlabelled-candidates"]
    )

    assert result["resultSummary"]["aiVerifierCalls"] == 12


def test_remote_dialogue_keeps_only_exact_two_pass_name_agreement(monkeypatch):
    scan = scan_dialogue([{"page": 1, "text": "Alice leaned closer. “Come with me,” she said."}])

    def complete(_repo_root, _config, system, _prompt, **_kwargs):
        speaker = "Alice" if "forensic" not in system else "Alice"
        return {
            "text": f"T001|D|{speaker}",
            "usage": {"prompt_tokens": 100, "completion_tokens": 10},
            "model": "test-luna",
            "attempts": 1,
        }

    monkeypatch.setattr("meowdiobooks.backend.dialogue_remote.remote_chat_completion", complete)
    result = run_dialogue_remote(
        REPO_ROOT, scan, "fill-gaps", attribution_targets=["unlabelled-candidates"]
    )

    attributed = next(span for span in result["partition"] if span.get("renderRole") == "dialogue")
    assert attributed["resolvedSpeakerLabel"] == "Alice"
    assert attributed["speakerStatus"] == "ai"
    assert attributed["origin"] == "remote:dual-perspective-exact"
    assert result["attributionRoute"] == "remote"
    assert result["resultSummary"]["aiConsensusAccepted"] == 1
    assert result["remoteUsage"] == {
        "inputTokens": 200,
        "cachedInputTokens": 0,
        "outputTokens": 20,
        "estimatedCostUsd": 0.0003,
        "modelProfile": "luna-dialogue",
        "modelDisplayName": "Luna",
        "providerModels": ["test-luna"],
    }


def test_remote_dialogue_withholds_disagreement_instead_of_guessing(monkeypatch):
    scan = scan_dialogue(
        [{"page": 1, "text": "Alice and Bob waited. “Come with me,” someone said."}]
    )

    def complete(_repo_root, _config, system, _prompt, **_kwargs):
        speaker = "Bob" if "forensic" in system else "Alice"
        return {
            "text": f"T001|D|{speaker}",
            "usage": {},
            "model": "test-luna",
            "attempts": 1,
        }

    monkeypatch.setattr("meowdiobooks.backend.dialogue_remote.remote_chat_completion", complete)
    result = run_dialogue_remote(
        REPO_ROOT, scan, "fill-gaps", attribution_targets=["unlabelled-candidates"]
    )

    attributed = next(span for span in result["partition"] if span.get("renderRole") == "dialogue")
    assert attributed["speakerStatus"] == "unresolved"
    assert attributed["fallback"] == "narrator"
    assert result["resultSummary"]["aiConsensusWithheld"] == 1
    assert result["resultSummary"]["aiSuggestedForReview"] == 1
    assert result["attributionChecks"] == [
        {
            "spanId": attributed["id"],
            "firstPass": "Alice",
            "secondPass": "Bob",
            "final": "?",
            "outcome": "withheld",
            "suggestedSpeakers": ["Alice", "Bob"],
        }
    ]


def test_remote_dialogue_keeps_one_supported_name_as_review_only_suggestion(monkeypatch):
    scan = scan_dialogue(
        [{"page": 1, "text": "Alice waited by the door. “Come with me,” someone said."}]
    )

    def complete(_repo_root, _config, system, _prompt, **_kwargs):
        speaker = "?" if "forensic" in system else "Alice"
        return {
            "text": f"T001|D|{speaker}",
            "usage": {},
            "model": "test-luna",
            "attempts": 1,
        }

    monkeypatch.setattr("meowdiobooks.backend.dialogue_remote.remote_chat_completion", complete)
    result = run_dialogue_remote(
        REPO_ROOT, scan, "fill-gaps", attribution_targets=["unlabelled-candidates"]
    )

    attributed = next(span for span in result["partition"] if span.get("renderRole") == "dialogue")
    assert attributed["speakerStatus"] == "unresolved"
    assert attributed.get("resolvedSpeakerLabel") in {None, "?"}
    assert result["attributionChecks"][0]["suggestedSpeakers"] == ["Alice"]


def test_remote_dialogue_does_not_identity_map_short_and_full_names(monkeypatch):
    scan = scan_dialogue(
        [
            {
                "page": 1,
                "text": "Alice Smith waited by the door. “Come with me,” Alice said.",
            }
        ]
    )

    def complete(_repo_root, _config, system, _prompt, **_kwargs):
        speaker = "Alice Smith" if "forensic" in system else "Alice"
        return {
            "text": f"T001|D|{speaker}",
            "usage": {},
            "model": "test-luna",
            "attempts": 1,
        }

    monkeypatch.setattr("meowdiobooks.backend.dialogue_remote.remote_chat_completion", complete)
    result = run_dialogue_remote(
        REPO_ROOT, scan, "fill-gaps", attribution_targets=["unlabelled-candidates"]
    )

    attributed = next(span for span in result["partition"] if span.get("renderRole") == "dialogue")
    assert attributed["speakerStatus"] == "unresolved"
    assert result["attributionChecks"][0]["suggestedSpeakers"] == [
        "Alice",
        "Alice Smith",
    ]


def test_remote_dialogue_does_not_offer_unsupported_disagreement_name(monkeypatch):
    scan = scan_dialogue(
        [{"page": 1, "text": "Alice waited by the door. “Come with me,” someone said."}]
    )

    def complete(_repo_root, _config, system, _prompt, **_kwargs):
        speaker = "?" if "forensic" in system else "Carol"
        return {
            "text": f"T001|D|{speaker}",
            "usage": {},
            "model": "test-luna",
            "attempts": 1,
        }

    monkeypatch.setattr("meowdiobooks.backend.dialogue_remote.remote_chat_completion", complete)
    result = run_dialogue_remote(
        REPO_ROOT, scan, "fill-gaps", attribution_targets=["unlabelled-candidates"]
    )

    assert result["attributionChecks"][0]["suggestedSpeakers"] == []
    assert result["resultSummary"]["aiSuggestedForReview"] == 0


def test_remote_dialogue_uses_the_same_larger_passage_for_final_evidence(monkeypatch):
    scan = scan_dialogue(
        [
            {
                "page": 20,
                "text": (
                    "Basil Hallward set down his brush. "
                    "He looked toward the unfinished portrait. "
                    "“I will not send it anywhere.”"
                ),
            }
        ]
    )

    monkeypatch.setattr(
        "meowdiobooks.backend.dialogue_remote.remote_chat_completion",
        lambda *_args, **_kwargs: {
            "text": "T001|D|Basil Hallward",
            "usage": {},
            "model": "test-luna",
            "attempts": 1,
        },
    )

    result = run_dialogue_remote(
        REPO_ROOT, scan, "fill-gaps", attribution_targets=["unlabelled-candidates"]
    )

    attributed = next(span for span in result["partition"] if span.get("renderRole") == "dialogue")
    assert attributed["resolvedSpeakerLabel"] == "Basil Hallward"
    assert attributed["speakerStatus"] == "ai"


def test_remote_dialogue_normalises_pdf_spacing_and_indexes_all_continued_fragments(
    monkeypatch,
):
    scan = scan_dialogue(
        [
            {
                "page": 1,
                "text": 'Basil    Hallward began.\n\n"A long confession\n\n5',
            },
            {"page": 2, "text": 'continues on the next page."'},
        ]
    )
    prompts = []

    def complete(_repo_root, _config, _system, prompt, **_kwargs):
        prompts.append(prompt)
        return {
            "text": "T001|D|Basil Hallward",
            "usage": {},
            "model": "test-luna",
            "attempts": 1,
        }

    monkeypatch.setattr("meowdiobooks.backend.dialogue_remote.remote_chat_completion", complete)

    result = run_dialogue_remote(
        REPO_ROOT, scan, "fill-gaps", attribution_targets=["unlabelled-candidates"]
    )

    continued = [row for row in result["partition"] if row.get("turnGroupId")]
    assert len(continued) == 2
    assert {row["resolvedSpeakerLabel"] for row in continued} == {"Basil Hallward"}
    ledger = next(prompt for prompt in prompts if "ORDERED TARGET INDEX" in prompt)
    target_index = ledger.split("ORDERED TARGET INDEX\n", 1)[1]
    assert "A long confession" in target_index
    assert "continues on the next page" in target_index
    assert "\n5" not in target_index
