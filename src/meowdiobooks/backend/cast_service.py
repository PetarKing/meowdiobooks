"""Focused local-Qwen classification for literal Cast labels."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from .cast import (
    CastContractError,
    build_compact_label_ledger,
    build_label_dossiers,
    build_relationship_summary,
    label_comparison_key,
    looks_joint_label,
    normalize_label,
    suggest_fuzzy_candidates,
)
from .local_llm import complete_json, qwen_server

Report = Callable[[float, str | None], None]
JsonCompletion = Callable[[str, str, int], object]

SPEAKER_TYPES = {
    "one-person": "character",
    "multiple-people": "group",
    "not-a-speaker": "editorial",
    "identity-hidden": "unresolved-marker",
}

RELATIONSHIP_CANDIDATE_THRESHOLD = 0.72
MAX_RELATIONSHIP_CANDIDATES = 8
VOICE_PROFILE_TRUNCATION_MARKER = "[…truncated to voice-profile prompt budget]"


@dataclass(frozen=True)
class VoiceEvidencePolicy:
    """Bound and distribute evidence for one provider-specific voice-profile call."""

    max_examples: int = 3
    max_examples_per_label: int = 1
    max_line_characters: int = 1_200
    max_context_characters: int = 4_000
    max_prompt_characters: int = 6_000

    def __post_init__(self) -> None:
        values = {
            "max_examples": self.max_examples,
            "max_examples_per_label": self.max_examples_per_label,
            "max_line_characters": self.max_line_characters,
            "max_context_characters": self.max_context_characters,
            "max_prompt_characters": self.max_prompt_characters,
        }
        invalid = [name for name, value in values.items() if value < 1]
        if invalid:
            raise CastContractError(
                "Voice evidence limits must be positive: " + ", ".join(invalid)
            )
        if self.max_examples_per_label > self.max_examples:
            raise CastContractError(
                "Voice evidence per-label limit cannot exceed the total example limit"
            )
        marker_size = len(VOICE_PROFILE_TRUNCATION_MARKER)
        if self.max_line_characters <= marker_size:
            raise CastContractError(
                "Voice evidence line limit must fit the truncation marker"
            )
        if self.max_prompt_characters <= marker_size + 1:
            raise CastContractError(
                "Voice evidence prompt limit must fit the truncation marker"
            )


DEFAULT_VOICE_EVIDENCE_POLICY = VoiceEvidencePolicy()
MAX_VOICE_PROFILE_EXAMPLES = DEFAULT_VOICE_EVIDENCE_POLICY.max_examples
MAX_VOICE_PROFILE_LINE_CHARACTERS = DEFAULT_VOICE_EVIDENCE_POLICY.max_line_characters
MAX_VOICE_PROFILE_CONTEXT_CHARACTERS = DEFAULT_VOICE_EVIDENCE_POLICY.max_context_characters
MAX_VOICE_PROFILE_PROMPT_CHARACTERS = DEFAULT_VOICE_EVIDENCE_POLICY.max_prompt_characters

SYSTEM = """Classify one literal audiobook speaker label.

Return exactly one JSON object:
{"speakerType":"one-person | multiple-people | not-a-speaker | identity-hidden",
 "sameIdentityAs":["exact candidate labels"],
 "possiblySameIdentityAs":["exact candidate labels"]}

Definitions:
- one-person: one individual speaks under the target label.
- multiple-people: several people speak together under the target label.
- not-a-speaker: a translator note, editor note, heading or production instruction.
- identity-hidden: someone speaks, but the source label deliberately withholds their identity,
  such as ??? or Unknown Voice.

Rules:
1. sameIdentityAs contains other literal labels clearly representing the same identity.
2. possiblySameIdentityAs contains plausible relationships that remain uncertain.
3. Both relationship fields may contain multiple labels. Use [] when there are none.
4. Copy every relationship exactly from RELATIONSHIP CANDIDATES. Never include TARGET LABEL itself.
5. RELATIONSHIP CANDIDATES are allowed references, not proof. Return a relationship only when TARGET
   EVIDENCE and CANDIDATE EVIDENCE support it.
6. Similar spelling alone is not enough. Distinct roles or contexts are evidence to keep labels apart.
7. identity-hidden uses empty relationship lists unless evidence directly reveals the hidden identity.
8. When there are no RELATIONSHIP CANDIDATES, both relationship lists must be empty.
9. Do not invent labels or facts. Return JSON only."""

VOICE_PROFILE_SYSTEM = """Suggest one editable audiobook voice profile for one finalized cast member.

Return exactly one JSON object:
{"presentation":"feminine | masculine | androgynous | unspecified",
 "age":"child | young-adult | adult | older-adult | unspecified",
 "tone":"warm | bright | dark | gentle | crisp | gravelly | neutral",
 "pitch":"low | medium | high | unspecified",
 "pace":"measured | natural | brisk",
 "energy":"restrained | balanced | animated",
 "accent":"short accent or dialect suggestion, or unspecified",
 "description":"one short, natural voice-direction sentence"}

This is a casting suggestion, not a claim about the person's identity.
Use only the supplied evidence. When evidence does not support a detail, use unspecified.
The prompt separates representative target speech from target-scoped surrounding story context.
Use surrounding narration only when it clearly describes the cast member. Other characters' speech is
not supplied, so never borrow another speaker's vocal qualities.
Map explicit life-stage descriptions in the source language to the closest allowed age. If narration
clearly calls the cast member a child, boy or girl (or the source-language equivalent) and does not
explicitly call them an adolescent or adult, age MUST be child. Use young-adult only for explicit
adolescent, teenage or young-adult evidence; the word young alone is not enough. Mental maturity never
overrides the physical voice heard in the current story scenes.
If narration unambiguously uses masculine descriptions or pronouns for the cast member, presentation
MUST be masculine; unambiguous feminine descriptions or pronouns MUST produce feminine unless explicit
vocal evidence contradicts them. If narration explicitly describes the cast member's voice as high or
low in any source language, pitch MUST match that register.
Use target speech mainly for tone, pace and energy. The description must contain audible performance
direction only, not biography or plot summary.
Do not infer an accent from a name. Do not explain your choices. Return JSON only."""

VOICE_PROFILE_OPTIONS = {
    "presentation": {"feminine", "masculine", "androgynous", "unspecified"},
    "age": {"child", "young-adult", "adult", "older-adult", "unspecified"},
    "tone": {"warm", "bright", "dark", "gentle", "crisp", "gravelly", "neutral"},
    "pitch": {"low", "medium", "high", "unspecified"},
    "pace": {"measured", "natural", "brisk"},
    "energy": {"restrained", "balanced", "animated"},
}

VOICE_DIRECTION_MAX_CHARACTERS = 250


def propose_cast(
    repo_root,
    turns: Sequence[Mapping[str, Any]],
    report: Report | None = None,
) -> dict[str, Any]:
    """Classify each literal label independently, then combine relationships in code."""

    with qwen_server(repo_root) as base:
        return propose_cast_with_completion(
            turns,
            lambda system, prompt, max_tokens: complete_json(
                base, system, prompt, max_tokens=max_tokens
            ),
            model_name="Qwen 3.5 9B local",
            report=report,
        )


def propose_cast_with_completion(
    turns: Sequence[Mapping[str, Any]],
    complete: JsonCompletion,
    *,
    model_name: str,
    report: Report | None = None,
    max_workers: int = 1,
) -> dict[str, Any]:
    """Run provider-neutral Cast classification through the shared validation contract."""

    if max_workers < 1:
        raise CastContractError("Cast completion concurrency must be positive")

    notify = report or (lambda _progress, _message=None: None)
    dossiers = build_label_dossiers(turns)
    fuzzy = suggest_fuzzy_candidates(dossiers, threshold=RELATIONSHIP_CANDIDATE_THRESHOLD)
    dossier_by_label = {str(row["label"]): row for row in dossiers}
    fuzzy_by_label = _fuzzy_by_label(fuzzy)
    notify(2, f"Reviewing {len(dossiers)} character labels with AI")

    def classify(dossier: Mapping[str, Any]) -> dict[str, Any]:
        label = str(dossier["label"])
        candidate_labels = fuzzy_by_label.get(label_comparison_key(label), [])
        decision = _complete_validated_decision_with(
            complete,
            _label_prompt(dossier, dossier_by_label, candidate_labels),
            label,
            [label, *candidate_labels],
        )
        return _proposal_from_decision(dossier, decision)

    if max_workers == 1:
        proposals = [classify(dossier) for dossier in dossiers]
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            proposals = list(executor.map(classify, dossiers))
    for index, dossier in enumerate(dossiers, 1):
        label = str(dossier["label"])
        notify(
            5 + index / max(len(dossiers), 1) * 90,
            f"Classified cast label {index} of {len(dossiers)}: {label}",
        )
    proposals = _combine_confirmed_relationships(proposals)
    summary = build_relationship_summary([proposals], dossiers)
    notify(100, "Cast proposals are ready for identity review")
    return {
        "status": "needs-review" if any(row["reviewRequired"] for row in proposals) else "ready",
        "dossiers": dossiers,
        "fuzzyCandidates": fuzzy,
        "globalLabelLedger": build_compact_label_ledger(dossiers),
        "proposals": proposals,
        # Retained artifact field; conflicts are detected in code, not by another model pass.
        "reconciliationConflicts": summary["conflicts"],
        "processing": {
            "labels": len(dossiers),
            "batches": len(dossiers),
            "modelCalls": len(dossiers),
            "model": model_name,
        },
    }


def suggest_voice_settings(
    repo_root,
    identities: Sequence[Mapping[str, Any]],
    dossiers: Sequence[Mapping[str, Any]],
    story_spans: Sequence[Mapping[str, Any]],
    report: Report | None = None,
) -> dict[str, dict[str, str]]:
    """Suggest one scene-grounded voice profile per identity with one model call each."""

    with qwen_server(repo_root) as base:
        return suggest_voice_settings_with_completion(
            identities,
            dossiers,
            story_spans,
            lambda system, prompt, max_tokens: complete_json(
                base, system, prompt, max_tokens=max_tokens
            ),
            report=report,
        )


def suggest_voice_settings_with_completion(
    identities: Sequence[Mapping[str, Any]],
    dossiers: Sequence[Mapping[str, Any]],
    story_spans: Sequence[Mapping[str, Any]],
    complete: JsonCompletion,
    *,
    report: Report | None = None,
    max_workers: int = 1,
    evidence_policy: VoiceEvidencePolicy | None = None,
) -> dict[str, dict[str, str]]:
    """Run provider-neutral voice profiling through the shared validation contract."""

    if max_workers < 1:
        raise CastContractError("Voice-profile completion concurrency must be positive")

    policy = evidence_policy or DEFAULT_VOICE_EVIDENCE_POLICY
    notify = report or (lambda _progress, _message=None: None)
    dossiers_by_label = {label_comparison_key(row.get("label", "")): row for row in dossiers}
    targets = [
        {
            "characterId": "narrator",
            "name": "Narrator",
            "category": "narrator",
            "evidence": [
                normalize_label(row.get("text", ""))
                for row in story_spans
                if row.get("renderRole") == "narration" and normalize_label(row.get("text", ""))
            ][: min(3, policy.max_examples)],
            "labels": [],
            "storyContext": [],
        }
    ]
    for identity in identities:
        targets.append(
            _voice_target(
                identity,
                dossiers_by_label,
                story_spans,
                evidence_policy=policy,
            )
        )

    notify(2, f"Preparing {len(targets)} voice profiles with AI")

    def profile(target: Mapping[str, Any]) -> tuple[str, dict[str, str]]:
        fallback = default_voice_settings(str(target["category"]))
        try:
            settings = _complete_voice_settings_with(
                complete,
                _voice_profile_prompt(target, evidence_policy=policy),
                max_prompt_characters=policy.max_prompt_characters,
            )
        except CastContractError:
            settings = fallback
        return str(target["characterId"]), settings

    if max_workers == 1:
        completed = [profile(target) for target in targets]
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            completed = list(executor.map(profile, targets))
    profiles = dict(completed)
    for index, target in enumerate(targets, 1):
        notify(
            5 + index / max(len(targets), 1) * 90,
            f"Prepared voice {index} of {len(targets)}: {target['name']}",
        )
    notify(100, "Voice suggestions are ready for auditions")
    return profiles


def _voice_target(
    identity: Mapping[str, Any],
    dossiers_by_label: Mapping[str, Mapping[str, Any]],
    story_spans: Sequence[Mapping[str, Any]],
    *,
    evidence_policy: VoiceEvidencePolicy | None = None,
) -> dict[str, Any]:
    """Assemble language-agnostic structural context before the single voice-profile call."""

    labels = [normalize_label(value) for value in identity.get("literalLabels", [])]
    labels = [value for value in labels if value]
    policy = evidence_policy or DEFAULT_VOICE_EVIDENCE_POLICY
    selected = _select_voice_examples(labels, dossiers_by_label, policy)
    return {
        "characterId": str(identity["characterId"]),
        "name": str(identity["name"]),
        "category": str(identity.get("category", "character")),
        "labels": labels,
        "evidence": [normalize_label(row.get("sourceText", "")) for row in selected],
        "storyContext": _surrounding_story_context(selected, labels, story_spans),
    }


def _select_voice_examples(
    labels: Sequence[str],
    dossiers_by_label: Mapping[str, Mapping[str, Any]],
    policy: VoiceEvidencePolicy,
) -> list[Mapping[str, Any]]:
    """Allocate examples round-robin, prioritizing labels with more source occurrences."""

    groups: list[dict[str, Any]] = []
    for position, label in enumerate(labels):
        dossier = dossiers_by_label.get(label_comparison_key(label))
        if dossier is None:
            continue
        examples = [row for row in dossier.get("examples", []) if isinstance(row, Mapping)]
        if examples:
            groups.append(
                {
                    "position": position,
                    "occurrences": int(dossier.get("occurrenceCount", len(examples))),
                    "examples": examples,
                    "cursor": 0,
                }
            )
    groups.sort(key=lambda row: (-row["occurrences"], row["position"]))

    selected: list[Mapping[str, Any]] = []
    seen_text: set[str] = set()
    for _round in range(policy.max_examples_per_label):
        for group in groups:
            examples = group["examples"]
            while group["cursor"] < len(examples):
                example = examples[group["cursor"]]
                group["cursor"] += 1
                text = normalize_label(example.get("sourceText", ""))
                if not text or text in seen_text:
                    continue
                seen_text.add(text)
                selected.append(example)
                break
            if len(selected) == policy.max_examples:
                return selected
    return selected


def _surrounding_story_context(
    examples: Sequence[Mapping[str, Any]],
    labels: Sequence[str],
    story_spans: Sequence[Mapping[str, Any]],
) -> list[str]:
    """Expand representative speech into adjacent structural units without text searching."""

    if not examples or not story_spans:
        return []

    unit_keys = [_story_unit_key(span, index) for index, span in enumerate(story_spans)]
    ordered_units: list[str] = []
    unit_positions: dict[str, int] = {}
    for key in unit_keys:
        if key not in unit_positions:
            unit_positions[key] = len(ordered_units)
            ordered_units.append(key)

    span_units = {
        str(span.get("id")): unit_keys[index]
        for index, span in enumerate(story_spans)
        if span.get("id") is not None
    }
    selected_units: set[str] = set()
    for example in examples:
        key = _example_unit_key(example, span_units)
        position = unit_positions.get(key)
        if position is None:
            continue
        selected_units.update(
            ordered_units[max(0, position - 1) : min(len(ordered_units), position + 2)]
        )

    target_labels = {label_comparison_key(label) for label in labels}
    context: list[str] = []
    current_unit: str | None = None
    for index, span in enumerate(story_spans):
        unit = unit_keys[index]
        if unit not in selected_units:
            continue
        role = str(span.get("renderRole", "")).strip().casefold()
        speaker = span.get("resolvedSpeakerLabel") or span.get("sourceSpeakerLabel")
        is_target_speech = speaker is not None and label_comparison_key(speaker) in target_labels
        if role != "narration" and not is_target_speech:
            continue
        text = normalize_label(span.get("source") or span.get("text", ""))
        if not text:
            continue
        if unit != current_unit:
            current_unit = unit
            context.append(f"[SOURCE UNIT {unit}]")
        if role == "narration":
            context.append(f"[SURROUNDING NARRATION] {text}")
        else:
            context.append(f"[TARGET SPEECH: {normalize_label(speaker)}] {text}")
    return context


def _story_unit_key(span: Mapping[str, Any], index: int) -> str:
    block_id = normalize_label(span.get("blockId", ""))
    if block_id:
        return f"block:{block_id}"
    page = span.get("page")
    if page is not None:
        chapter = normalize_label(span.get("chapterId", ""))
        return f"page:{chapter}:{page}"
    span_id = normalize_label(span.get("id", ""))
    return f"span:{span_id or index}"


def _example_unit_key(example: Mapping[str, Any], span_units: Mapping[str, str]) -> str:
    block_id = normalize_label(example.get("blockId", ""))
    if block_id:
        return f"block:{block_id}"
    page = example.get("page")
    if page is not None:
        chapter = normalize_label(example.get("chapterId", ""))
        return f"page:{chapter}:{page}"
    return span_units.get(str(example.get("spanId", "")), "")


def default_voice_settings(category: str = "character") -> dict[str, str]:
    narrator = category == "narrator"
    return {
        "presentation": "unspecified",
        "age": "adult" if narrator else "unspecified",
        "tone": "warm" if narrator else "neutral",
        "pitch": "medium" if narrator else "unspecified",
        "pace": "measured" if narrator else "natural",
        "energy": "balanced",
        "accent": "unspecified",
        "description": (
            "Clear audiobook narrator with precise, natural delivery."
            if narrator
            else "Distinct, natural audiobook voice with clear delivery."
        ),
    }


def validate_voice_settings(raw: object, *, fallback_category: str = "character") -> dict[str, str]:
    if not isinstance(raw, Mapping):
        raise CastContractError("Voice settings must be one JSON object")
    result: dict[str, str] = {}
    for field, allowed in VOICE_PROFILE_OPTIONS.items():
        value = str(raw.get(field, "")).strip().lower()
        if value not in allowed:
            raise CastContractError(f"Unsupported voice {field}: {value or '<empty>'}")
        result[field] = value
    accent = normalize_label(raw.get("accent", "")) or "unspecified"
    description = normalize_label(raw.get("description", ""))
    if len(accent) > 48:
        raise CastContractError("Voice accent must be 48 characters or fewer")
    if len(description) > 180:
        raise CastContractError("Voice description must contain 180 characters or fewer")
    result.update({"accent": accent, "description": description})
    return {**default_voice_settings(fallback_category), **result}


def compile_voice_direction(settings: Mapping[str, Any], *, language: str = "english") -> str:
    """Compile editable handles into one provider-portable VoiceDesign description."""

    presentation = {
        "feminine": "female",
        "masculine": "male",
        "androgynous": "androgynous",
    }.get(str(settings.get("presentation", "unspecified")).strip().lower())
    age = {
        "child": "child",
        "young-adult": "young adult",
        "adult": "adult",
        "older-adult": "older adult",
    }.get(str(settings.get("age", "unspecified")).strip().lower())
    tone = {
        "warm": "warm, rounded timbre",
        "bright": "bright, clear timbre",
        "dark": "dark, weighty timbre",
        "gentle": "gentle, soft-edged timbre",
        "crisp": "crisp, articulated timbre",
        "gravelly": "gravelly, textured timbre",
        "neutral": "neutral, natural timbre",
    }.get(str(settings.get("tone", "unspecified")).strip().lower())
    pitch = {
        "low": "low pitch",
        "medium": "medium pitch",
        "high": "high pitch",
    }.get(str(settings.get("pitch", "unspecified")).strip().lower())
    pace = {
        "measured": "measured pace",
        "natural": "natural pace",
        "brisk": "brisk pace",
    }.get(str(settings.get("pace", "unspecified")).strip().lower())
    energy = {
        "restrained": "restrained energy",
        "balanced": "balanced energy",
        "animated": "animated energy",
    }.get(str(settings.get("energy", "unspecified")).strip().lower())

    voice_qualifiers = [value for value in (presentation, age) if value]
    voice_phrase = " ".join([*voice_qualifiers, "voice"]).capitalize()
    parts = [voice_phrase, *[value for value in (tone, pitch, pace, energy) if value]]

    accent = normalize_label(settings.get("accent", ""))
    if accent and accent.lower() != "unspecified":
        spoken_language = normalize_label(language).replace("-", " ").title() or "Selected language"
        accent = accent[0].upper() + accent[1:]
        parts.append(f"{accent} accent in {spoken_language}")
    description = normalize_label(settings.get("description", ""))
    if description:
        parts.append(description.rstrip("."))
    direction = "; ".join(parts) + "."
    if len(direction) > VOICE_DIRECTION_MAX_CHARACTERS:
        raise CastContractError(
            f"Voice direction exceeds {VOICE_DIRECTION_MAX_CHARACTERS} characters; "
            "shorten the performance notes or accent"
        )
    return direction


def _voice_profile_prompt(
    target: Mapping[str, Any], *, evidence_policy: VoiceEvidencePolicy | None = None
) -> str:
    policy = evidence_policy or DEFAULT_VOICE_EVIDENCE_POLICY
    evidence = [
        _bounded_voice_text(str(value), max_characters=policy.max_line_characters)
        for value in target.get("evidence", [])
        if str(value).strip()
    ]
    labels = [str(value) for value in target.get("labels", []) if str(value).strip()]
    story_context = _bounded_voice_lines(
        [str(value) for value in target.get("storyContext", []) if str(value).strip()],
        policy.max_context_characters,
        max_line_characters=policy.max_line_characters,
    )
    evidence_heading = (
        "REPRESENTATIVE NARRATION"
        if str(target.get("category", "")) == "narrator"
        else "REPRESENTATIVE TARGET SPEECH"
    )
    sections = [
        "CAST MEMBER",
        f"Name: {target['name']}",
        f"Role: {target['category']}",
    ]
    if labels:
        sections.extend([f"Known source labels: {', '.join(labels)}"])
    sections.extend(
        [
            "",
            evidence_heading,
            *([f"- {value}" for value in evidence] or ["(none; use unspecified)"]),
        ]
    )
    if story_context:
        sections.extend(["", "TARGET-SCOPED STORY CONTEXT", *story_context])
    return _bounded_voice_prompt(
        "\n".join(sections), max_characters=policy.max_prompt_characters
    )


def _bounded_voice_text(
    value: str, *, max_characters: int = MAX_VOICE_PROFILE_LINE_CHARACTERS
) -> str:
    """Keep one source line useful without allowing it to consume the whole prompt."""

    if len(value) <= max_characters:
        return value
    keep = max_characters - len(VOICE_PROFILE_TRUNCATION_MARKER)
    return value[:keep].rstrip() + VOICE_PROFILE_TRUNCATION_MARKER


def _bounded_voice_lines(
    values: Sequence[str],
    max_characters: int,
    *,
    max_line_characters: int = MAX_VOICE_PROFILE_LINE_CHARACTERS,
) -> list[str]:
    """Bound a prompt section while preserving as many ordered source lines as possible."""

    result: list[str] = []
    used = 0
    for value in values:
        line = _bounded_voice_text(value, max_characters=max_line_characters)
        separator = 1 if result else 0
        if used + separator + len(line) <= max_characters:
            result.append(line)
            used += separator + len(line)
            continue
        remaining = max_characters - used - separator
        if remaining > len(VOICE_PROFILE_TRUNCATION_MARKER):
            keep = remaining - len(VOICE_PROFILE_TRUNCATION_MARKER)
            result.append(line[:keep].rstrip() + VOICE_PROFILE_TRUNCATION_MARKER)
        break
    return result


def _bounded_voice_prompt(
    prompt: str, *, max_characters: int = MAX_VOICE_PROFILE_PROMPT_CHARACTERS
) -> str:
    """Apply a final defensive ceiling so malformed source metadata cannot block Cast."""

    if len(prompt) <= max_characters:
        return prompt
    keep = max_characters - len(VOICE_PROFILE_TRUNCATION_MARKER) - 1
    return prompt[:keep].rstrip() + "\n" + VOICE_PROFILE_TRUNCATION_MARKER


def _complete_voice_settings(base: str, prompt: str) -> dict[str, str]:
    return _complete_voice_settings_with(
        lambda system, value, max_tokens: complete_json(
            base, system, value, max_tokens=max_tokens
        ),
        prompt,
    )


def _complete_voice_settings_with(
    complete: JsonCompletion,
    prompt: str,
    *,
    max_prompt_characters: int = MAX_VOICE_PROFILE_PROMPT_CHARACTERS,
) -> dict[str, str]:
    failures: list[str] = []
    retry_prompt = prompt
    for _attempt in range(2):
        raw = complete(VOICE_PROFILE_SYSTEM, retry_prompt, 384)
        try:
            return validate_voice_settings(raw)
        except CastContractError as error:
            failures.append(str(error))
            retry_prompt = _bounded_voice_prompt(
                "Please try once more. Use only the exact allowed values and all eight fields.\n\n"
                + prompt,
                max_characters=max_prompt_characters,
            )
    raise CastContractError("Voice profile validation failed: " + " | ".join(failures))


def _complete_validated_decision(
    base: str,
    prompt: str,
    target_label: str,
    relationship_labels: Sequence[str],
) -> dict[str, Any]:
    return _complete_validated_decision_with(
        lambda system, value, max_tokens: complete_json(
            base, system, value, max_tokens=max_tokens
        ),
        prompt,
        target_label,
        relationship_labels,
    )


def _complete_validated_decision_with(
    complete: JsonCompletion,
    prompt: str,
    target_label: str,
    relationship_labels: Sequence[str],
) -> dict[str, Any]:
    failures: list[str] = []
    retry_prompt = prompt
    for _attempt in range(3):
        result = complete(SYSTEM, retry_prompt, 512)
        try:
            return _validate_decision(result, target_label, relationship_labels)
        except CastContractError as error:
            failures.append(str(error))
            retry_prompt = (
                prompt
                + "\n\nTRY AGAIN\nYour previous answer violated the contract: "
                + str(error)
                + "\nReturn only the three required fields."
            )
    raise CastContractError(
        "Text model failed Cast label validation after 3 attempts: " + " | ".join(failures)
    )


def _validate_decision(
    raw: object,
    target_label: str,
    relationship_labels: Sequence[str],
) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise CastContractError("Cast label decision must be one JSON object")
    required_fields = {"speakerType", "sameIdentityAs", "possiblySameIdentityAs"}
    if set(raw) != required_fields:
        raise CastContractError(
            "Cast label decision must contain exactly the three required fields"
        )
    speaker_type = str(raw.get("speakerType", "")).strip()
    if speaker_type not in SPEAKER_TYPES:
        raise CastContractError(f"Unsupported speakerType: {speaker_type or '<empty>'}")
    known = {label_comparison_key(label): normalize_label(label) for label in relationship_labels}
    target_key = label_comparison_key(target_label)
    if set(known) == {target_key}:
        for field in ("sameIdentityAs", "possiblySameIdentityAs"):
            if not isinstance(raw.get(field), list):
                raise CastContractError(f"{field} must be a list")
        return {
            "speakerType": speaker_type,
            # With no candidates, relationships have no authority and are empty by definition.
            "sameIdentityAs": [],
            "possiblySameIdentityAs": [],
        }
    same = _relationship_labels(raw.get("sameIdentityAs"), "sameIdentityAs", known, target_key)
    possible = _relationship_labels(
        raw.get("possiblySameIdentityAs"),
        "possiblySameIdentityAs",
        known,
        target_key,
    )
    overlap = sorted(set(same) & set(possible))
    if overlap:
        raise CastContractError(f"Relationships cannot be both certain and possible: {overlap}")
    return {
        "speakerType": speaker_type,
        "sameIdentityAs": same,
        "possiblySameIdentityAs": possible,
    }


def _relationship_labels(
    value: object,
    field: str,
    known: Mapping[str, str],
    target_key: str,
) -> list[str]:
    if not isinstance(value, list):
        raise CastContractError(f"{field} must be a list")
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        label = normalize_label(item)
        key = label_comparison_key(label)
        if key == target_key:
            raise CastContractError(f"{field} cannot contain the target label")
        if key not in known:
            raise CastContractError(f"{field} references unknown label: {label or '<empty>'}")
        if key not in seen:
            seen.add(key)
            result.append(known[key])
    return result


def _label_prompt(
    dossier: Mapping[str, Any],
    dossier_by_label: Mapping[str, Mapping[str, Any]],
    candidate_labels: Sequence[str],
) -> str:
    target = str(dossier["label"])
    candidates = [
        label for label in candidate_labels if label in dossier_by_label and label != target
    ][:MAX_RELATIONSHIP_CANDIDATES]
    sections = [
        "TARGET LABEL",
        target,
        "",
        "TARGET EVIDENCE",
        *_evidence_lines(dossier),
        "",
        "RELATIONSHIP CANDIDATES",
        *([f"- {label}" for label in candidates] or ["(none; return empty relationship lists)"]),
    ]
    if candidates:
        sections.extend(["", "CANDIDATE EVIDENCE"])
        for label in candidates:
            sections.extend(["", f"{label}:", *_evidence_lines(dossier_by_label[label])])
    return "\n".join(sections)


def _evidence_lines(dossier: Mapping[str, Any]) -> list[str]:
    examples = [
        normalize_label(row.get("sourceText", ""))
        for row in dossier.get("examples", [])
        if normalize_label(row.get("sourceText", ""))
    ]
    return [f"- {value}" for value in examples] or ["(none)"]


def _fuzzy_by_label(fuzzy: Sequence[Mapping[str, Any]]) -> dict[str, list[str]]:
    scored: dict[str, list[tuple[float, str]]] = {}
    for row in fuzzy:
        left = normalize_label(row.get("leftLabel", ""))
        right = normalize_label(row.get("rightLabel", ""))
        if left and right:
            score = float(row.get("score", 0.0))
            scored.setdefault(label_comparison_key(left), []).append((score, right))
            scored.setdefault(label_comparison_key(right), []).append((score, left))
    return {
        key: [
            label
            for _score, label in sorted(
                candidates,
                key=lambda item: (-item[0], label_comparison_key(item[1])),
            )[:MAX_RELATIONSHIP_CANDIDATES]
        ]
        for key, candidates in scored.items()
    }


def _proposal_from_decision(
    dossier: Mapping[str, Any], decision: Mapping[str, Any]
) -> dict[str, Any]:
    label = str(dossier["label"])
    category = SPEAKER_TYPES[str(decision["speakerType"])]
    if category == "character" and looks_joint_label(label):
        category = "group"
    canonical = label if category in {"character", "group"} else None
    aliases = list(decision["sameIdentityAs"])
    possible = list(decision["possiblySameIdentityAs"])
    material = category != "character" or bool(aliases) or bool(possible)
    return {
        "label": label,
        "category": category,
        "canonicalName": canonical,
        "aliases": aliases,
        "competingLabels": possible,
        "reason": _decision_reason(category, aliases, possible),
        "voiceProfile": None,
        "auditionLine": None,
        "reviewRequired": material,
        "sourceSpellings": list(dossier.get("sourceSpellings", [])),
    }


def _decision_reason(
    category: str,
    aliases: Sequence[str],
    possible: Sequence[str],
) -> str:
    parts = []
    if aliases:
        parts.append("Evidence supports the same identity as " + ", ".join(aliases))
    if possible:
        parts.append("Possible identity relationship with " + ", ".join(possible))
    if parts:
        return ". ".join(parts) + "."
    return {
        "character": "Source evidence supports one individual speaker.",
        "group": "Source evidence indicates several people speaking together.",
        "editorial": "Source evidence indicates material that is not a speaker.",
        "unresolved-marker": "The source label deliberately withholds the speaker identity.",
    }[category]


def _combine_confirmed_relationships(
    proposals: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Combine only reciprocal identity claims; retain one-sided claims as suggestions."""

    rows = [dict(row) for row in proposals]
    by_key = {label_comparison_key(row["label"]): row for row in rows}
    directed = {
        key: {
            other
            for alias in row.get("aliases", [])
            if (other := label_comparison_key(alias)) in by_key and other != key
        }
        for key, row in by_key.items()
    }
    edges = {key: set() for key in by_key}
    for key, row in by_key.items():
        suggestions = list(row.get("competingLabels", []))
        for other in directed[key]:
            same_kind = row.get("category") == by_key[other].get("category")
            playable = row.get("category") in {"character", "group"}
            if key in directed[other] and same_kind and playable:
                edges[key].add(other)
                edges[other].add(key)
            else:
                suggestions.append(str(by_key[other]["label"]))
        row["aliases"] = []
        row["competingLabels"] = list(dict.fromkeys(suggestions))
    seen: set[str] = set()
    for start in by_key:
        if start in seen or not edges[start]:
            continue
        pending = [start]
        component: list[str] = []
        while pending:
            key = pending.pop()
            if key in seen:
                continue
            seen.add(key)
            component.append(key)
            pending.extend(edges[key] - seen)
        members = [by_key[key] for key in component]
        canonical = max(
            (str(row["label"]) for row in members),
            # Prefer the most specific confirmed source label as the canonical display label.
            key=lambda value: (len(value.split()), len(value), value.casefold()),
        )
        labels = [str(row["label"]) for row in members]
        for row in members:
            if row["category"] in {"character", "group"}:
                row["canonicalName"] = canonical
            row["aliases"] = [label for label in labels if label != row["label"]]
            row["competingLabels"] = [
                label for label in row.get("competingLabels", []) if label not in labels
            ]
            row["reviewRequired"] = True
    return rows
