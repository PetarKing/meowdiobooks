"""Provider-neutral audiobook boundary timing and click-free speech edges."""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

import numpy as np

_TIMING = {
    "policy": "semantic-boundaries-v1",
    "turnGapSeconds": 0.24,
    "paragraphGapSeconds": 0.55,
    "chapterHeadingGapSeconds": 1.2,
    "fadeInSeconds": 0.015,
    "fadeOutSeconds": 0.04,
    "fadeShape": "sine-squared",
    "edgeSilenceThreshold": 16 / 32768,
    "edgeMarginSeconds": 0.01,
}
_BOUNDARY_FIELDS = {
    "start": None,
    "turn": "turnGapSeconds",
    "paragraph": "paragraphGapSeconds",
    "chapter-heading": "chapterHeadingGapSeconds",
}


class SpeechSilenceError(ValueError):
    """Speech cannot survive the requested boundary timing policy."""


def timing_policy() -> dict[str, Any]:
    """Return the versioned recipe that consumers include in generation fingerprints."""
    return dict(_TIMING)


def boundary_before(kind: str) -> dict[str, Any]:
    field = _BOUNDARY_FIELDS[kind]
    return {"kind": kind, "seconds": _TIMING[field] if field else 0.0}


def boundary_before_seconds(segment: Mapping[str, Any], default: float = 0.24) -> float:
    """Validate explicit timing, retaining the historical gap for legacy plans."""
    boundary = segment.get("boundaryBefore")
    if boundary is None:
        return _duration(default)
    if not isinstance(boundary, Mapping) or boundary.get("kind") not in _BOUNDARY_FIELDS:
        raise ValueError("Invalid render-plan boundary")
    return _duration(boundary.get("seconds"))


def _duration(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Audio timing must be a finite nonnegative number")
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError("Audio timing must be a finite nonnegative number")
    return result


def apply_edge_fades(
    audio: np.ndarray, sample_rate: int, timing: Mapping[str, Any] | None = None,
) -> np.ndarray:
    """Fade float mono speech without padding, trimming, noise, or increasing amplitude.

    Each ramp is capped at half the clip length, preserving a very short clip's
    center. Endpoints reach zero and the number of samples is unchanged.
    """
    if sample_rate <= 0 or audio.ndim != 1:
        raise ValueError("Fades require mono audio and a positive sample rate")
    policy = timing_policy() if timing is None else timing
    result = np.array(audio, dtype=np.float32, copy=True)
    for field, reverse in (("fadeInSeconds", False), ("fadeOutSeconds", True)):
        count = min(len(result) // 2, round(sample_rate * _duration(policy.get(field))))
        if count:
            ramp = np.sin(np.linspace(0.0, np.pi / 2, count, dtype=np.float32)) ** 2
            if reverse:
                result[-count:] *= ramp[::-1]
            else:
                result[:count] *= ramp
    return result


def prepare_speech_audio(
    audio: np.ndarray, sample_rate: int, timing: Mapping[str, Any],
) -> tuple[np.ndarray, float, float]:
    """Keep all supra-threshold content plus edge margins, then fade the clip.

    Interior quiet and low-level bursts above the threshold are untouched. A clip
    with no detectable speech cannot safely establish boundary timing.
    """
    threshold = _duration(timing.get("edgeSilenceThreshold"))
    margin = round(sample_rate * _duration(timing.get("edgeMarginSeconds")))
    active = np.flatnonzero(np.abs(audio) > threshold)
    if not len(active):
        raise SpeechSilenceError("Speech segment has no samples above the silence threshold")
    start = max(0, int(active[0]) - margin)
    end = min(len(audio), int(active[-1]) + 1 + margin)
    result = apply_edge_fades(audio[start:end], sample_rate, timing)
    active = np.flatnonzero(np.abs(result) > threshold)
    if not len(active):
        raise SpeechSilenceError("Speech segment is too quiet after edge fades")
    return result, int(active[0]) / sample_rate, (len(result) - 1 - int(active[-1])) / sample_rate
