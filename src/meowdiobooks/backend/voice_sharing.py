"""Deterministic, provider-neutral allocation of low-salience cast voices."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from hashlib import sha256
from math import ceil, floor
from typing import Any


VOICE_SHARING_COMPATIBILITY_FIELDS = frozenset(
    {"presentation", "age", "tone", "pitch", "pace", "energy", "accent"}
)


@dataclass(frozen=True)
class VoiceSharingPolicy:
    """Hosted policy for automatic audition reuse.

    A zero absolute or proportional limit disables automatic sharing. Compatibility fields refer
    to the structured voice settings already produced before auditions; free-form descriptions are
    deliberately excluded because exact prose matching would be unstable and provider-specific.
    """

    dedicated_dialogue_coverage: float | None = None
    # Retained for one release as a compatibility bridge for hosted compositions. New
    # deployments should set ``dedicated_dialogue_coverage`` and omit both thresholds.
    max_lines: int = 0
    max_dialogue_fraction: float = 0.0
    collision_window_turns: int = 8
    compatibility_fields: tuple[str, ...] = ("age", "presentation")

    def __post_init__(self) -> None:
        if (
            self.dedicated_dialogue_coverage is not None
            and not 0 <= self.dedicated_dialogue_coverage <= 1
        ):
            raise ValueError("Dedicated dialogue coverage must be between zero and one")
        if self.max_lines < 0:
            raise ValueError("Voice-sharing max_lines cannot be negative")
        if not 0 <= self.max_dialogue_fraction <= 1:
            raise ValueError("Voice-sharing max_dialogue_fraction must be between zero and one")
        if self.collision_window_turns < 0:
            raise ValueError("Voice-sharing collision_window_turns cannot be negative")
        fields = tuple(dict.fromkeys(self.compatibility_fields))
        unknown = sorted(set(fields) - VOICE_SHARING_COMPATIBILITY_FIELDS)
        if unknown:
            raise ValueError(f"Unsupported voice-sharing compatibility fields: {unknown}")
        object.__setattr__(self, "compatibility_fields", fields)


@dataclass(frozen=True)
class SharedVoiceGroup:
    id: str
    character_ids: tuple[str, ...]


@dataclass(frozen=True)
class VoiceSharingPlan:
    groups: tuple[SharedVoiceGroup, ...]
    total_dialogue_lines: int
    effective_line_limit: int
    dedicated_character_ids: tuple[str, ...] = ()

    @property
    def group_by_character_id(self) -> dict[str, SharedVoiceGroup]:
        return {
            character_id: group
            for group in self.groups
            for character_id in group.character_ids
        }


def plan_shared_voices(
    identities: Sequence[Mapping[str, Any]],
    voice_settings: Mapping[str, Mapping[str, Any]],
    spans: Sequence[Mapping[str, Any]],
    label_to_character_id: Mapping[str, Any],
    policy: VoiceSharingPolicy,
    *,
    shareable_character_ids: set[str] | frozenset[str] | None = None,
) -> VoiceSharingPlan:
    """Assign the low-dialogue tail to deterministic first-fit voice groups.

    With ``dedicated_dialogue_coverage`` configured, narrator/non-character roles remain dedicated,
    then the highest-dialogue characters remain dedicated until the configured share of mapped
    dialogue is covered. Only the compatible remainder may share. The old absolute thresholds are
    supported temporarily when no coverage policy is configured.
    """

    occurrences, total_dialogue_lines = _dialogue_occurrences(spans, label_to_character_id)
    if policy.dedicated_dialogue_coverage is None:
        eligible, effective_line_limit, dedicated_character_ids = _legacy_eligible_characters(
            identities, occurrences, total_dialogue_lines, policy
        )
    else:
        eligible, dedicated_character_ids = _coverage_tail_characters(
            identities,
            occurrences,
            policy.dedicated_dialogue_coverage,
        )
        effective_line_limit = 0
    if shareable_character_ids is not None:
        eligible = [
            row
            for row in eligible
            if str(row.get("characterId", "")) in shareable_character_ids
        ]
    eligible.sort(
        key=lambda row: (
            -len(occurrences[str(row["characterId"])]),
            occurrences[str(row["characterId"])][0],
            str(row["characterId"]),
        )
    )

    allocated: list[list[str]] = []
    for identity in eligible:
        character_id = str(identity["characterId"])
        settings = voice_settings.get(character_id, {})
        destination = next(
            (
                group
                for group in allocated
                if all(
                    _settings_compatible(
                        settings,
                        voice_settings.get(member_id, {}),
                        policy.compatibility_fields,
                    )
                    and not _collide(
                        occurrences[character_id],
                        occurrences[member_id],
                        policy.collision_window_turns,
                    )
                    for member_id in group
                )
            ),
            None,
        )
        if destination is None:
            allocated.append([character_id])
        else:
            destination.append(character_id)

    groups = tuple(
        SharedVoiceGroup(_shared_group_id(character_ids), tuple(character_ids))
        for character_ids in (group for group in allocated if len(group) >= 2)
    )
    return VoiceSharingPlan(
        groups,
        total_dialogue_lines,
        effective_line_limit,
        tuple(dedicated_character_ids),
    )


def _legacy_eligible_characters(
    identities: Sequence[Mapping[str, Any]],
    occurrences: Mapping[str, Sequence[tuple[str, int]]],
    total_dialogue_lines: int,
    policy: VoiceSharingPolicy,
) -> tuple[list[Mapping[str, Any]], int, list[str]]:
    proportional_limit = (
        max(1, floor(total_dialogue_lines * policy.max_dialogue_fraction))
        if total_dialogue_lines and policy.max_dialogue_fraction
        else 0
    )
    effective_line_limit = min(policy.max_lines, proportional_limit)
    eligible = [
        row
        for row in identities
        if row.get("category") == "character"
        and 0 < len(occurrences.get(str(row.get("characterId", "")), ()))
        <= effective_line_limit
    ]
    eligible_ids = {str(row.get("characterId", "")) for row in eligible}
    dedicated = [
        str(row.get("characterId", ""))
        for row in identities
        if row.get("category") == "character"
        and str(row.get("characterId", "")) not in eligible_ids
    ]
    return eligible, effective_line_limit, dedicated


def _coverage_tail_characters(
    identities: Sequence[Mapping[str, Any]],
    occurrences: Mapping[str, Sequence[tuple[str, int]]],
    coverage: float,
) -> tuple[list[Mapping[str, Any]], list[str]]:
    characters = [row for row in identities if row.get("category") == "character"]
    character_ids = {str(row.get("characterId", "")) for row in characters}
    total_mapped_dialogue = sum(len(rows) for rows in occurrences.values())
    covered_dialogue = sum(
        len(rows) for character_id, rows in occurrences.items() if character_id not in character_ids
    )
    target = ceil(total_mapped_dialogue * coverage)
    ordered = sorted(
        characters,
        key=lambda row: (
            -len(occurrences.get(str(row.get("characterId", "")), ())),
            occurrences.get(str(row.get("characterId", "")), (("", 2**63 - 1),))[0],
            str(row.get("characterId", "")),
        ),
    )
    dedicated: list[str] = []
    tail: list[Mapping[str, Any]] = []
    for row in ordered:
        character_id = str(row.get("characterId", ""))
        count = len(occurrences.get(character_id, ()))
        if count <= 0 or covered_dialogue < target:
            dedicated.append(character_id)
            covered_dialogue += count
        else:
            tail.append(row)
    return tail, dedicated


def _shared_group_id(character_ids: Sequence[str]) -> str:
    stable_members = "\x1f".join(sorted(character_ids))
    digest = sha256(stable_members.encode("utf-8")).hexdigest()[:10]
    return f"shared-voice-{digest}"


def _dialogue_occurrences(
    spans: Sequence[Mapping[str, Any]], label_to_character_id: Mapping[str, Any]
) -> tuple[dict[str, tuple[tuple[str, int], ...]], int]:
    occurrences: dict[str, list[tuple[str, int]]] = {}
    dialogue_turn = 0
    for span in spans:
        if str(span.get("renderRole", "narration")) != "dialogue":
            continue
        labels = span.get("speakerLabels")
        if labels is None:
            label = span.get("resolvedSpeakerLabel") or span.get("sourceSpeakerLabel")
            labels = [label] if label is not None else []
        chapter_id = str(span.get("chapterId") or "complete-document")
        for character_id in {
            str(label_to_character_id.get(str(label)) or "")
            for label in labels
            if str(label)
        } - {""}:
            occurrences.setdefault(character_id, []).append((chapter_id, dialogue_turn))
        dialogue_turn += 1
    return {key: tuple(value) for key, value in occurrences.items()}, dialogue_turn


def _settings_compatible(
    left: Mapping[str, Any], right: Mapping[str, Any], fields: Sequence[str]
) -> bool:
    for field in fields:
        left_value = _setting_value(left.get(field))
        right_value = _setting_value(right.get(field))
        if left_value and right_value and left_value != right_value:
            return False
    return True


def _setting_value(value: Any) -> str:
    normalized = " ".join(str(value or "").strip().casefold().split())
    return "" if normalized in {"", "unspecified"} else normalized


def _collide(
    left: Sequence[tuple[str, int]],
    right: Sequence[tuple[str, int]],
    collision_window_turns: int,
) -> bool:
    return any(
        left_chapter == right_chapter and abs(left_turn - right_turn) <= collision_window_turns
        for left_chapter, left_turn in left
        for right_chapter, right_turn in right
    )
