import json
import re
from pathlib import Path

from meowdiobooks.backend.dialogue import scan_dialogue
from meowdiobooks.backend import dialogue_remote


REPO_ROOT = Path(__file__).resolve().parents[2]


def _target_ids(payload):
    prompt = next(
        str(item["content"])
        for item in payload["input"]
        if item.get("role") == "user" and "REQUESTED TARGET IDS:" in str(item.get("content"))
    )
    section = prompt.split("REQUESTED TARGET IDS:\n", 1)[1].split("\n\nORDERED LOCAL SCENE:", 1)[0]
    return [line[2:] for line in section.splitlines() if line.startswith("- ")]


def _decision(target_id, speaker="?", *, classification="D"):
    return {
        "targetId": target_id,
        "classification": classification,
        "speaker": "" if classification == "N" else speaker,
        "confidence": "high",
        "basis": "explicit-local" if classification == "D" else "not-dialogue",
        "evidencePages": [1],
        "evidenceQuote": "source evidence",
        "attributionReason": "The local speech tag identifies the speaker.",
        "outsideEvidenceUsed": False,
        "unresolvedReason": "",
    }


def _response(target_ids, speaker="?", *, classification="D", usage=True):
    text = json.dumps(
        {
            "decisions": [
                _decision(target_id, speaker, classification=classification)
                for target_id in target_ids
            ]
        }
    )
    return {
        "id": "response-1",
        "model": "test-luna",
        "usage": {"input_tokens": 100, "output_tokens": 10} if usage else {},
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
    }


def _install_speakers(monkeypatch, speakers):
    calls = []

    def factory(_config, effort, _observer, *, request_admission=None):
        def call(payload):
            calls.append((effort, payload))
            return _response(_target_ids(payload), speakers[effort])

        return call

    monkeypatch.setattr(dialogue_remote, "_responses_api_call", factory)
    return calls


def _single_dialogue(result):
    return next(span for span in result["partition"] if span.get("renderRole") == "dialogue")


def test_dual_pass_windows_use_eight_page_scenes_and_configured_batch_size():
    spans = [
        {"id": f"span-{index}", "page": 1 if index < 9 else 9}
        for index in range(13)
    ]
    target_ids = [str(span["id"]) for span in spans]

    windows = dialogue_remote._dialogue_windows(
        spans,
        target_ids,
        window_pages=8,
        max_targets=8,
    )

    assert [window["ownerIds"] for window in windows] == [
        target_ids[:8],
        target_ids[8:9],
        target_ids[9:],
    ]
    assert [window["contextPages"] for window in windows] == [[1], [1], [9]]


def test_dual_pass_accepts_independent_agreement_and_preserves_shared_contract(monkeypatch):
    calls = _install_speakers(
        monkeypatch,
        {"low": "Alice", "medium": "Alice", "high": "unused"},
    )
    scan = scan_dialogue(
        [{"page": 1, "text": "Alice leaned closer. “Come with me,” she said."}]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    attributed = _single_dialogue(result)
    assert attributed["resolvedSpeakerLabel"] == "Alice"
    assert attributed["speakerStatus"] == "ai"
    assert attributed["origin"] == "remote:dual-pass-with-tools-v1"
    assert [effort for effort, _payload in calls] == ["low", "medium"]
    assert result["attributionRoute"] == "remote"
    assert result["resultSummary"]["aiConsensusAccepted"] == 1
    assert result["remoteUsage"] == {
        "inputTokens": 200,
        "cachedInputTokens": 0,
        "cacheWriteInputTokens": 0,
        "outputTokens": 20,
        "estimatedCostUsd": 0.0001,
        "modelProfile": "luna-dialogue",
        "modelDisplayName": "Luna",
        "providerModels": ["test-luna"],
        "policy": "dual-pass-with-tools-v1",
        "physicalRequests": 2,
        "toolCalls": 0,
        "adjudicatedTargets": 0,
    }


def test_meaningful_disagreement_is_adjudicated_instead_of_blanket_withheld(monkeypatch):
    calls = _install_speakers(
        monkeypatch,
        {"low": "Alice", "medium": "Bob", "high": "Carol"},
    )
    scan = scan_dialogue(
        [
            {
                "page": 1,
                "text": "Alice, Bob, and Carol waited. “Come with me,” someone said.",
            }
        ]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    attributed = _single_dialogue(result)
    assert attributed["resolvedSpeakerLabel"] == "Carol"
    assert [effort for effort, _payload in calls] == ["low", "medium", "high"]
    assert result["remoteUsage"]["adjudicatedTargets"] == 1
    assert result["remoteUsage"]["physicalRequests"] == 3
    assert result["attributionChecks"][0]["resolution"] == "adjudicated"


def test_surface_compatible_names_choose_stronger_pass_without_alias_prompt(monkeypatch):
    calls = _install_speakers(
        monkeypatch,
        {"low": "Alice", "medium": "Alice Smith", "high": "unused"},
    )
    scan = scan_dialogue(
        [{"page": 1, "text": "Alice Smith waited. “Come with me,” Alice said."}]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    assert _single_dialogue(result)["resolvedSpeakerLabel"] == "Alice Smith"
    assert [effort for effort, _payload in calls] == ["low", "medium"]
    assert all("alias" not in json.dumps(payload).casefold() for _effort, payload in calls)


def test_stronger_pass_can_read_beyond_scene_with_model_shaped_output(monkeypatch):
    calls = []
    medium_requests = 0

    def factory(_config, effort, _observer, *, request_admission=None):
        def call(payload):
            nonlocal medium_requests
            calls.append((effort, payload))
            target_ids = _target_ids(payload)
            if effort == "medium" and medium_requests == 0:
                medium_requests += 1
                return {
                    "id": "tool-response",
                    "model": "test-luna",
                    "usage": {"input_tokens": 50, "output_tokens": 5},
                    "output": [
                        {
                            "type": "function_call",
                            "call_id": "tool-1",
                            "name": "read_beyond_scene",
                            "arguments": json.dumps(
                                {"direction": "after", "page_count": 1}
                            ),
                        }
                    ],
                }
            return _response(target_ids, "Alice")

        return call

    monkeypatch.setattr(dialogue_remote, "_responses_api_call", factory)
    scan = scan_dialogue(
        [
            {"page": 8, "text": "Alice waited. “Who is there?”"},
            {"page": 9, "text": "Alice lowered her hand after asking the question."},
        ]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    medium_second_payload = [payload for effort, payload in calls if effort == "medium"][-1]
    tool_output = next(
        item["output"]
        for item in medium_second_payload["input"]
        if item.get("type") == "function_call_output"
    )
    assert "OUTSIDE-SCENE CONTINUATION — AFTER" in tool_output
    assert "Alice lowered her hand" in tool_output
    assert result["remoteUsage"]["toolCalls"] == 1
    assert result["remoteUsage"]["physicalRequests"] == 3


def test_generic_roles_are_guarded_to_question_mark_and_not_suggested(monkeypatch):
    _install_speakers(
        monkeypatch,
        {"low": "Guard", "medium": "Guard", "high": "unused"},
    )
    scan = scan_dialogue(
        [{"page": 1, "text": "The guard raised a hand. “Stop there,” he said."}]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    attributed = _single_dialogue(result)
    assert attributed["speakerStatus"] == "unresolved"
    assert result["attributionChecks"][0]["suggestedSpeakers"] == []


def test_attribution_does_not_add_a_step_specific_punctuation_filter(monkeypatch):
    _install_speakers(
        monkeypatch,
        {"low": "Alice", "medium": "Alice", "high": "unused"},
    )
    scan = scan_dialogue(
        [{"page": 1, "text": "Alice watched the signal. “----”"}]
    )

    result = dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    attributed = _single_dialogue(result)
    assert attributed["resolvedSpeakerLabel"] == "Alice"
    assert attributed["speakerStatus"] == "ai"


def test_every_payload_disables_provider_storage_and_uses_strict_schema(monkeypatch):
    calls = _install_speakers(
        monkeypatch,
        {"low": "Alice", "medium": "Alice", "high": "unused"},
    )
    scan = scan_dialogue(
        [{"page": 1, "text": "Alice waited. “Ready?” she asked."}]
    )

    dialogue_remote.run_dialogue_remote(
        REPO_ROOT,
        scan,
        "fill-gaps",
        attribution_targets=["unlabelled-candidates"],
    )

    assert all(payload["store"] is False for _effort, payload in calls)
    assert all(payload["text"]["format"]["strict"] is True for _effort, payload in calls)
    assert all(
        payload["text"]["format"]["schema"]["additionalProperties"] is False
        for _effort, payload in calls
    )
    assert all(not re.search(r"\balias(?:es)?\b", json.dumps(payload), re.I) for _, payload in calls)
