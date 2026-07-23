"""Private, exact-input checkpoints for billable Cast voice profiling."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from meowdiobooks.util import canonical_json, write_json

from .cast import label_comparison_key, normalize_label


CHECKPOINT_CONTRACT = "meowdiobooks.cast-voice-profiles.v1"
CHECKPOINT_DIRECTORY = Path(".checkpoints") / "cast-voice-profiles"


def profile_checkpoint_key(
    *,
    proposal_revision: str,
    dialogue_revision: str,
    review_revision: str,
    identities: Sequence[Mapping[str, Any]],
    language: str,
    profiler_revision: str,
    include_narrator: bool,
    generate_audition_lines: bool = False,
) -> str:
    """Bind a checkpoint to every input that can change Luna's profile output."""

    payload = {
        "contract": CHECKPOINT_CONTRACT,
        "proposalRevision": proposal_revision,
        "dialogueRevision": dialogue_revision,
        "reviewRevision": review_revision,
        "language": normalize_label(language).casefold(),
        "profilerRevision": profiler_revision,
        "includeNarrator": include_narrator,
        "identities": sorted(
            (
                {
                    "characterId": str(row.get("characterId", "")),
                    "name": normalize_label(row.get("name", "")),
                    "category": str(row.get("category", "")),
                    "literalLabels": sorted(
                        (
                            normalize_label(label)
                            for label in row.get("literalLabels", [])
                            if normalize_label(label)
                        ),
                        key=lambda label: (label_comparison_key(label), label),
                    ),
                }
                for row in identities
            ),
            key=lambda row: str(row["characterId"]),
        ),
    }
    # Preserve the existing no-line checkpoint key while ensuring the opt-in path can
    # never restore a profile created without audition lines.
    if generate_audition_lines:
        payload["generateAuditionLines"] = True
    return hashlib.sha256(canonical_json(payload)).hexdigest()


def read_profile_checkpoint(
    package: Path,
    key: str,
    *,
    expected_character_ids: set[str],
) -> dict[str, dict[str, str]] | None:
    """Read only a complete, exact-key checkpoint; corrupt or stale data is ignored."""

    path = package / CHECKPOINT_DIRECTORY / f"{key}.json"
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, Mapping) or payload.get("contract") != CHECKPOINT_CONTRACT:
        return None
    if str(payload.get("key", "")) != key:
        return None
    raw_profiles = payload.get("profiles")
    if not isinstance(raw_profiles, Mapping) or set(map(str, raw_profiles)) != expected_character_ids:
        return None
    profiles: dict[str, dict[str, str]] = {}
    for character_id, raw_settings in raw_profiles.items():
        if not isinstance(raw_settings, Mapping) or not all(
            isinstance(field, str) and isinstance(value, str)
            for field, value in raw_settings.items()
        ):
            return None
        profiles[str(character_id)] = dict(raw_settings)
    return profiles


def write_profile_checkpoint(
    package: Path,
    key: str,
    profiles: Mapping[str, Mapping[str, str]],
) -> None:
    """Atomically persist complete profiles without publishing a workflow artifact."""

    write_json(
        package / CHECKPOINT_DIRECTORY / f"{key}.json",
        {
            "contract": CHECKPOINT_CONTRACT,
            "key": key,
            "profiles": {
                str(character_id): dict(settings)
                for character_id, settings in sorted(profiles.items())
            },
        },
    )
