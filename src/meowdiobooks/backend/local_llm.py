"""Small, pinned llama.cpp client for local wizard enrichment."""

from __future__ import annotations

import json
import http.client
import subprocess
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator

from .model_config import asset_path, load_model_registry


class LocalModelUnavailableError(RuntimeError):
    """A recoverable local-model transport failure with a user-safe message."""

    public_message = (
        "This step was interrupted. Try again; "
        "accepted work is unchanged."
    )


@contextmanager
def qwen_server(repo_root: Path, port: int = 18083) -> Iterator[str]:
    configured = load_model_registry(repo_root).active_text_model()
    server = asset_path(repo_root, configured.runtime_path)
    model = asset_path(repo_root, configured.model_path)
    if not server.is_file() or not model.is_file():
        raise RuntimeError("The pinned local Qwen 9B runtime is not installed")
    process = subprocess.Popen(
        [
            str(server),
            "-m",
            str(model),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "-c",
            str(configured.context_size),
            "-ngl",
            str(configured.gpu_layers),
            "--jinja",
            "--no-webui",
            "--parallel",
            "1",
            "--cache-ram",
            "0",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(180):
            try:
                urllib.request.urlopen(f"{base}/health", timeout=1).read()
                break
            except (OSError, urllib.error.URLError):
                if process.poll() is not None:
                    raise RuntimeError(f"llama-server exited with code {process.returncode}")
                time.sleep(0.5)
        else:
            raise TimeoutError("Local Qwen 9B did not become ready")
        yield base
    finally:
        process.terminate()
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def _complete(
    base: str,
    system: str,
    prompt: str,
    *,
    max_tokens: int,
    parse: Callable[[str], Any],
    retry_instruction: str,
    output_kind: str,
    response_format: dict[str, str] | None = None,
) -> Any:
    """Share transport recovery while keeping output-contract retries bounded."""
    failures: list[str] = []
    attempt = 1
    readiness_deadline = time.monotonic() + 120
    while attempt <= 3:
        payload: dict[str, Any] = {
            "model": "qwen3.5-9b",
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": prompt + (retry_instruction if attempt > 1 else ""),
                },
            ],
            "temperature": 0.0,
            "max_tokens": max_tokens,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        if response_format is not None:
            payload["response_format"] = response_format
        request = urllib.request.Request(
            f"{base}/v1/chat/completions",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            response = json.loads(urllib.request.urlopen(request, timeout=600).read())
            text = str(response["choices"][0]["message"]["content"]).strip()
            return parse(text)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:2000]
            if error.code == 503 and time.monotonic() < readiness_deadline:
                time.sleep(3)
                continue
            if error.code == 503:
                raise LocalModelUnavailableError(
                    f"Local Qwen remained unavailable: HTTP 503: {detail}"
                ) from error
            failures.append(f"attempt {attempt}: HTTP {error.code}: {detail}")
        except (OSError, urllib.error.URLError, http.client.HTTPException) as error:
            if time.monotonic() < readiness_deadline:
                time.sleep(3)
                continue
            raise LocalModelUnavailableError(
                f"Local Qwen transport failed: {type(error).__name__}: {error}"
            ) from error
        except (KeyError, TypeError, ValueError) as error:
            failures.append(f"attempt {attempt}: {type(error).__name__}: {error}")
        attempt += 1
    raise RuntimeError(
        f"Local Qwen returned no valid {output_kind} after 3 attempts. "
        + " | ".join(failures)
    )


def complete_json(base: str, system: str, prompt: str, max_tokens: int = 1400) -> Any:
    def parse(text: str) -> Any:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end < start:
            raise ValueError("response contained no JSON object")
        return json.loads(text[start : end + 1])

    return _complete(
        base,
        system,
        prompt,
        max_tokens=max_tokens,
        parse=parse,
        retry_instruction=(
            "\nYour previous response was not valid JSON. Return only one strict JSON object; "
            "double-quote every property name and string."
        ),
        output_kind="JSON",
        response_format={"type": "json_object"},
    )


def complete_text(base: str, system: str, prompt: str, max_tokens: int = 4000) -> str:
    """Return one non-empty plain-text completion using shared model recovery."""

    def parse(text: str) -> str:
        if not text:
            raise ValueError("response was empty")
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else ""
            text = text.rsplit("```", 1)[0].strip()
        if text:
            return text
        raise ValueError("response contained no rows")

    return _complete(
        base,
        system,
        prompt,
        max_tokens=max_tokens,
        parse=parse,
        retry_instruction=(
            "\nYour previous response was invalid. Follow the system instructions exactly and "
            "return only the requested plain-text answer, with no header, prose or markdown."
        ),
        output_kind="text output",
    )
