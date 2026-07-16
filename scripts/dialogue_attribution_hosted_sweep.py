"""Run and score hosted Dialogue attribution models on the locked evaluation sample."""

from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from meowdiobooks.backend.dialogue_ai import _validate_speaker_evidence, parse_attribution_answer
from scripts.dialogue_attribution_experiment import (
    SYSTEM,
    _append_jsonl,
    _json_dump,
    _jsonl,
    _single_prompt,
    experiment_dossier,
)
from scripts.dialogue_attribution_full_consensus import _is_character, consensus_prediction

DEFAULT_CORPUS = Path("tmp/dialogue-attribution-experiment")
DEFAULT_OUTPUT = Path("tmp/dialogue-attribution-hosted-sweep")

MULTI_SYSTEM = """Attribute every marked target in the ordered source excerpt.

Return exactly one row per target, in target-ID order:
- T001|D|Actual Name  when it is spoken dialogue and the proper character name is supported
- T001|D|?            when it is spoken dialogue but the proper name is not reliably inferable
- T001|N              when it is quoted text that is not spoken aloud

Use the speaker's actual proper character name. Pronouns (he, she, they), generic descriptions
(the man, the old woman), and roles without a supported proper identity (the footman, the butler)
are not character names; return D|? instead. Follow the conversation in source order. A direct
attribution after a target wins. Do not copy the name of someone being addressed or discussed.
Do not invent a name from general book knowledge. Return only pipe-delimited rows, no prose or
Markdown."""

CONFIGS: dict[str, dict[str, Any]] = {
    "openai-luna-low": {
        "provider": "openai",
        "model": "gpt-5.6-luna",
        "reasoningEffort": "low",
        "minIntervalSeconds": 2.1,
        "inputUsdPerMillion": 1.0,
        "cachedInputUsdPerMillion": 0.1,
        "cacheWriteUsdPerMillion": 1.25,
        "outputUsdPerMillion": 6.0,
    },
    "openai-luna-medium": {
        "provider": "openai",
        "model": "gpt-5.6-luna",
        "reasoningEffort": "medium",
        "minIntervalSeconds": 2.1,
        "inputUsdPerMillion": 1.0,
        "cachedInputUsdPerMillion": 0.1,
        "cacheWriteUsdPerMillion": 1.25,
        "outputUsdPerMillion": 6.0,
    },
    "alibaba-qwen37-plus": {
        "provider": "alibaba",
        "model": "qwen3.7-plus",
        "inputUsdPerMillion": 0.4,
        "outputUsdPerMillion": 1.6,
    },
    "alibaba-qwen37-max": {
        "provider": "alibaba",
        "model": "qwen3.7-max",
        "inputUsdPerMillion": 2.5,
        "outputUsdPerMillion": 7.5,
    },
}


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


def _endpoint(config: Mapping[str, Any]) -> tuple[str, str]:
    if config["provider"] == "openai":
        return "https://api.openai.com/v1/chat/completions", os.environ["OPENAI_API_KEY"]
    base = os.environ["ALIBABA_API_BASE"].rstrip("/")
    return f"{base}/chat/completions", os.environ["ALIBABA_API_KEY"]


def hosted_request(
    config: Mapping[str, Any],
    prompt: str,
    *,
    system: str = SYSTEM,
    max_completion_tokens: int = 256,
) -> dict[str, Any]:
    endpoint, key = _endpoint(config)
    payload: dict[str, Any] = {
        "model": config["model"],
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "max_completion_tokens": max_completion_tokens,
    }
    if config.get("reasoningEffort"):
        payload["reasoning_effort"] = config["reasoningEffort"]
    if config["provider"] == "alibaba":
        # DashScope thinking is enabled by default and can consume the entire small
        # completion budget before emitting this one-token classification answer.
        payload["enable_thinking"] = False
    data = json.dumps(payload).encode()
    started = time.perf_counter()
    response = None
    attempts = 0
    for attempt, delay in enumerate((5, 15, 30, 45, 0), 1):
        attempts = attempt
        request = urllib.request.Request(
            endpoint,
            data=data,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            response = json.loads(urllib.request.urlopen(request, timeout=600).read())
            break
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:2_000]
            preview_permission_burst = (
                error.code == 401
                and config["provider"] == "openai"
                and "insufficient permissions" in detail.casefold()
            )
            retryable = error.code in {429, 500, 502, 503, 504} or preview_permission_burst
            if not retryable or not delay:
                raise RuntimeError(f"Hosted API HTTP {error.code}: {detail}") from error
            time.sleep(delay)
    if response is None:
        raise RuntimeError("Hosted API returned no response")
    return {
        "raw": str(response["choices"][0]["message"]["content"] or "").strip(),
        "usage": dict(response.get("usage", {})),
        "latencyMs": round((time.perf_counter() - started) * 1_000),
        "responseModel": response.get("model"),
        "attempts": attempts,
    }


def _windows(corpus: Path) -> list[dict[str, Any]]:
    return list(json.loads((corpus / "corpus.json").read_text(encoding="utf-8"))["windows"])


def _selected_ids(windows: Sequence[Mapping[str, Any]], smoke: bool) -> set[str] | None:
    if not smoke:
        return None
    selected: set[str] = set()
    seen_books: set[str] = set()
    for window in windows:
        book = str(window["bookId"])
        if book in seen_books or not window["targetIds"]:
            continue
        selected.add(f"{book}:{window['targetIds'][0]}")
        seen_books.add(book)
    return selected


def ordered_window_prompt(
    window: Mapping[str, Any],
    owners: Sequence[str],
) -> tuple[str, dict[str, str], str]:
    partition = list(window["partition"])
    positions = {str(span["id"]): span for span in partition}
    id_to_owner = {f"T{index:03d}": str(owner) for index, owner in enumerate(owners, 1)}
    owner_to_id = {owner: target_id for target_id, owner in id_to_owner.items()}
    group_to_id: dict[str, str] = {}
    for owner, target_id in owner_to_id.items():
        span = positions[owner]
        group_id = span.get("turnGroupId")
        if group_id is not None:
            group_to_id[str(group_id)] = target_id

    segments: list[tuple[str | None, str]] = []
    for span in partition:
        marker = owner_to_id.get(str(span["id"]))
        if marker is None and span.get("turnGroupId") is not None:
            marker = group_to_id.get(str(span["turnGroupId"]))
        source = str(span.get("source", span.get("text", "")))
        if segments and segments[-1][0] == marker:
            previous_marker, previous_source = segments[-1]
            segments[-1] = (previous_marker, previous_source + source)
        else:
            segments.append((marker, source))
    rendered = []
    for marker, source in segments:
        if marker:
            rendered.append(f"[{marker}]\n{source}\n[/{marker}]")
        else:
            rendered.append(source)
    ordered_source = "\n".join(rendered)
    ids = ", ".join(id_to_owner)
    prompt = f"TARGET IDS\n{ids}\n\nORDERED SOURCE\n{ordered_source}"
    return prompt, id_to_owner, ordered_source


def parse_multi_rows(raw: str, expected_ids: Sequence[str]) -> dict[str, str]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rsplit("```", 1)[0].strip()
    parsed: dict[str, str] = {}
    pattern = re.compile(r"^(T\d{3})\|([DN])(?:\|(.+))?$")
    for line in (line.strip() for line in text.splitlines() if line.strip()):
        match = pattern.fullmatch(line)
        if not match:
            raise ValueError(f"Invalid multi-speaker row: {line!r}")
        target_id, classification, speaker = match.groups()
        if target_id in parsed:
            raise ValueError(f"Duplicate multi-speaker target: {target_id}")
        if classification == "N":
            if speaker is not None:
                raise ValueError(f"Narration row must not include a speaker: {line!r}")
            parsed[target_id] = "/"
        else:
            if speaker is None:
                raise ValueError(f"Dialogue row needs a speaker or ?: {line!r}")
            parsed[target_id] = parse_attribution_answer(speaker.strip())
    if list(parsed) != list(expected_ids):
        raise ValueError(
            f"Expected ordered targets {list(expected_ids)!r}, got {list(parsed)!r}"
        )
    return parsed


def run(repo_root: Path, corpus: Path, output: Path, label: str, smoke: bool = False) -> None:
    config = CONFIGS[label]
    load_dotenv(repo_root / ".env")
    windows = _windows(corpus)
    selected = _selected_ids(windows, smoke)
    suffix = "-smoke" if smoke else ""
    path = output / "runs" / f"{label}{suffix}.jsonl"
    completed = {str(row["sampleId"]) for row in _jsonl(path)}
    expected = sum(
        1
        for window in windows
        for owner in window["targetIds"]
        if selected is None or f"{window['bookId']}:{owner}" in selected
    )
    for window in windows:
        partition = list(window["partition"])
        for owner in window["targetIds"]:
            sample_id = f"{window['bookId']}:{owner}"
            if sample_id in completed or (selected is not None and sample_id not in selected):
                continue
            dossier = experiment_dossier(partition, str(owner), 1, 700)
            prompt = _single_prompt(dossier)
            response = hosted_request(config, prompt)
            parse_error = None
            prediction = None
            validator_accepted = None
            try:
                prediction = parse_attribution_answer(response["raw"])
                context = "\n".join(str(dossier[field]) for field in ("before", "target", "after"))
                try:
                    _validate_speaker_evidence(prediction, context, sample_id)
                    validator_accepted = True
                except Exception:
                    validator_accepted = False
            except Exception as error:
                parse_error = str(error)
            row = {
                "sampleId": sample_id,
                "bookId": window["bookId"],
                "windowId": window["id"],
                "variant": label,
                "callId": f"{label}:{sample_id}",
                "prediction": prediction,
                "raw": response["raw"],
                "parseError": parse_error,
                "validatorAccepted": validator_accepted,
                "latencyMs": response["latencyMs"],
                "usage": response["usage"],
                "responseModel": response["responseModel"],
                "attempts": response["attempts"],
                "configuredInterCallDelayMs": round(
                    float(config.get("minIntervalSeconds", 0)) * 1_000
                ),
                "promptCharacters": len(prompt),
            }
            _append_jsonl(path, [row])
            completed.add(sample_id)
            print(
                f"[{label}{suffix}] {len(completed)}/{expected} {sample_id} -> {prediction}",
                flush=True,
            )
            if config.get("minIntervalSeconds"):
                time.sleep(float(config["minIntervalSeconds"]))


def run_multi(repo_root: Path, corpus: Path, output: Path, label: str) -> None:
    config = CONFIGS[label]
    load_dotenv(repo_root / ".env")
    multi_label = f"{label}-multi"
    path = output / "runs" / f"{multi_label}.jsonl"
    completed = {str(row["sampleId"]) for row in _jsonl(path)}
    windows = _windows(corpus)
    expected_total = sum(len(window["targetIds"]) for window in windows)
    for window in windows:
        owners = [
            str(owner)
            for owner in window["targetIds"]
            if f"{window['bookId']}:{owner}" not in completed
        ]
        if not owners:
            continue
        prompt, id_to_owner, ordered_source = ordered_window_prompt(window, owners)
        response = None
        predictions = None
        parse_error = None
        retry_prompt = prompt
        for attempt in range(2):
            response = hosted_request(
                config,
                retry_prompt,
                system=MULTI_SYSTEM,
                max_completion_tokens=4_096,
            )
            try:
                predictions = parse_multi_rows(response["raw"], list(id_to_owner))
                parse_error = None
                break
            except Exception as error:
                parse_error = str(error)
                retry_prompt = (
                    prompt
                    + "\n\nCORRECTION\nYour prior output violated the row contract. Return exactly "
                    + f"{len(id_to_owner)} rows for {', '.join(id_to_owner)}, in that order."
                )
        assert response is not None
        call_id = f"{multi_label}:{window['id']}"
        for index, (target_id, owner) in enumerate(id_to_owner.items()):
            sample_id = f"{window['bookId']}:{owner}"
            prediction = predictions.get(target_id) if predictions is not None else None
            validator_accepted = None
            if prediction is not None:
                try:
                    _validate_speaker_evidence(prediction, ordered_source, sample_id)
                    validator_accepted = True
                except Exception:
                    validator_accepted = False
            row = {
                "sampleId": sample_id,
                "bookId": window["bookId"],
                "windowId": window["id"],
                "variant": multi_label,
                "callId": call_id,
                "prediction": prediction,
                "raw": response["raw"] if index == 0 else None,
                "parseError": parse_error,
                "validatorAccepted": validator_accepted,
                "latencyMs": response["latencyMs"] if index == 0 else 0,
                "usage": response["usage"] if index == 0 else {},
                "responseModel": response["responseModel"],
                "attempts": response["attempts"],
                "configuredInterCallDelayMs": (
                    round(float(config.get("minIntervalSeconds", 0)) * 1_000)
                    if index == 0
                    else 0
                ),
                "hostedCall": True,
                "promptCharacters": len(prompt) if index == 0 else 0,
            }
            _append_jsonl(path, [row])
            completed.add(sample_id)
        print(
            f"[{multi_label}] {len(completed)}/{expected_total} {window['id']} "
            f"({len(owners)} targets)",
            flush=True,
        )
        if config.get("minIntervalSeconds"):
            time.sleep(float(config["minIntervalSeconds"]))


def _normal(value: Any) -> str:
    return " ".join(str(value or "").split()).casefold()


def score(corpus: Path, output: Path, label: str) -> dict[str, Any]:
    gold = {str(row["sampleId"]): row for row in _jsonl(corpus / "gold.jsonl")}
    rows = {str(row["sampleId"]): row for row in _jsonl(output / "runs" / f"{label}.jsonl")}
    if set(rows) != set(gold):
        raise RuntimeError(f"Run coverage mismatch: expected={len(gold)} actual={len(rows)}")
    by_book: dict[str, dict[str, int]] = {}
    totals = {
        "samples": 0,
        "classificationCorrect": 0,
        "inferableSpeakerSamples": 0,
        "inferableSpeakerCorrect": 0,
        "unresolvedDialogueSamples": 0,
        "unresolvedCorrect": 0,
        "fullyUsable": 0,
        "characterAssignments": 0,
        "correctCharacterAssignments": 0,
        "falseCharacterAssignments": 0,
        "parseValid": 0,
    }
    for sample_id, expected in gold.items():
        row = rows[sample_id]
        prediction = row.get("prediction")
        predicted_class = "prose" if prediction == "/" else "dialogue"
        classification_correct = prediction is not None and predicted_class == expected["classification"]
        accepted = {
            _normal(expected.get("canonicalSpeaker")),
            *(_normal(alias) for alias in expected.get("acceptedAliases", [])),
        }
        inferable = expected["classification"] == "dialogue" and bool(expected.get("speakerInferable"))
        speaker_correct = inferable and _normal(prediction) in accepted
        unresolved = expected["classification"] == "dialogue" and not expected.get("speakerInferable")
        unresolved_correct = unresolved and prediction == "?"
        character = prediction is not None and prediction not in {"?", "/"}
        increments = {
            "samples": 1,
            "classificationCorrect": int(classification_correct),
            "inferableSpeakerSamples": int(inferable),
            "inferableSpeakerCorrect": int(speaker_correct),
            "unresolvedDialogueSamples": int(unresolved),
            "unresolvedCorrect": int(unresolved_correct),
            "fullyUsable": int(
                classification_correct
                and (
                    expected["classification"] == "prose"
                    or speaker_correct
                    or unresolved_correct
                )
            ),
            "characterAssignments": int(character),
            "correctCharacterAssignments": int(character and speaker_correct),
            "falseCharacterAssignments": int(character and not speaker_correct),
            "parseValid": int(not row.get("parseError")),
        }
        book = str(expected["bookId"])
        bucket = by_book.setdefault(book, {key: 0 for key in totals})
        for key, value in increments.items():
            totals[key] += value
            bucket[key] += value

    def ratios(bucket: Mapping[str, int]) -> dict[str, Any]:
        return {
            **dict(bucket),
            "classificationAccuracy": bucket["classificationCorrect"] / max(1, bucket["samples"]),
            "properSpeakerRecall": bucket["inferableSpeakerCorrect"]
            / max(1, bucket["inferableSpeakerSamples"]),
            "unresolvedAccuracy": bucket["unresolvedCorrect"]
            / max(1, bucket["unresolvedDialogueSamples"]),
            "fullyUsableRate": bucket["fullyUsable"] / max(1, bucket["samples"]),
            "characterPrecision": bucket["correctCharacterAssignments"]
            / max(1, bucket["characterAssignments"]),
            "falseCharacterRate": bucket["falseCharacterAssignments"]
            / max(1, bucket["characterAssignments"]),
        }

    config = CONFIGS[label]
    usage = {
        "promptTokens": sum(int(row.get("usage", {}).get("prompt_tokens", 0)) for row in rows.values()),
        "completionTokens": sum(
            int(row.get("usage", {}).get("completion_tokens", 0)) for row in rows.values()
        ),
        "cachedPromptTokens": sum(
            int(
                row.get("usage", {})
                .get("prompt_tokens_details", {})
                .get("cached_tokens", 0)
            )
            for row in rows.values()
        ),
        "cacheWritePromptTokens": sum(
            int(
                row.get("usage", {})
                .get("prompt_tokens_details", {})
                .get("cache_write_tokens", 0)
            )
            for row in rows.values()
        ),
    }
    regular_prompt_tokens = max(
        0,
        usage["promptTokens"] - usage["cachedPromptTokens"] - usage["cacheWritePromptTokens"],
    )
    cost = (
        regular_prompt_tokens * float(config["inputUsdPerMillion"])
        + usage["cachedPromptTokens"]
        * float(config.get("cachedInputUsdPerMillion", config["inputUsdPerMillion"]))
        + usage["cacheWritePromptTokens"]
        * float(config.get("cacheWriteUsdPerMillion", config["inputUsdPerMillion"]))
        + usage["completionTokens"] * float(config["outputUsdPerMillion"])
    ) / 1_000_000
    physical_calls = {
        str(row["callId"])
        for row in rows.values()
        if row.get("hostedCall", True)
    }
    total_latency_ms = sum(int(row.get("latencyMs", 0)) for row in rows.values())
    total_configured_delay_ms = sum(
        int(row.get("configuredInterCallDelayMs", 0)) for row in rows.values()
    )
    economics: dict[str, dict[str, Any]] = {}
    for book in sorted(by_book):
        book_rows = [row for row in rows.values() if row["bookId"] == book]
        prompt_tokens = sum(int(row.get("usage", {}).get("prompt_tokens", 0)) for row in book_rows)
        completion_tokens = sum(
            int(row.get("usage", {}).get("completion_tokens", 0)) for row in book_rows
        )
        cached_tokens = sum(
            int(
                row.get("usage", {})
                .get("prompt_tokens_details", {})
                .get("cached_tokens", 0)
            )
            for row in book_rows
        )
        write_tokens = sum(
            int(
                row.get("usage", {})
                .get("prompt_tokens_details", {})
                .get("cache_write_tokens", 0)
            )
            for row in book_rows
        )
        regular_tokens = max(0, prompt_tokens - cached_tokens - write_tokens)
        book_cost = (
            regular_tokens * float(config["inputUsdPerMillion"])
            + cached_tokens
            * float(config.get("cachedInputUsdPerMillion", config["inputUsdPerMillion"]))
            + write_tokens
            * float(config.get("cacheWriteUsdPerMillion", config["inputUsdPerMillion"]))
            + completion_tokens * float(config["outputUsdPerMillion"])
        ) / 1_000_000
        economics[book] = {
            "calls": len(
                {
                    str(row["callId"])
                    for row in book_rows
                    if row.get("hostedCall", True)
                }
            ),
            "promptTokens": prompt_tokens,
            "completionTokens": completion_tokens,
            "latencyMs": sum(int(row.get("latencyMs", 0)) for row in book_rows),
            "configuredInterCallDelayMs": sum(
                int(row.get("configuredInterCallDelayMs", 0)) for row in book_rows
            ),
            "estimatedStandardApiCostUsd": round(book_cost, 6),
        }
    result = {
        "label": label,
        "provider": config["provider"],
        "model": config["model"],
        "reasoningEffort": config.get("reasoningEffort"),
        "overall": ratios(totals),
        "byBook": {book: ratios(bucket) for book, bucket in sorted(by_book.items())},
        "byBookEconomics": economics,
        "usage": usage,
        "estimatedStandardApiCostUsd": round(cost, 6),
        "physicalCalls": len(physical_calls),
        "latencyMs": {
            "total": total_latency_ms,
            "meanPerTarget": round(total_latency_ms / len(rows)),
            "meanPerPhysicalCall": round(total_latency_ms / max(1, len(physical_calls))),
            "configuredInterCallDelayTotal": total_configured_delay_ms,
        },
    }
    _json_dump(output / "scores" / f"{label}.json", result)
    print(json.dumps(result, indent=2), flush=True)
    return result


def score_local_hosted_consensus(
    corpus: Path,
    output: Path,
    label: str,
) -> dict[str, Any]:
    """Score a production-shaped local base plus selective hosted verifier."""

    local_rows = {
        str(row["sampleId"]): row for row in _jsonl(corpus / "runs/v0-control.jsonl")
    }
    hosted_rows = {
        str(row["sampleId"]): row for row in _jsonl(output / "runs" / f"{label}.jsonl")
    }
    if set(local_rows) != set(hosted_rows):
        raise RuntimeError(
            f"Hybrid coverage mismatch: local={len(local_rows)} hosted={len(hosted_rows)}"
        )
    hybrid_label = f"{label}-local-consensus"
    triggered_hosted_calls = {
        str(hosted_rows[sample_id]["callId"])
        for sample_id, local in local_rows.items()
        if _is_character(local.get("prediction"))
    }
    materialized = []
    for sample_id, local in local_rows.items():
        hosted = hosted_rows[sample_id]
        base_character = _is_character(local.get("prediction"))
        hosted_call = str(hosted["callId"]) in triggered_hosted_calls
        final = consensus_prediction(local, hosted if base_character else None)
        source = hosted if hosted_call else local
        row = {
            **source,
            "variant": hybrid_label,
            "callId": (
                f"{hybrid_label}:{hosted['callId']}"
                if hosted_call
                else f"{hybrid_label}:no-call:{sample_id}"
            ),
            "prediction": final,
            "raw": final,
            "parseError": None if final is not None else "upstream parse failure",
            "validatorAccepted": True if final in {"?", "/"} else source.get("validatorAccepted"),
            "usage": source.get("usage", {}) if hosted_call else {},
            "latencyMs": int(source.get("latencyMs", 0)) if hosted_call else 0,
            "configuredInterCallDelayMs": (
                int(source.get("configuredInterCallDelayMs", 0)) if hosted_call else 0
            ),
            "hostedCall": hosted_call,
        }
        materialized.append(row)
    path = output / "runs" / f"{hybrid_label}.jsonl"
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in materialized),
        encoding="utf-8",
    )
    CONFIGS[hybrid_label] = {
        **CONFIGS[label],
        "model": f"Qwen3.5-9B local base + {CONFIGS[label]['model']} verifier",
    }
    result = score(corpus, output, hybrid_label)
    result["baseCharacterProposals"] = sum(
        int(_is_character(row.get("prediction"))) for row in local_rows.values()
    )
    result["acceptedCharacters"] = result["overall"]["characterAssignments"]
    _json_dump(output / "scores" / f"{hybrid_label}.json", result)
    return result


def score_hosted_pair_consensus_multi(
    corpus: Path,
    output: Path,
    primary_label: str,
    verifier_label: str,
) -> dict[str, Any]:
    """Retain proper names only when two ordered hosted passes agree exactly."""

    primary_multi = _register_multi_config(primary_label)
    verifier_multi = _register_multi_config(verifier_label)
    primary_rows = {
        str(row["sampleId"]): row
        for row in _jsonl(output / "runs" / f"{primary_multi}.jsonl")
    }
    verifier_rows = {
        str(row["sampleId"]): row
        for row in _jsonl(output / "runs" / f"{verifier_multi}.jsonl")
    }
    if set(primary_rows) != set(verifier_rows):
        raise RuntimeError(
            f"Hosted pair coverage mismatch: primary={len(primary_rows)} "
            f"verifier={len(verifier_rows)}"
        )

    pair_label = f"{primary_multi}+{verifier_multi}-consensus"
    materialized = []
    for sample_id, primary in primary_rows.items():
        final = consensus_prediction(primary, verifier_rows[sample_id])
        materialized.append(
            {
                **primary,
                "variant": pair_label,
                "callId": f"{pair_label}:derived:{sample_id}",
                "prediction": final,
                "raw": final,
                "parseError": None if final is not None else "upstream parse failure",
                "usage": {},
                "latencyMs": 0,
                "configuredInterCallDelayMs": 0,
                "hostedCall": False,
            }
        )
    (output / "runs" / f"{pair_label}.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in materialized),
        encoding="utf-8",
    )
    CONFIGS[pair_label] = {
        "provider": "hosted-pair",
        "model": (
            f"{CONFIGS[primary_multi]['model']} + {CONFIGS[verifier_multi]['model']} "
            "exact agreement"
        ),
        "inputUsdPerMillion": 0,
        "outputUsdPerMillion": 0,
    }
    result = score(corpus, output, pair_label)
    component_scores = [
        json.loads((output / "scores" / f"{label}.json").read_text(encoding="utf-8"))
        for label in (primary_multi, verifier_multi)
    ]
    result["components"] = [primary_multi, verifier_multi]
    result["physicalCalls"] = sum(int(item["physicalCalls"]) for item in component_scores)
    result["estimatedStandardApiCostUsd"] = round(
        sum(float(item["estimatedStandardApiCostUsd"]) for item in component_scores), 6
    )
    total_latency_ms = sum(int(item["latencyMs"]["total"]) for item in component_scores)
    total_delay_ms = sum(
        int(item["latencyMs"]["configuredInterCallDelayTotal"])
        for item in component_scores
    )
    result["latencyMs"] = {
        "total": total_latency_ms,
        "meanPerTarget": round(total_latency_ms / max(1, len(materialized))),
        "meanPerPhysicalCall": round(total_latency_ms / max(1, result["physicalCalls"])),
        "configuredInterCallDelayTotal": total_delay_ms,
    }
    result["usage"] = {
        key: sum(int(item["usage"][key]) for item in component_scores)
        for key in component_scores[0]["usage"]
    }
    result["byBookEconomics"] = {
        book: {
            key: round(
                sum(float(item["byBookEconomics"][book][key]) for item in component_scores),
                6,
            )
            for key in component_scores[0]["byBookEconomics"][book]
        }
        for book in component_scores[0]["byBookEconomics"]
    }
    _json_dump(output / "scores" / f"{pair_label}.json", result)
    print(json.dumps(result, indent=2), flush=True)
    return result


def _register_multi_config(label: str) -> str:
    multi_label = f"{label}-multi"
    CONFIGS[multi_label] = {
        **CONFIGS[label],
        "model": f"{CONFIGS[label]['model']} ordered multi-speaker",
    }
    return multi_label


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    subparsers = parser.add_subparsers(dest="command", required=True)
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--label", choices=sorted(CONFIGS), required=True)
    run_parser.add_argument("--smoke", action="store_true")
    multi_parser = subparsers.add_parser("run-multi")
    multi_parser.add_argument("--label", choices=sorted(CONFIGS), required=True)
    score_parser = subparsers.add_parser("score")
    score_parser.add_argument("--label", choices=sorted(CONFIGS), required=True)
    hybrid_parser = subparsers.add_parser("score-local-consensus")
    hybrid_parser.add_argument("--label", choices=sorted(CONFIGS), required=True)
    score_multi_parser = subparsers.add_parser("score-multi")
    score_multi_parser.add_argument("--label", choices=sorted(CONFIGS), required=True)
    hybrid_multi_parser = subparsers.add_parser("score-local-consensus-multi")
    hybrid_multi_parser.add_argument("--label", choices=sorted(CONFIGS), required=True)
    pair_parser = subparsers.add_parser("score-hosted-consensus-multi")
    pair_parser.add_argument("--primary", choices=sorted(CONFIGS), required=True)
    pair_parser.add_argument("--verifier", choices=sorted(CONFIGS), required=True)
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    corpus = args.corpus if args.corpus.is_absolute() else repo_root / args.corpus
    output = args.output if args.output.is_absolute() else repo_root / args.output
    if args.command == "run":
        run(repo_root, corpus, output, args.label, args.smoke)
    elif args.command == "run-multi":
        run_multi(repo_root, corpus, output, args.label)
    elif args.command == "score":
        score(corpus, output, args.label)
    elif args.command == "score-local-consensus":
        score_local_hosted_consensus(corpus, output, args.label)
    elif args.command == "score-multi":
        score(corpus, output, _register_multi_config(args.label))
    elif args.command == "score-local-consensus-multi":
        score_local_hosted_consensus(corpus, output, _register_multi_config(args.label))
    else:
        score_hosted_pair_consensus_multi(corpus, output, args.primary, args.verifier)


if __name__ == "__main__":
    main()
