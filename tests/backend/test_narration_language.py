from pathlib import Path

import pytest

from meowdiobooks.backend import narration_language as detection
from meowdiobooks.backend.remote_llm import RemoteModelUnavailableError

ROOT = Path(__file__).resolve().parents[2]
CHOICES = ["english", "french", "spanish", "other"]


def answer(scores):
    return {"answers": [{"name": "language", "type": "choice", "probabilities": [
        {"value": language, "probability": value} for language, value in zip(CHOICES, scores)
    ]}]}


def test_one_bounded_request_returns_probabilities_and_preserves_host_hooks(monkeypatch):
    calls = []
    observer, admission = object(), object()

    def complete(_root, config, prompt, questions, **kwargs):
        calls.append((prompt, questions, kwargs))
        assert config.engine == "openai_decisions"
        return answer([0.05, 0.9, 0.04, 0.01])

    monkeypatch.setattr(detection, "remote_decisions_completion", complete)
    result = detection.suggest_narration_language(
        ROOT, [{"text": "Bonjour le monde. " * 3000}], CHOICES[:-1],
        usage_observer=observer, request_admission=admission,
    )
    assert result == {"detectedLanguage": "french", "languageProbabilities": {
        "english": 0.05, "french": 0.9, "spanish": 0.04,
    }}
    assert len(calls) == 1
    prompt, questions, kwargs = calls[0]
    assert len(prompt) < 4500
    assert len(questions) == 1
    assert [row["value"] for row in questions[0]["choices"]] == CHOICES
    assert kwargs == {"usage_observer": observer, "request_admission": admission}


@pytest.mark.parametrize("response", [None, {}, answer([0.1]), answer([0.1, 0.1, 0.1, 0.1]),
                                     answer([float("nan"), 0, 0, 1]), answer([True, 0, 0, 0]),
                                     answer([10**400, 0, 0, 0]), answer([-10**400, 0, 0, 0])])
def test_invalid_probabilities_preserve_script_fallback(monkeypatch, response):
    monkeypatch.setattr(detection, "remote_decisions_completion", lambda *a, **k: response)
    assert detection.suggest_narration_language(ROOT, [{"text": "普通话中文小说的故事和人物对话。"}], CHOICES[:-1]) == {
        "detectedLanguage": "chinese",
    }


def test_unsupported_language_does_not_auto_select_supported_runner_up(monkeypatch):
    monkeypatch.setattr(detection, "remote_decisions_completion", lambda *a, **k: answer([0.01, 0.01, 0.01, 0.97]))
    result = detection.suggest_narration_language(ROOT, [{"text": "Een Nederlands verhaal."}], CHOICES[:-1])
    assert result["detectedLanguage"] == ""
    assert set(result["languageProbabilities"]) == set(CHOICES[:-1])


def test_provider_failure_falls_back_but_host_denial_propagates(monkeypatch):
    def unavailable(*a, **k):
        raise RemoteModelUnavailableError("Offline")

    monkeypatch.setattr(detection, "remote_decisions_completion", unavailable)
    assert detection.suggest_narration_language(ROOT, [{"text": "Hello."}], CHOICES[:-1]) == {"detectedLanguage": "english"}

    def denied(*a, **k):
        raise PermissionError("Host policy")

    monkeypatch.setattr(detection, "remote_decisions_completion", denied)
    with pytest.raises(PermissionError, match="Host policy"):
        detection.suggest_narration_language(ROOT, [{"text": "Hello."}], CHOICES[:-1])


def test_blank_transcript_never_calls_provider(monkeypatch):
    monkeypatch.setattr(detection, "remote_decisions_completion", lambda *a, **k: pytest.fail("Unexpected network call"))
    assert detection.suggest_narration_language(ROOT, [], CHOICES[:-1]) == {"detectedLanguage": "english"}
