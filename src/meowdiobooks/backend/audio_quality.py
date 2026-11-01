"""Cheap, conservative rejection of catastrophic native speech failures.

These signals do not certify intelligibility. In particular, ordinary tonal speech,
fricatives, quiet delivery and a single loud transient must not trigger rejection.
No inference, source text, or provider credentials are retained in receipts.
"""
from __future__ import annotations

from typing import Any, Mapping

import numpy as np

from .pacing import SpeechSilenceError, prepare_speech_audio

QUALITY_CONTRACT = "meowdiobooks.audio-quality.v1"
QWEN_AUDIO_TOKENS_PER_SECOND = 12.5


class AudioQualityError(ValueError):
    def __init__(self, receipt: dict[str, Any]):
        self.receipt = receipt
        super().__init__("Audio quality rejected: " + ", ".join(receipt["reasons"]))


def assess_audio(
    audio: np.ndarray, sample_rate: int, text: str, *,
    token_count: int | None = None, max_tokens: int = 4096,
    check_generation_limit: bool = True,
    timing: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return bounded numeric evidence, using 100 ms windows at native sample rate.

    Duration allowance is intentionally loose (one second per alphanumeric
    character plus 15 seconds), including unspaced languages and slow delivery.
    Cap duration is specific to the Qwen native adapter, not a generic TTS limit.
    Broadband noise needs high flatness AND high zero crossing AND sustained,
    nearly stationary energy for three seconds; flatness alone is insufficient.
    """
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    if sample_rate <= 0:
        raise ValueError("Audio sample rate must be positive")
    seconds = len(samples) / sample_rate
    reasons: list[str] = []
    scores: dict[str, Any] = {"durationSeconds": seconds,
                              "textDurationLimitSeconds": max(30, 15 + sum(c.isalnum() for c in text)),
                              "tokenCount": token_count, "maxTokens": max_tokens}
    if not samples.size or not np.isfinite(samples).all():
        reasons.append("empty-or-nonfinite")
    else:
        # Timed assembly must be possible before a section becomes resumable. Keep
        # legacy/preview amplitude policy unchanged, and never alter the samples.
        if timing is not None:
            try:
                prepare_speech_audio(samples, sample_rate, timing)
            except SpeechSilenceError:
                reasons.append("silent-for-timing")
        # Backstop also works for old checkpoint WAVs whose backend metadata was lost.
        if check_generation_limit and (
            (token_count is not None and token_count >= max_tokens)
            or (token_count is None
                and seconds >= max_tokens / QWEN_AUDIO_TOKENS_PER_SECOND - 0.5 / sample_rate)
        ):
            reasons.append("generation-limit")
        if seconds > scores["textDurationLimitSeconds"]:
            reasons.append("excessive-duration")
        width = max(16, int(sample_rate * 0.1))
        frame_count = len(samples) // width
        scores.update({"noiseRunSeconds": 0.0, "clippedRunSeconds": 0.0})
        if frame_count:
            frames = samples[:frame_count * width].reshape(frame_count, width).astype(np.float64)
            rms = np.sqrt(np.mean(frames * frames, axis=1))
            if seconds >= 0.5 and float(np.max(rms)) < 1e-5:
                reasons.append("silent")
            clipped = np.mean(np.abs(frames) >= 0.999, axis=1) > 0.25
            scores["clippedRunSeconds"] = _longest_run(clipped) * 0.1
            if scores["clippedRunSeconds"] >= 3:
                reasons.append("sustained-clipping")
            # Work in bounded batches: long cap-length units need no large FFT allocation.
            flatness = np.empty(frame_count)
            zcr = np.mean(frames[:, 1:] * frames[:, :-1] < 0, axis=1)
            window = np.hanning(width)
            for start in range(0, frame_count, 256):
                power = np.abs(np.fft.rfft(frames[start:start + 256] * window, axis=1)) ** 2
                power = power[:, 1:] + 1e-18
                flatness[start:start + 256] = np.exp(np.mean(np.log(power), axis=1)) / np.mean(power, axis=1)
            noise = (flatness > 0.35) & (zcr > 0.28) & (rms > 0.01)
            stationary_noise = np.zeros(frame_count, dtype=bool)
            # Require a whole 3-second window with little energy modulation.
            for end in range(30, frame_count + 1):
                local = rms[end - 30:end]
                if np.all(noise[end - 30:end]) and np.std(local) / np.mean(local) < 0.18:
                    stationary_noise[end - 30:end] = True
            scores["noiseRunSeconds"] = _longest_run(stationary_noise) * 0.1
            scores["maxSpectralFlatness"] = float(np.max(flatness))
            if scores["noiseRunSeconds"] >= 3:
                reasons.append("sustained-broadband-noise")
    return {"contract": QUALITY_CONTRACT, "accepted": not reasons,
            "reasons": reasons, "scores": scores}


def validate_audio(audio: np.ndarray, sample_rate: int, text: str, **kwargs: Any) -> dict[str, Any]:
    receipt = assess_audio(audio, sample_rate, text, **kwargs)
    if not receipt["accepted"]:
        raise AudioQualityError(receipt)
    return receipt


def _longest_run(values: np.ndarray) -> int:
    edges = np.flatnonzero(np.diff(np.concatenate(([False], values, [False])).astype(np.int8)))
    return int(np.max(edges[1::2] - edges[::2])) if len(edges) else 0
