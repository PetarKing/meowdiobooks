"""Conservative two-pass remote speaker attribution for long Dialogue reviews."""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .dialogue import DialogueContractError
from .dialogue_attribution import (
    attribution_check,
    attribution_summary,
    supported_consensus,
)
from .dialogue_ai import (
    _selected_attribution_statuses,
    parse_attribution_answer,
    resolve_dialogue,
)
from .model_config import RemoteTextModelConfig, load_model_registry
from .remote_llm import RemoteUsageObserver, remote_chat_completion, remote_usage_cost

MULTI_SYSTEM = """Attribute every marked target in the ordered source excerpt.

Return exactly one row per target, in target-ID order:
- T001|D|Actual Name when it is spoken dialogue and the proper character name is supported
- T001|D|? when it is spoken dialogue but the proper name is not reliably inferable
- T001|N when it is quoted text that is not spoken aloud

Use the speaker's actual proper character name. Pronouns, generic descriptions, and unsupported
roles are not character names. Follow the conversation in source order. A direct attribution after
a target wins. Do not copy the name of someone being addressed or discussed. Do not use outside
book knowledge. Return only pipe-delimited rows."""

LEDGER_SYSTEM = """You are a forensic dialogue-continuity analyst.

Reconstruct the ordered passage as a turn ledger before deciding any indexed target. Resolve a
proper character name only from evidence inside this passage: direct attribution, continued quoted
turns, explicit response structure, and unambiguous local identity chains.

Return exactly one row per target, in target-ID order:
- T001|D|Actual Name when that exact proper identity is supported
- T001|D|? when it is dialogue but the proper name is not reliably inferable
- T001|N when the quote is not spoken aloud

Names of addressees or discussed people are distractors. Pronouns, descriptions, and unsupported
roles are not proper names. Do not assume speakers merely alternate. Return only pipe-delimited
rows."""

RemoteReporter = Callable[[float, str | None], None]


def remote_dialogue_windows(
    spans: Sequence[Mapping[str, Any]],
    target_ids: Sequence[str],
    *,
    max_targets_per_batch: int = 6,
) -> list[dict[str, Any]]:
    """Group ordered targets into bounded two-page batches with surrounding context."""

    if max_targets_per_batch < 1:
        raise DialogueContractError("Remote Dialogue batch size must be positive")

    ordered = [dict(span) for span in spans]
    by_id = {str(span.get("id")): span for span in ordered}
    if len(by_id) != len(ordered) or "" in by_id:
        raise DialogueContractError("Remote Dialogue spans need unique non-empty IDs")
    unknown = [target_id for target_id in target_ids if target_id not in by_id]
    if unknown:
        raise DialogueContractError(f"Unknown remote Dialogue targets: {unknown}")
    buckets: dict[int, list[str]] = {}
    for target_id in target_ids:
        page = max(1, int(by_id[target_id].get("page", 1)))
        start = ((page - 1) // 2) * 2 + 1
        buckets.setdefault(start, []).append(target_id)
    windows = []
    for start, owners in sorted(buckets.items()):
        context = [span for span in ordered if start - 1 <= int(span.get("page", 0)) <= start + 2]
        if not context:
            raise DialogueContractError("Remote Dialogue passage has no source context")
        for offset in range(0, len(owners), max_targets_per_batch):
            windows.append(
                {
                    "id": f"remote-dialogue-window-{len(windows) + 1:04d}",
                    "ownerIds": owners[offset : offset + max_targets_per_batch],
                    "partition": context,
                }
            )
    return windows


def ordered_window_prompt(
    window: Mapping[str, Any],
) -> tuple[str, dict[str, str], str]:
    partition = list(window["partition"])
    owners = [str(value) for value in window["ownerIds"]]
    positions = {str(span["id"]): span for span in partition}
    id_to_owner = {f"T{index:03d}": owner for index, owner in enumerate(owners, 1)}
    owner_to_id = {owner: target_id for target_id, owner in id_to_owner.items()}
    group_to_id: dict[str, str] = {}
    for owner, target_id in owner_to_id.items():
        group_id = positions[owner].get("turnGroupId")
        if group_id is not None:
            group_to_id[str(group_id)] = target_id
    rendered: list[str] = []
    passage_parts: list[str] = []
    for span in partition:
        source = str(span.get("source", span.get("text", "")))
        passage_parts.append(source)
        marker = owner_to_id.get(str(span["id"]))
        if marker is None and span.get("turnGroupId") is not None:
            marker = group_to_id.get(str(span["turnGroupId"]))
        rendered.append(f"[{marker}]\n{source}\n[/{marker}]" if marker else source)
    prompt = f"TARGET IDS\n{', '.join(id_to_owner)}\n\nORDERED SOURCE\n" + "\n".join(rendered)
    return prompt, id_to_owner, "".join(passage_parts)


def ledger_prompt(window: Mapping[str, Any]) -> tuple[str, dict[str, str]]:
    partition = list(window["partition"])
    positions = {str(span["id"]): span for span in partition}
    id_to_owner = {f"T{index:03d}": str(owner) for index, owner in enumerate(window["ownerIds"], 1)}
    passage = "".join(str(span.get("source", span.get("text", ""))) for span in partition)
    target_rows = []
    for target_id, owner in id_to_owner.items():
        group_id = positions[owner].get("turnGroupId")
        fragments = (
            [span for span in partition if span.get("turnGroupId") == group_id]
            if group_id is not None
            else [positions[owner]]
        )
        source = "".join(str(span.get("source", "")) for span in fragments)
        target_rows.append(f"{target_id}|{' '.join(source.split())}")
    return (
        "Read the continuous passage first. The target index identifies excerpts in source order. "
        "Reconstruct one conversation ledger and emit one decision per target.\n\n"
        f"CONTINUOUS ORDERED PASSAGE\n{passage}\n\n"
        f"ORDERED TARGET INDEX\n{chr(10).join(target_rows)}",
        id_to_owner,
    )


def parse_remote_rows(raw: str, expected_ids: Sequence[str]) -> dict[str, str]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rsplit("```", 1)[0].strip()
    parsed: dict[str, str] = {}
    pattern = re.compile(r"^(T\d{3})\|([DN])(?:\|(.+))?$")
    for line in (line.strip() for line in text.splitlines() if line.strip()):
        match = pattern.fullmatch(line)
        if not match:
            raise DialogueContractError(f"Invalid remote Dialogue row: {line!r}")
        target_id, classification, speaker = match.groups()
        if target_id in parsed:
            raise DialogueContractError(f"Duplicate remote Dialogue target: {target_id}")
        if classification == "N":
            if speaker is not None:
                raise DialogueContractError("Narration rows cannot include a speaker")
            parsed[target_id] = "/"
        elif speaker is None:
            raise DialogueContractError("Dialogue rows require a speaker or ?")
        else:
            parsed[target_id] = parse_attribution_answer(speaker.strip())
    if list(parsed) != list(expected_ids):
        raise DialogueContractError(
            f"Expected remote targets {list(expected_ids)!r}, got {list(parsed)!r}"
        )
    return parsed


def _pass(
    repo_root,
    config: RemoteTextModelConfig,
    system: str,
    prompt: str,
    expected_ids: Sequence[str],
    usage_observer: RemoteUsageObserver | None,
) -> tuple[dict[str, str], dict[str, Any]]:
    retry = prompt
    failures = []
    for _attempt in range(2):
        response = remote_chat_completion(
            repo_root, config, system, retry, usage_observer=usage_observer
        )
        try:
            return parse_remote_rows(response["text"], expected_ids), response
        except DialogueContractError as error:
            failures.append(str(error))
            retry = (
                prompt
                + "\n\nFORMAT CORRECTION: Return exactly "
                + str(len(expected_ids))
                + " rows for "
                + ", ".join(expected_ids)
                + ", in that order."
            )
    raise DialogueContractError("Remote Dialogue output stayed invalid: " + " | ".join(failures))


def _run_window(
    repo_root,
    config: RemoteTextModelConfig,
    window: Mapping[str, Any],
    usage_observer: RemoteUsageObserver | None,
) -> tuple[
    dict[str, str],
    str,
    dict[str, str],
    dict[str, str],
    tuple[dict[str, Any], dict[str, Any]],
]:
    """Run the two matching perspectives for one batch concurrently."""

    base_prompt, base_ids, passage = ordered_window_prompt(window)
    second_prompt, second_ids = ledger_prompt(window)
    if list(base_ids) != list(second_ids):
        raise DialogueContractError("Remote Dialogue passes planned different targets")
    with ThreadPoolExecutor(max_workers=2) as executor:
        base_future = executor.submit(
            _pass,
            repo_root,
            config,
            MULTI_SYSTEM,
            base_prompt,
            list(base_ids),
            usage_observer,
        )
        ledger_future = executor.submit(
            _pass,
            repo_root,
            config,
            LEDGER_SYSTEM,
            second_prompt,
            list(second_ids),
            usage_observer,
        )
        base_rows, base_response = base_future.result()
        ledger_rows, ledger_response = ledger_future.result()
    return (
        base_ids,
        passage,
        base_rows,
        ledger_rows,
        (base_response, ledger_response),
    )


def run_dialogue_remote(
    repo_root,
    scan: Mapping[str, Any],
    strategy: str,
    report: RemoteReporter | None = None,
    attribution_targets: Sequence[str] = ("open-speakers", "unlabelled-candidates"),
    usage_observer: RemoteUsageObserver | None = None,
) -> dict[str, Any]:
    """Run two independent ordered-passage passes and retain supported name consensus."""

    if strategy != "fill-gaps":
        raise DialogueContractError("Remote attribution only supports fill-gaps")
    notify = report or (lambda _progress, _message=None: None)
    registry = load_model_registry(repo_root)
    config = registry.remote_dialogue_model()
    if config is None:
        raise DialogueContractError("No remote Dialogue model is configured")
    selected_statuses = _selected_attribution_statuses(attribution_targets)
    target_ids = []
    seen_groups = set()
    for span in scan.get("partition", []):
        if (
            span.get("renderRole") != "dialogue"
            or span.get("speakerStatus") not in selected_statuses
        ):
            continue
        logical = str(span.get("turnGroupId") or span["id"])
        if logical in seen_groups:
            continue
        seen_groups.add(logical)
        target_ids.append(str(span["id"]))
    if not target_ids:
        result = resolve_dialogue(
            scan,
            strategy,
            lambda *_args: "?",
            attribution_targets,
            attribution_origin="remote:dual-perspective-exact",
            validate_focused_evidence=False,
        )
        result["attributionRoute"] = "remote"
        result["attributionChecks"] = []
        result["resultSummary"].update(attribution_summary([], 0))
        return result

    windows = remote_dialogue_windows(
        scan.get("partition", []),
        target_ids,
        max_targets_per_batch=config.max_targets_per_batch,
    )
    decisions: dict[str, str] = {}
    checks: list[dict[str, Any]] = []
    total_cost = 0.0
    total_usage = {"inputTokens": 0, "cachedInputTokens": 0, "outputTokens": 0}
    provider_models: set[str] = set()
    with ThreadPoolExecutor(max_workers=config.max_concurrent_batches) as executor:
        futures = [
            executor.submit(_run_window, repo_root, config, window, usage_observer)
            for window in windows
        ]
        try:
            for index, future in enumerate(futures, 1):
                base_ids, passage, base_rows, ledger_rows, responses = future.result()
                for response in responses:
                    provider_model = str(response.get("model") or "").strip()
                    if provider_model:
                        provider_models.add(provider_model)
                    usage = response.get("usage", {})
                    if isinstance(usage, Mapping):
                        total_cost += remote_usage_cost(config, usage)
                        total_usage["inputTokens"] += int(
                            usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0
                        )
                        prompt_details = usage.get(
                            "prompt_tokens_details", usage.get("input_tokens_details")
                        )
                        if isinstance(prompt_details, Mapping):
                            total_usage["cachedInputTokens"] += int(
                                prompt_details.get("cached_tokens", 0) or 0
                            )
                        total_usage["outputTokens"] += int(
                            usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0
                        )
                for target_id, owner in base_ids.items():
                    first = base_rows[target_id]
                    second = ledger_rows[target_id]
                    final = supported_consensus(first, second, passage, owner)
                    decisions[owner] = final
                    checks.append(
                        attribution_check(
                            owner,
                            first,
                            second,
                            final,
                            passage,
                            outcome="agreed" if final not in {"?", "/"} else "withheld",
                        )
                    )
                notify(
                    min(95, index / len(windows) * 95),
                    f"Checking speaker assignments with {config.display_name}",
                )
        except BaseException:
            for future in futures:
                future.cancel()
            raise

    result = resolve_dialogue(
        scan,
        strategy,
        lambda _system, _prompt, owners: decisions[str(owners[0])],
        attribution_targets,
        attribution_origin="remote:dual-perspective-exact",
        validate_focused_evidence=False,
    )
    result["attributionRoute"] = "remote"
    result["attributionChecks"] = checks
    result["remoteUsage"] = {
        **total_usage,
        "estimatedCostUsd": round(total_cost, 4),
        "modelProfile": config.id,
        "modelDisplayName": config.display_name,
        "providerModels": sorted(provider_models),
    }
    result["resultSummary"].update(attribution_summary(checks, len(windows) * 2))
    notify(100, "Dialogue speaker attribution complete")
    return result
