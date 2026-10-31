import json
from io import BytesIO
import urllib.error

import pytest

from meowdiobooks.backend.local_llm import (
    LocalModelUnavailableError,
    complete_json,
    complete_text,
)


class Response(BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def completion(content: str) -> Response:
    return Response(json.dumps({"choices": [{"message": {"content": content}}]}).encode())


def test_complete_json_retries_malformed_model_response(monkeypatch):
    responses = iter(
        [
            completion('{bad: "json"}'),
            completion('{"labels": [{"key": "Mina"}]}'),
        ]
    )
    monkeypatch.setattr("urllib.request.urlopen", lambda *_args, **_kwargs: next(responses))

    result = complete_json("http://localhost", "Classify", "Evidence")

    assert result == {"labels": [{"key": "Mina"}]}


def test_complete_json_reports_all_failed_attempts(monkeypatch):
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *_args, **_kwargs: completion("not json"),
    )

    try:
        complete_json("http://localhost", "Classify", "Evidence")
    except RuntimeError as error:
        assert "after 3 attempts" in str(error)
        assert str(error).count("response contained no JSON object") == 3
    else:
        raise AssertionError("Expected malformed local-model responses to fail")


def test_complete_json_reports_transport_outage_as_recoverable(monkeypatch):
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            urllib.error.URLError(ConnectionRefusedError(61, "Connection refused"))
        ),
    )
    times = iter([0, 121])
    monkeypatch.setattr("time.monotonic", lambda: next(times))

    with pytest.raises(LocalModelUnavailableError) as captured:
        complete_json("http://localhost", "Classify", "Evidence")

    assert "transport failed" in str(captured.value)
    assert "Try again" in captured.value.public_message
    assert "no valid JSON" not in captured.value.public_message


def test_complete_text_removes_markdown_fence_and_returns_dense_rows(monkeypatch):
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *_args, **_kwargs: completion("```text\ns1|N\ns2|D|Alice\n```"),
    )

    assert complete_text("http://localhost", "Classify", "Evidence") == "s1|N\ns2|D|Alice"


def test_complete_text_waits_for_model_readiness_without_consuming_validation_attempts(
    monkeypatch,
):
    responses = iter(
        [
            urllib.error.HTTPError(
                "http://localhost",
                503,
                "Loading",
                {},
                BytesIO(b'{"error":"Loading model"}'),
            ),
            completion("s1|N"),
        ]
    )
    monkeypatch.setattr("urllib.request.urlopen", lambda *_args, **_kwargs: next(responses))
    monkeypatch.setattr("time.sleep", lambda _seconds: None)

    assert complete_text("http://localhost", "Classify", "Evidence") == "s1|N"


def test_complete_text_reports_transport_outage_as_recoverable(monkeypatch):
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            urllib.error.URLError(ConnectionRefusedError(61, "Connection refused"))
        ),
    )
    times = iter([0, 121])
    monkeypatch.setattr("time.monotonic", lambda: next(times))

    with pytest.raises(LocalModelUnavailableError) as captured:
        complete_text("http://localhost", "Attribute speaker", "Evidence")

    assert "Try again" in captured.value.public_message
    assert "no valid text" not in captured.value.public_message
