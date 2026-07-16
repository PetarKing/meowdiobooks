import json
from pathlib import Path

import pytest

from meowdiobooks.backend.model_config import load_model_registry
from meowdiobooks.backend.remote_llm import remote_chat_completion, remote_usage_cost


REPO_ROOT = Path(__file__).resolve().parents[2]


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def test_luna_uses_responses_without_remote_state_storage(monkeypatch):
    config = load_model_registry(REPO_ROOT).remote_dialogue_model()
    assert config is not None
    captured = {}

    def open_response(request, timeout):
        captured["url"] = request.full_url
        captured["payload"] = json.loads(request.data)
        captured["timeout"] = timeout
        return _Response(
            {
                "model": "gpt-5.6-luna",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "T001|D|Alice"}],
                    }
                ],
                "usage": {
                    "input_tokens": 100,
                    "input_tokens_details": {"cached_tokens": 20},
                    "output_tokens": 10,
                },
            }
        )

    monkeypatch.setattr(
        "meowdiobooks.backend.remote_llm.configured_api_key",
        lambda *_args: "test-key",
    )
    monkeypatch.setattr("urllib.request.urlopen", open_response)

    result = remote_chat_completion(
        REPO_ROOT, config, "system rules", "source passage", max_completion_tokens=500
    )

    assert captured["url"] == "https://api.openai.com/v1/responses"
    assert captured["payload"] == {
        "model": "gpt-5.6-luna",
        "instructions": "system rules",
        "input": "source passage",
        "max_output_tokens": 500,
        "store": False,
        "reasoning": {"effort": "low"},
    }
    assert result["text"] == "T001|D|Alice"
    assert result["usage"]["input_tokens"] == 100
    assert remote_usage_cost(config, result["usage"]) == pytest.approx(0.000142)
