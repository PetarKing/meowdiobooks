"""Focused, transactional Qwen attribution for already-detected Dialogue turns."""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from copy import deepcopy
from typing import Any

from .dialogue import DialogueContractError
from .dialogue_attribution import (
    attribution_check,
    attribution_summary,
    exact_supported_consensus,
    validate_speaker_evidence as _validate_speaker_evidence,
)
from .local_llm import complete_text, qwen_server

BatchCompleter = Callable[[str, str, Sequence[str]], str]

SYSTEM = """Who speaks SPEECH? Return exactly one answer:

- a person's name
- ? if SPEECH is dialogue but the speaker is unknown
- / if SPEECH is only a quoted term inside narration

Rules:
1. If AFTER directly attributes SPEECH to a name, return that name. This wins over
   names in BEFORE.
2. Otherwise, use a name that directly introduces SPEECH in BEFORE.
3. Attribution verbs include said, asked, replied, murmured, shouted, warned,
   admitted, confessed, whispered, ordered, and cautioned.
4. If BEFORE + SPEECH + AFTER is one narrator sentence containing a quoted term,
   return /. Otherwise, a complete quoted sentence is dialogue.
5. If it is dialogue with no reliable speaker, return ?.

Examples:
- BEFORE: Nia murmured. SPEECH: “We leave now.” -> Nia
- SPEECH: “Stop!” AFTER: Ivo shouted. -> Ivo
- BEFORE: Oren asked. SPEECH: “I know.” AFTER: Mira admitted. -> Mira
- BEFORE: They called it SPEECH: “night glass” AFTER: in the report. -> /

Return only the name, ? or /."""

VERIFIER_SYSTEM = SYSTEM + """

Identity guard: a pronoun such as he, she, or they is evidence, not a speaker name. A description
such as "the man" is not an actual name. If the passage supports only a pronoun or description,
return ?.

Read the passage in order and follow the conversation. Do not copy a nearby name when that
person is being addressed, observing, or discussed."""


def plan_dialogue_windows(
    spans: Sequence[Mapping[str, Any]],
    target_ids: Sequence[str],
    *,
    context_characters: int = 700,
    context_units: int = 6,
    max_target_characters: int = 1_200,
    max_prompt_characters: int = 6_000,
) -> list[dict[str, Any]]:
    """Build compact target dossiers with context crossing blocks/pages when useful.

    Stable source IDs remain internal anchors. Qwen sees one target with no identifier,
    eliminating format bookkeeping while preserving exact source ranges.
    """

    if (
        context_characters < 80
        or context_units < 1
        or max_target_characters < 200
        or max_prompt_characters < 1_000
    ):
        raise DialogueContractError("Dialogue window limits are invalid")
    ordered = [dict(span) for span in spans]
    ordered_ids = [str(span.get("id", "")) for span in ordered]
    if not all(ordered_ids) or len(set(ordered_ids)) != len(ordered_ids):
        raise DialogueContractError("Transcript spans need unique non-empty IDs")
    positions = {span_id: index for index, span_id in enumerate(ordered_ids)}
    targets = list(target_ids)
    if len(set(targets)) != len(targets):
        raise DialogueContractError("Dialogue target IDs must be unique")
    unknown = [target for target in targets if target not in positions]
    if unknown:
        raise DialogueContractError(f"Unknown Dialogue targets: {unknown}")
    targets.sort(key=positions.__getitem__)

    windows = []
    for window_index, owner in enumerate(targets, 1):
        dossier = _target_dossier(
            ordered,
            positions[owner],
            owner,
            context_characters=context_characters,
            context_units=context_units,
            max_target_characters=max_target_characters,
        )
        windows.append(_window(window_index, owner, dossier, max_prompt_characters))
    return windows


def _target_dossier(
    ordered: Sequence[Mapping[str, Any]],
    position: int,
    owner: str,
    *,
    context_characters: int,
    context_units: int,
    max_target_characters: int,
) -> dict[str, Any]:
    target = ordered[position]
    group_id = target.get("turnGroupId")
    group_positions = [
        index
        for index, row in enumerate(ordered)
        if group_id is not None and row.get("turnGroupId") == group_id
    ] or [position]
    group_spans = [ordered[index] for index in group_positions]
    unlabelled = target.get("speakerStatus") == "unlabelled"
    target_text = _clean_prompt_text(
        "".join(
            str(
                row.get("source", row.get("text", ""))
                if unlabelled
                else row.get("text", row.get("source", ""))
            )
            for row in group_spans
        )
    )
    selected_context_units = 1 if unlabelled else context_units
    return {
        "spanId": owner,
        "spanIds": [str(row["id"]) for row in group_spans],
        "page": int(target.get("page", 0)),
        "blockId": str(target.get("blockId", "")),
        "before": _focused_context(
            ordered,
            min(group_positions),
            -1,
            max_characters=context_characters,
            max_units=selected_context_units,
        ),
        "target": _bounded_target(target_text, max_target_characters),
        "after": _focused_context(
            ordered,
            max(group_positions),
            1,
            max_characters=context_characters,
            max_units=selected_context_units,
        ),
    }


def _window(
    index: int,
    owner: str,
    dossier: Mapping[str, Any],
    max_prompt_characters: int,
) -> dict[str, Any]:
    prompt = dialogue_prompt(dossier)
    if len(prompt) > max_prompt_characters:
        raise DialogueContractError(
            f"Dialogue target context exceeds the {max_prompt_characters}-character prompt budget"
        )
    return {
        "id": f"dialogue-window-{index:04d}",
        "ownerIds": [owner],
        "dossiers": [dict(dossier)],
        "prompt": prompt,
    }


def dialogue_prompt(dossier: Mapping[str, Any]) -> str:
    """Render one focused target without exposing internal source IDs."""

    return "\n".join(
        (
            "BEFORE",
            str(dossier.get("before") or "(none)"),
            "",
            "SPEECH",
            str(dossier.get("target") or "(empty)"),
            "",
            "AFTER",
            str(dossier.get("after") or "(none)"),
        )
    )


def parse_attribution_answer(output: str) -> str:
    """Validate the single answer returned for one model-owned target."""

    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if len(lines) != 1:
        raise DialogueContractError("Speaker attribution must contain exactly one answer")
    speaker = lines[0]
    # Tiny models sometimes copy source-label punctuation (``Alice:`` or ``???:``).
    if speaker.endswith(":") and ":" not in speaker[:-1]:
        speaker = speaker[:-1].strip()
    if not _plausible_speaker(speaker):
        raise DialogueContractError(f"Invalid speaker answer: {speaker!r}")
    return speaker


def resolve_dialogue(
    scan: Mapping[str, Any],
    strategy: str,
    complete_batch: BatchCompleter,
    attribution_targets: Sequence[str] = ("open-speakers", "unlabelled-candidates"),
    attribution_origin: str = "qwen:targeted-speaker-v2",
    validate_focused_evidence: bool = True,
) -> dict[str, Any]:
    """Resolve only detected unresolved/unlabelled dialogue, or apply narrator policy."""

    if strategy not in {"fill-gaps", "narrate"}:
        raise DialogueContractError(f"Unsupported Dialogue strategy: {strategy}")
    partition = deepcopy(list(scan.get("partition", [])))
    if not partition:
        raise DialogueContractError("Dialogue scan has no source partition")
    if strategy == "narrate":
        return _narrator_result(scan, partition)

    selected_statuses = _selected_attribution_statuses(attribution_targets)
    ai_target_spans = [
        deepcopy(span)
        for span in partition
        if span.get("renderRole") == "dialogue" and span.get("speakerStatus") in selected_statuses
    ]
    target_ids = []
    seen_groups = set()
    for span in partition:
        if (
            span.get("renderRole") != "dialogue"
            or span.get("speakerStatus") not in selected_statuses
        ):
            continue
        logical_id = str(span.get("turnGroupId") or span["id"])
        if logical_id in seen_groups:
            continue
        seen_groups.add(logical_id)
        target_ids.append(str(span["id"]))
    windows = plan_dialogue_windows(partition, target_ids) if target_ids else []
    decisions: dict[str, str] = {}
    for window in windows:
        owners = list(window["ownerIds"])
        raw = complete_batch(SYSTEM, str(window["prompt"]), owners)
        speaker = parse_attribution_answer(raw)
        dossier = window["dossiers"][0]
        span_ids = [str(value) for value in dossier.get("spanIds", [dossier["spanId"]])]
        context = "\n".join(str(dossier.get(field, "")) for field in ("before", "target", "after"))
        if validate_focused_evidence:
            _validate_speaker_evidence(speaker, context, span_ids[0])
        for span_id in span_ids:
            decisions[span_id] = speaker
    expected_span_ids = {
        str(span["id"])
        for span in partition
        if span.get("renderRole") == "dialogue" and span.get("speakerStatus") in selected_statuses
    }
    if set(decisions) != expected_span_ids:
        raise DialogueContractError("Dialogue attribution result is incomplete")

    for span in partition:
        speaker = decisions.get(str(span["id"]))
        if speaker is None:
            continue
        if speaker == "/":
            _demote_false_positive(span)
            continue
        resolved, speaker_status = _normalise_open_result(speaker, scan)
        # Source anchors, text, role, and literal labels remain untouched.
        span["resolvedSpeakerLabel"] = resolved
        span["speakerStatus"] = speaker_status
        span["origin"] = attribution_origin
        span["fallback"] = "narrator" if speaker_status == "unresolved" else None
    for span in partition:
        if (
            span.get("renderRole") == "dialogue"
            and span.get("speakerStatus") in {"unresolved", "unlabelled"}
            and span.get("speakerStatus") not in selected_statuses
        ):
            span["speakerStatus"] = "unresolved"
            span["fallback"] = "narrator"
            span["origin"] = "policy:narrate-unselected-dialogue"
    partition = _coalesce_narration(partition)
    return _result(
        scan,
        partition,
        strategy,
        windows,
        attribution_targets,
        ai_target_spans=ai_target_spans,
    )


def run_dialogue_qwen(
    repo_root,
    scan: Mapping[str, Any],
    strategy: str,
    report=None,
    attribution_targets: Sequence[str] = ("open-speakers", "unlabelled-candidates"),
) -> dict[str, Any]:
    """Run one atomic local-Qwen session for targeted speaker attribution."""

    notify = report or (lambda _progress, _message=None: None)
    if strategy != "fill-gaps":
        raise DialogueContractError("Qwen only supports targeted fill-gaps attribution")
    selected_statuses = _selected_attribution_statuses(attribution_targets)
    targets = {
        str(span.get("turnGroupId") or span["id"])
        for span in scan.get("partition", [])
        if span.get("renderRole") == "dialogue" and span.get("speakerStatus") in selected_statuses
    }
    if not targets:
        result = resolve_dialogue(
            scan,
            strategy,
            lambda *_args: (_ for _ in ()).throw(
                DialogueContractError("Qwen was invoked without Dialogue targets")
            ),
            attribution_targets,
        )
        result["attributionChecks"] = []
        result["resultSummary"].update(attribution_summary([], 0))
        notify(100, "No uncertain dialogue needed an AI check")
        return result

    with qwen_server(repo_root) as base:
        completed = 0
        verifier_calls = 0
        checks: list[dict[str, Any]] = []

        def complete(system: str, prompt: str, owner_ids: Sequence[str]) -> str:
            nonlocal completed, verifier_calls
            if len(owner_ids) != 1:
                raise DialogueContractError("Speaker attribution requires exactly one target")
            owner = str(owner_ids[0])
            base_answer = _complete_attribution_attempt(base, system, prompt)
            normalized_base, base_status = _normalise_open_result(base_answer, scan)
            verifier_answer: str | None = None
            final = base_answer
            outcome = "base-unresolved"

            if base_status == "unresolved":
                # Publish one canonical unresolved symbol even when Qwen copied a configured marker.
                final = "?"
            else:
                verifier_calls += 1
                verifier_answer = _complete_attribution_attempt(base, VERIFIER_SYSTEM, prompt)
                normalized_verifier, verifier_status = _normalise_open_result(
                    verifier_answer, scan
                )
                final = exact_supported_consensus(
                    normalized_base, normalized_verifier, prompt, owner
                )
                if final == "/":
                    outcome = "agreed"
                elif final != "?" and verifier_status == "ai":
                    final = base_answer
                    outcome = "agreed"
                else:
                    final = "?"
                    outcome = "withheld"

            checks.append(
                attribution_check(
                    owner,
                    normalized_base,
                    normalized_verifier if verifier_answer is not None else None,
                    final,
                    prompt,
                    outcome=outcome,
                )
            )
            completed += 1
            notify(
                min(95, completed / len(targets) * 95),
                "Using AI to identify speakers from nearby text",
            )
            return final

        result = resolve_dialogue(scan, strategy, complete, attribution_targets)
        result["attributionChecks"] = checks
        result["resultSummary"].update(attribution_summary(checks, verifier_calls))
    notify(100, "Dialogue speaker attribution complete")
    return result


def _complete_attribution_attempt(base: str, system: str, prompt: str) -> str:
    """Return one mechanically valid answer, retrying this prompt independently."""

    failures = []
    retry_prompt = prompt
    for _attempt in range(3):
        raw = complete_text(
            base,
            system,
            retry_prompt,
            max_tokens=128,
        )
        try:
            return parse_attribution_answer(raw)
        except DialogueContractError as error:
            failures.append(str(error))
            retry_prompt = prompt + "\n\nTRY AGAIN\nReturn only one speaker name, ? or /."
    raise DialogueContractError(
        "Qwen failed complete speaker-attribution validation: " + " | ".join(failures)
    )


def _focused_context(
    spans: Sequence[Mapping[str, Any]],
    target_position: int,
    direction: int,
    *,
    max_characters: int,
    max_units: int,
) -> str:
    units: list[str] = []
    index = target_position + direction
    while 0 <= index < len(spans) and len(units) < max_units:
        semantic = _semantic_units(spans[index])
        if direction < 0:
            semantic.reverse()
        for logical in semantic:
            if len(units) >= max_units:
                break
            units.append(logical)
        index += direction
    if direction < 0:
        units.reverse()
    value = "\n".join(units)
    return _clip_context(value, max_characters, direction)


def _clip_context(value: str, max_characters: int, direction: int) -> str:
    """Bound context without presenting a tiny model with a cut-off word."""

    if len(value) <= max_characters:
        return value
    if direction < 0:
        clipped = value[-max_characters:]
        boundary = clipped.find(" ")
        return clipped[boundary + 1 :] if boundary >= 0 else clipped
    clipped = value[:max_characters]
    boundary = clipped.rfind(" ")
    return clipped[:boundary] if boundary >= 0 else clipped


def _semantic_units(span: Mapping[str, Any]) -> list[str]:
    """Return meaningful dialogue turns or prose sentences, excluding formatting spans."""

    value = _clean_prompt_text(str(span.get("source", span.get("text", ""))))
    if not value:
        return []
    if span.get("renderRole") == "dialogue":
        return [value]
    return [
        part.strip()
        for part in re.split(
            r"(?<=[.!?…。！？])\s+|(?<=[.!?…。！？][\"'”’»）】」』])\s+|\s*⏎\s*",
            value,
        )
        if part.strip() and any(character.isalnum() for character in part)
    ]


def _bounded_target(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    marker = " … [middle omitted for speaker attribution] … "
    side = (limit - len(marker)) // 2
    if side < 1:
        raise DialogueContractError("Dialogue target-character budget cannot hold an excerpt")
    return value[:side] + marker + value[-side:]


def _clean_prompt_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _plausible_speaker(speaker: str) -> bool:
    if set(speaker) <= {"?"}:
        return True
    return (
        0 < len(speaker) <= 80
        and len(speaker.split()) <= 8
        and not any(mark in speaker for mark in "\n\r|![]{}:;")
    )


def _demote_false_positive(span: dict[str, Any]) -> None:
    """Turn a model-rejected dialogue candidate back into source-faithful narration."""

    span["renderRole"] = "narration"
    span["sourceStart"] = int(span["sourceStart"])
    span["sourceEnd"] = int(span["sourceEnd"])
    span["spokenStart"] = span["sourceStart"]
    span["spokenEnd"] = span["sourceEnd"]
    span["text"] = span["source"]
    span["sourceSpeakerLabel"] = None
    span["speakerStatus"] = "not-applicable"
    span["origin"] = "qwen:not-vocalisation"
    span["fallback"] = None
    span.pop("resolvedSpeakerLabel", None)
    span.pop("turnGroupId", None)


def _coalesce_narration(partition: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge adjacent narration intervals without crossing source-block boundaries."""

    rebuilt: list[dict[str, Any]] = []
    for span in partition:
        previous = rebuilt[-1] if rebuilt else None
        if (
            previous is not None
            and previous.get("renderRole") == "narration"
            and span.get("renderRole") == "narration"
            and previous.get("blockId") == span.get("blockId")
            and int(previous["sourceEnd"]) == int(span["sourceStart"])
        ):
            previous["sourceEnd"] = int(span["sourceEnd"])
            previous["spokenEnd"] = previous["sourceEnd"]
            previous["source"] = str(previous.get("source", "")) + str(span.get("source", ""))
            previous["text"] = previous["source"]
            previous["id"] = (
                f"span:{previous['blockId']}:narration:"
                f"{previous['sourceStart']}-{previous['sourceEnd']}"
            )
            if span.get("origin") == "qwen:not-vocalisation":
                previous["origin"] = span["origin"]
            continue
        rebuilt.append(span)
    return rebuilt


def _normalise_open_result(speaker: str, scan: Mapping[str, Any]) -> tuple[str, str]:
    normalised_speaker = " ".join(speaker.split())
    literals = {
        " ".join(str(value).split()).casefold()
        for value in scan.get("openSpeakerLiterals", ["???"])
    }
    try:
        patterns = [
            re.compile(str(value), re.IGNORECASE) for value in scan.get("openSpeakerPatterns", [])
        ]
    except re.error as error:
        raise DialogueContractError(f"Open-speaker regex is invalid: {error}") from error
    if (
        set(normalised_speaker) <= {"?"}
        or normalised_speaker.casefold() in literals
        or any(pattern.fullmatch(normalised_speaker) for pattern in patterns)
    ):
        return "?", "unresolved"
    return speaker, "ai"


def _narrator_result(scan: Mapping[str, Any], partition: list[dict[str, Any]]) -> dict[str, Any]:
    """Keep detected turns separate while routing unknown speakers to Narrator."""

    for span in partition:
        if span.get("renderRole") != "dialogue" or span.get("speakerStatus") not in {
            "unresolved",
            "unlabelled",
        }:
            continue
        span["resolvedSpeakerLabel"] = "?"
        span["speakerStatus"] = "unresolved"
        span["origin"] = "policy:narrate-dialogue"
        span["fallback"] = "narrator"
    return _result(scan, partition, "narrate", [])


def _result(
    scan: Mapping[str, Any],
    partition: list[dict[str, Any]],
    strategy: str,
    windows: Sequence[Mapping[str, Any]],
    attribution_targets: Sequence[str] = ("open-speakers", "unlabelled-candidates"),
    *,
    ai_target_spans: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    logical = {
        str(span.get("turnGroupId") or span["id"]): span
        for span in partition
        if span.get("renderRole") == "dialogue"
    }.values()
    explicit = sum(span.get("speakerStatus") == "explicit" for span in logical)
    logical = {
        str(span.get("turnGroupId") or span["id"]): span
        for span in partition
        if span.get("renderRole") == "dialogue"
    }.values()
    attributed = sum(span.get("speakerStatus") == "ai" for span in logical)
    logical = {
        str(span.get("turnGroupId") or span["id"]): span
        for span in partition
        if span.get("renderRole") == "dialogue"
    }.values()
    unresolved = sum(span.get("speakerStatus") == "unresolved" for span in logical)
    return {
        **dict(scan),
        "strategy": strategy,
        "attributionTargets": list(attribution_targets),
        "partition": partition,
        "aiTargetSpans": [dict(row) for row in ai_target_spans],
        "aiWindows": [
            {
                "id": row["id"],
                "ownerIds": row["ownerIds"],
                "dossiers": row["dossiers"],
            }
            for row in windows
        ],
        "resultSummary": {
            "totalTurns": len(partition),
            "regexClaims": int(scan.get("summary", {}).get("regexClaims", 0)),
            "explicitTurns": explicit,
            "openSpeakerTurns": int(scan.get("summary", {}).get("openSpeakerTurns", 0)),
            "unlabelledCandidates": int(scan.get("summary", {}).get("unlabelledCandidates", 0)),
            "conflicts": len(scan.get("conflicts", [])),
            "aiAttributed": attributed,
            "aiContributions": len(windows),
            "unresolved": unresolved,
        },
    }


def apply_dialogue_corrections(
    candidate: Mapping[str, Any],
    raw_decisions: Sequence[Mapping[str, Any]],
    *,
    revision: str,
) -> dict[str, Any]:
    """Publish user overrides for AI-owned turns without mutating the AI candidate."""

    if not raw_decisions:
        return dict(candidate)
    windows = {
        str(window.get("ownerIds", [""])[0]): window
        for window in candidate.get("aiWindows", [])
        if isinstance(window, Mapping)
        and isinstance(window.get("ownerIds"), list)
        and window.get("ownerIds")
    }
    target_spans = {
        str(span.get("id")): dict(span)
        for span in candidate.get("aiTargetSpans", [])
        if isinstance(span, Mapping) and span.get("id")
    }
    partition = deepcopy(list(candidate.get("spans") or candidate.get("partition") or []))
    if not partition:
        raise DialogueContractError("Dialogue correction candidate has no source partition")
    for span in partition:
        if span.get("id"):
            target_spans.setdefault(str(span["id"]), dict(span))
    for match in candidate.get("matches", []):
        if not isinstance(match, Mapping) or not match.get("spanId"):
            continue
        match_id = str(match["spanId"])
        target_spans.setdefault(match_id, _target_span_from_match(candidate, match))
    original_coverage = _partition_source_by_block(partition)
    seen: set[str] = set()
    accepted: list[dict[str, Any]] = []

    for raw in raw_decisions:
        span_id = str(raw.get("spanId", "")).strip()
        if not span_id or span_id in seen:
            raise DialogueContractError("Dialogue corrections need unique AI span IDs")
        seen.add(span_id)
        window = windows.get(span_id)
        if window is None:
            raise DialogueContractError(f"Dialogue correction is not AI-owned: {span_id}")
        dossiers = window.get("dossiers", [])
        dossier = dossiers[0] if isinstance(dossiers, list) and dossiers else {}
        span_ids = [
            str(value)
            for value in (
                dossier.get("spanIds", [span_id]) if isinstance(dossier, Mapping) else [span_id]
            )
        ]
        if not span_ids or any(target_id not in target_spans for target_id in span_ids):
            raise DialogueContractError(
                f"Dialogue correction has no durable source target: {span_id}"
            )
        action = str(raw.get("action", "")).strip()
        if action not in {"speaker", "narrator"}:
            raise DialogueContractError(f"Unsupported Dialogue correction: {action or '<empty>'}")
        speaker_label = " ".join(str(raw.get("speakerLabel", "")).split())
        if action == "speaker" and (not speaker_label or len(speaker_label) > 200):
            raise DialogueContractError(
                "A character correction needs a speaker name of at most 200 characters"
            )

        for target_id in span_ids:
            replacement = deepcopy(target_spans[target_id])
            if action == "speaker":
                replacement["resolvedSpeakerLabel"] = speaker_label
                replacement["speakerStatus"] = "user"
                replacement["origin"] = "user:dialogue-speaker"
                replacement["fallback"] = None
            elif action == "narrator":
                replacement.pop("resolvedSpeakerLabel", None)
                replacement["speakerStatus"] = "unresolved"
                replacement["origin"] = "user:dialogue-narrator"
                replacement["fallback"] = "narrator"
            partition = _replace_target_span(partition, target_spans[target_id], replacement)

        accepted.append(
            {
                "spanId": span_id,
                "spanIds": span_ids,
                "action": action,
                **({"speakerLabel": speaker_label} if action == "speaker" else {}),
                "provenance": "user",
            }
        )

    partition = _coalesce_narration(partition)
    if _partition_source_by_block(partition) != original_coverage:
        raise DialogueContractError("Dialogue corrections changed source coverage")
    result = deepcopy(dict(candidate))
    result["revision"] = revision
    result["correctedFromRevision"] = str(candidate.get("revision", ""))
    result["spans"] = partition
    result["partition"] = partition
    result["userCorrections"] = accepted
    result["resultSummary"] = _corrected_summary(candidate, partition, len(accepted))
    return result


def _replace_target_span(
    partition: Sequence[dict[str, Any]],
    target: Mapping[str, Any],
    replacement: dict[str, Any],
) -> list[dict[str, Any]]:
    block_id = str(target.get("blockId", ""))
    start = int(target["sourceStart"])
    end = int(target["sourceEnd"])
    rebuilt: list[dict[str, Any]] = []
    covered = ""
    inserted = False
    for span in partition:
        span_start = int(span["sourceStart"])
        span_end = int(span["sourceEnd"])
        if str(span.get("blockId", "")) != block_id or span_end <= start or span_start >= end:
            rebuilt.append(span)
            continue
        overlap_start = max(start, span_start)
        overlap_end = min(end, span_end)
        source = str(span.get("source", ""))
        if len(source) != span_end - span_start:
            raise DialogueContractError("Dialogue correction source offsets are inconsistent")
        covered += source[overlap_start - span_start : overlap_end - span_start]
        if (span_start < start or span_end > end) and span.get("renderRole") != "narration":
            raise DialogueContractError("Dialogue correction overlaps another spoken turn")
        if span_start < start:
            rebuilt.append(_slice_narration_span(span, span_start, start))
        if not inserted:
            rebuilt.append(replacement)
            inserted = True
        if span_end > end:
            rebuilt.append(_slice_narration_span(span, end, span_end))
    if not inserted or covered != str(target.get("source", "")):
        raise DialogueContractError(
            f"Dialogue correction target no longer matches its source: {target.get('id', '')}"
        )
    return rebuilt


def _slice_narration_span(span: Mapping[str, Any], start: int, end: int) -> dict[str, Any]:
    span_start = int(span["sourceStart"])
    source = str(span.get("source", ""))[start - span_start : end - span_start]
    return {
        **dict(span),
        "id": f"span:{span['blockId']}:narration:{start}-{end}",
        "sourceStart": start,
        "sourceEnd": end,
        "spokenStart": start,
        "spokenEnd": end,
        "source": source,
        "text": source,
        "renderRole": "narration",
        "sourceSpeakerLabel": None,
        "speakerStatus": "not-applicable",
        "fallback": None,
    }


def _target_span_from_match(
    candidate: Mapping[str, Any], match: Mapping[str, Any]
) -> dict[str, Any]:
    block_id = str(match.get("blockId", ""))
    block = next(
        (
            row
            for row in candidate.get("blocks", [])
            if isinstance(row, Mapping) and str(row.get("id", "")) == block_id
        ),
        {},
    )
    start = int(match.get("sourceStart", 0))
    end = int(match.get("sourceEnd", start))
    block_text = str(block.get("text", ""))
    source = str(match.get("source") or block_text[start:end])
    text = str(match.get("text") or source)
    relative_spoken_start = source.find(text)
    spoken_start = int(
        match.get(
            "spokenStart",
            start + relative_spoken_start if relative_spoken_start >= 0 else start,
        )
    )
    return {
        "id": str(match["spanId"]),
        "blockId": block_id,
        "page": int(match.get("page", block.get("page", 0))),
        "sourceStart": start,
        "sourceEnd": end,
        "spokenStart": spoken_start,
        "spokenEnd": int(match.get("spokenEnd", spoken_start + len(text))),
        "source": source,
        "text": text,
        "renderRole": "dialogue",
        "sourceSpeakerLabel": match.get("sourceSpeakerLabel"),
        "speakerStatus": str(match.get("speakerStatus", "unlabelled")),
        "origin": str(match.get("origin", "regex:legacy-candidate")),
        "fallback": "narrator",
    }


def _partition_source_by_block(partition: Sequence[Mapping[str, Any]]) -> dict[str, str]:
    result: dict[str, list[str]] = {}
    for span in partition:
        result.setdefault(str(span.get("blockId", "")), []).append(str(span.get("source", "")))
    return {block_id: "".join(parts) for block_id, parts in result.items()}


def _corrected_summary(
    candidate: Mapping[str, Any], partition: Sequence[Mapping[str, Any]], correction_count: int
) -> dict[str, Any]:
    logical = {
        str(span.get("turnGroupId") or span.get("id")): span
        for span in partition
        if span.get("renderRole") == "dialogue"
    }.values()
    rows = list(logical)
    summary = dict(candidate.get("resultSummary", {}))
    summary.update(
        {
            "explicitTurns": sum(row.get("speakerStatus") == "explicit" for row in rows),
            "aiAttributed": sum(row.get("speakerStatus") == "ai" for row in rows),
            "aiContributions": max(
                0,
                int(summary.get("aiContributions", len(candidate.get("aiWindows", []))))
                - correction_count,
            ),
            "unresolved": sum(row.get("speakerStatus") == "unresolved" for row in rows),
            "userCorrected": correction_count,
        }
    )
    return summary


def _selected_attribution_statuses(targets: Sequence[str]) -> set[str]:
    allowed = {"open-speakers", "unlabelled-candidates"}
    unknown = set(targets) - allowed
    if unknown:
        raise DialogueContractError(f"Unsupported Dialogue attribution targets: {sorted(unknown)}")
    statuses = set()
    if "open-speakers" in targets:
        statuses.add("unresolved")
    if "unlabelled-candidates" in targets:
        statuses.add("unlabelled")
    return statuses
