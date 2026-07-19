"""Provider-neutral policy for spending extra auditions on the busiest voices."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class VoiceCandidatePolicy:
    """Choose a bounded high-usage subset that receives additional auditions."""

    enabled: bool = True
    coverage_fraction: float = 0.8
    min_voices: int = 2
    max_voices: int = 4
    extra_candidates: int = 1

    def __post_init__(self) -> None:
        if not 0 < self.coverage_fraction <= 1:
            raise ValueError("Voice candidate coverage_fraction must be in (0, 1]")
        if self.min_voices < 0:
            raise ValueError("Voice candidate min_voices must be non-negative")
        if self.max_voices < 1:
            raise ValueError("Voice candidate max_voices must be positive")
        if self.min_voices > self.max_voices:
            raise ValueError("Voice candidate min_voices cannot exceed max_voices")
        if self.extra_candidates < 1:
            raise ValueError("Voice candidate extra_candidates must be positive")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> VoiceCandidatePolicy:
        if not value:
            return cls()
        return cls(
            enabled=_boolean(value, "enabled"),
            coverage_fraction=_number(value, "coverage_fraction"),
            min_voices=_integer(value, "min_voices"),
            max_voices=_integer(value, "max_voices"),
            extra_candidates=_integer(value, "extra_candidates"),
        )

    def selected_ids(self, voices: Sequence[Mapping[str, Any]]) -> tuple[str, ...]:
        """Return deterministic IDs ordered by descending spoken-line volume."""

        if not self.enabled or not voices:
            return ()
        ranked: list[tuple[int, int, str]] = []
        for position, voice in enumerate(voices):
            voice_id = str(voice.get("id") or voice.get("characterId") or "")
            if not voice_id:
                continue
            raw_count = voice.get("lineCount", 0)
            count = raw_count if isinstance(raw_count, int) and not isinstance(raw_count, bool) else 0
            ranked.append((max(0, count), position, voice_id))
        ranked.sort(key=lambda row: (-row[0], row[1], row[2]))
        if not ranked:
            return ()

        limit = min(self.max_voices, len(ranked))
        minimum = min(self.min_voices, limit)
        total = sum(row[0] for row in ranked)
        target = total * self.coverage_fraction
        selected: list[str] = []
        covered = 0
        for count, _position, voice_id in ranked[:limit]:
            selected.append(voice_id)
            covered += count
            if len(selected) >= minimum and (total == 0 or covered >= target):
                break
        return tuple(selected)


def _boolean(row: Mapping[str, Any], key: str) -> bool:
    value = row.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"Voice candidate {key} must be a boolean")
    return value


def _integer(row: Mapping[str, Any], key: str) -> int:
    value = row.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"Voice candidate {key} must be an integer")
    return value


def _number(row: Mapping[str, Any], key: str) -> float:
    value = row.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Voice candidate {key} must be a number")
    return float(value)
