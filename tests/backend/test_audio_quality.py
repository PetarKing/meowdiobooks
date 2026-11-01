"""Deterministic synthetic signals; these tests do not claim perceptual certification."""
from types import SimpleNamespace

import numpy as np
import pytest

from meowdiobooks.backend.audio import _generate_preview
from meowdiobooks.backend.audio_quality import AudioQualityError, assess_audio, validate_audio
from meowdiobooks.backend.generation_checkpoint import GenerationCheckpoint
from meowdiobooks.backend.tts_v2 import _recovery_parts, _synthesize, _valid_chunks

RATE = 24_000
TEXT = "The traveler listened to the birds and walked quietly through the garden."


def speech(seconds=5):
    time = np.arange(int(seconds * RATE)) / RATE
    envelope = 0.3 * (0.15 + np.sin(2 * np.pi * 2.1 * time) ** 2)
    # Changing harmonics, syllable-like modulation and short fricatives.
    wave = envelope * (np.sin(2 * np.pi * (140 * time + 9 * np.sin(time)))
                       + 0.3 * np.sin(2 * np.pi * 430 * time))
    fricatives = ((time % 1.1) < 0.09) * np.random.default_rng(10).normal(0, 0.05, len(time))
    return (wave + fricatives).astype(np.float32)


@pytest.mark.parametrize("multiplier", [0.001, 0.2, 1.0, 2.0])
def test_modulated_voiced_speech_and_short_fricatives_pass(multiplier):
    assert assess_audio(speech() * multiplier, RATE, TEXT)["accepted"]


def test_short_noise_and_silence_between_speech_are_not_a_catastrophe():
    wave = np.concatenate([speech(2), np.random.default_rng(1).normal(0, 0.1, RATE),
                           np.zeros(RATE), speech(2)]).astype(np.float32)
    assert assess_audio(wave, RATE, TEXT)["accepted"]


@pytest.mark.parametrize("wave,reason", [
    (np.random.default_rng(3).normal(0, 0.1, RATE * 5), "sustained-broadband-noise"),
    (np.tile([1.0, -1.0], RATE * 2), "sustained-clipping"),
    (np.zeros(RATE), "silent"),
    (np.array([np.nan]), "empty-or-nonfinite"),
    (np.array([]), "empty-or-nonfinite"),
])
def test_obvious_failed_signals_reject(wave, reason):
    receipt = assess_audio(wave, RATE, TEXT)
    assert not receipt["accepted"]
    assert reason in receipt["reasons"]


def test_token_limit_even_with_short_waveform_and_duration_without_metadata():
    assert "generation-limit" in assess_audio(speech(1), RATE, TEXT, token_count=4096)["reasons"]
    # Low sample rate fixture exercises the precise duration, without a large allocation.
    wave = np.sin(np.arange(32768) * 0.07).astype(np.float32) * 0.1
    assert "generation-limit" in assess_audio(wave, 100, "x" * 1000)["reasons"]
    assert "excessive-duration" in assess_audio(wave[:3100], 100, "Yes.")["reasons"]


@pytest.mark.parametrize("text", ["漢" * 90, "A" * 90, "unhurried " * 20])
def test_text_duration_allowance_is_conservative_for_scripts_and_slow_delivery(text):
    assert assess_audio(speech(40), RATE, text)["accepted"]


def test_mixed_valid_and_invalid_results_never_publish_partial_source():
    chunks, summary = _valid_chunks([SimpleNamespace(audio=speech(1)),
                                     SimpleNamespace(audio=np.array([np.nan]))], text=TEXT)
    assert chunks == []
    assert summary.nonfinite == 1


def test_limit_metadata_is_retained_in_rejected_attempt():
    attempts = []
    with pytest.raises(AudioQualityError):
        _valid_chunks([SimpleNamespace(audio=speech(1), token_count=4096)], text=TEXT,
                      attempts=attempts, settings={"max_tokens": 4096, "temperature": 0.9})
    assert attempts[0]["scores"]["tokenCount"] == 4096
    assert attempts[0]["settings"]["temperature"] == 0.9
    assert TEXT not in str(attempts)


def model_for(outputs):
    class Model:
        sample_rate = RATE
        calls = []

        def generate(self, text, **kwargs):
            self.calls.append((text, kwargs))
            return iter([next(outputs)])
    return Model()


def setup_reference(tmp_path):
    (tmp_path / "voice.wav").write_bytes(b"synthetic reference")
    return {"id": "synthetic", "referenceAudio": "voice.wav", "referenceText": "Reference text."}


def test_quality_retry_saves_only_clean_audio_and_attempt_evidence(tmp_path):
    good = speech(2)
    model = model_for(iter([SimpleNamespace(audio=good, token_count=4096),
                           SimpleNamespace(audio=good, token_count=25)]))
    checkpoint = GenerationCheckpoint(tmp_path / "checkpoints", "a" * 64, 1, RATE)
    actual = _synthesize(model, TEXT, setup_reference(tmp_path), tmp_path, "english",
                         checkpoint=checkpoint, section_prefix="unit")
    np.testing.assert_array_equal(actual, good)
    assert len(model.calls) == 2
    import json
    payload = json.loads((checkpoint.path / "unit-00001.json").read_text())
    assert payload["quality"]["accepted"]
    assert [row["accepted"] for row in payload["quality"]["attempts"]] == [False, True]


def test_valid_hash_poisoned_legacy_cache_regenerates_only_that_section(tmp_path):
    good = speech(2)
    model = model_for(iter([SimpleNamespace(audio=good)]))
    checkpoint = GenerationCheckpoint(tmp_path / "checkpoints", "b" * 64, 2, RATE)
    checkpoint.write("unit-00001", np.random.default_rng(4).normal(0, 0.1, RATE * 4).astype(np.float32), [])
    _synthesize(model, TEXT, setup_reference(tmp_path), tmp_path, "english",
                checkpoint=checkpoint, section_prefix="unit")
    assert len(model.calls) == 1
    assert checkpoint.restored == 0
    _synthesize(model, TEXT, setup_reference(tmp_path), tmp_path, "english",
                checkpoint=checkpoint, section_prefix="unit")
    assert len(model.calls) == 1
    assert checkpoint.restored == 1


def test_exhaustion_does_not_write_checkpoint(tmp_path):
    bad = SimpleNamespace(audio=speech(1), token_count=4096)
    model = model_for(iter([bad] * 3))
    checkpoint = GenerationCheckpoint(tmp_path / "checkpoints", "c" * 64, 1, RATE)
    with pytest.raises(RuntimeError, match="generation-limit"):
        _synthesize(model, TEXT, setup_reference(tmp_path), tmp_path, "english",
                    checkpoint=checkpoint, section_prefix="unit")
    assert len(model.calls) == 3
    assert not list(checkpoint.path.glob("*.wav"))


def test_long_quality_failure_splits_with_exact_voice_and_text(tmp_path):
    text = "The traveler looked around the quiet garden, " * 8 + "and returned home."
    parts = _recovery_parts(text)
    bad = SimpleNamespace(audio=speech(1), token_count=4096)
    good = SimpleNamespace(audio=speech(1), token_count=12)
    model = model_for(iter([bad] * 2 + [good] * len(parts)))
    recoveries = []
    _synthesize(model, text, setup_reference(tmp_path), tmp_path, "english", recoveries=recoveries)
    assert [call[0] for call in model.calls[:2]] == [text] * 2
    assert " ".join(call[0] for call in model.calls[2:]) == text
    assert all(call[1]["ref_text"] == "Reference text." for call in model.calls)
    assert recoveries[-1]["reason"] == "quality-rejected-long-unit"


def test_failed_split_cannot_publish_a_partial_unit(tmp_path):
    text = "A long ordinary clause with all its original words, " * 7
    bad = SimpleNamespace(audio=speech(1), token_count=4096)
    model = model_for(iter([bad] * 2 + [SimpleNamespace(audio=speech(1))] + [bad]))
    checkpoint = GenerationCheckpoint(tmp_path / "checkpoints", "d" * 64, 1, RATE)
    with pytest.raises(RuntimeError):
        _synthesize(model, text, setup_reference(tmp_path), tmp_path, "english", checkpoint=checkpoint)
    assert len(model.calls) == 4
    assert not list(checkpoint.path.glob("*.wav"))


def test_unsplittable_or_extremely_long_input_has_no_unbounded_fallback():
    assert _recovery_parts("漢" * 400) == []
    assert _recovery_parts("word " * 1000) == []


def test_auditions_share_limit_rejection_and_retry():
    good = speech(2)
    model = model_for(iter([SimpleNamespace(audio=good, token_count=4096), SimpleNamespace(audio=good)]))
    np.testing.assert_array_equal(_generate_preview(model, TEXT, "Warm voice"), good)
    assert len(model.calls) == 2


def test_quality_receipt_has_no_source_text():
    receipt = validate_audio(speech(2), RATE, TEXT)
    assert TEXT not in str(receipt)


def test_duration_backstop_only_applies_without_tokens_and_at_actual_cap():
    wave = (0.1 * np.sin(np.arange(32768) * 0.07)).astype(np.float32)
    # One token below the cap is a legitimate EOS; no whole-token early rejection.
    assert assess_audio(wave[:32760], 100, "x" * 1000)["accepted"]
    assert assess_audio(wave, 100, "x" * 1000, token_count=4095)["accepted"]
    assert "generation-limit" in assess_audio(wave, 100, "x" * 1000)["reasons"]


def test_long_split_aggregate_and_cache_validate_actual_inference_boundaries(tmp_path):
    text = ("A traveler walks quietly through the garden " * 16).strip()
    parts = _recovery_parts(text)
    assert len(parts) == 4
    chunk = (0.1 * np.sin(np.arange(10050) * 0.07)).astype(np.float32)
    bad = SimpleNamespace(audio=chunk[:100], token_count=4096)
    model = model_for(iter([bad] * 2 + [SimpleNamespace(audio=chunk, token_count=1256)] * 4))
    model.sample_rate = 100
    checkpoint = GenerationCheckpoint(tmp_path / "checkpoints", "e" * 64, 1, 100)
    segment = setup_reference(tmp_path)
    actual = _synthesize(model, text, segment, tmp_path, "english", checkpoint=checkpoint,
                         section_prefix="long")
    assert len(actual) / 100 == 402
    assert len(model.calls) == 6
    for _ in range(2):
        restored = _synthesize(model, text, segment, tmp_path, "english", checkpoint=checkpoint,
                               section_prefix="long")
        np.testing.assert_array_equal(restored, actual)
        assert len(model.calls) == 6
    import json
    quality = json.loads((checkpoint.path / "long-00001.json").read_text())["quality"]
    assert len(quality["calls"]) == 4
    assert sum(call["samples"] for call in quality["calls"]) == len(actual)
    assert len(quality["attempts"]) == 6


@pytest.mark.parametrize("evidence", [None, [], [{"samples": 32768}]])
def test_cache_recovery_label_and_malformed_boundaries_cannot_bypass_cap(tmp_path, evidence):
    text = ("A traveler walks quietly through the garden " * 16).strip()
    wave = (0.1 * np.sin(np.arange(32768) * 0.07)).astype(np.float32)
    model = model_for(iter([SimpleNamespace(audio=wave[:1000])]))
    model.sample_rate = 100
    checkpoint = GenerationCheckpoint(tmp_path / "checkpoints", "f" * 64, 1, 100)
    checkpoint.write("long-00001", wave, [{"reason": "quality-rejected-long-unit", "partCount": 4}],
                     quality={"accepted": True, **({"calls": evidence} if evidence is not None else {})})
    actual = _synthesize(model, text, setup_reference(tmp_path), tmp_path, "english",
                         checkpoint=checkpoint, section_prefix="long")
    assert len(model.calls) == 1
    assert len(actual) == 1000


def test_known_eos_token_count_survives_unit_validation_and_cache(tmp_path):
    wave = (0.1 * np.sin(np.arange(32768) * 0.07)).astype(np.float32)
    text = "x" * 1000
    model = model_for(iter([SimpleNamespace(audio=wave, token_count=4095)]))
    model.sample_rate = 100
    checkpoint = GenerationCheckpoint(tmp_path / "checkpoints", "9" * 64, 1, 100)
    segment = setup_reference(tmp_path)
    for _ in range(2):
        actual = _synthesize(model, text, segment, tmp_path, "english",
                             checkpoint=checkpoint, section_prefix="eos")
        np.testing.assert_array_equal(actual, wave)
    assert len(model.calls) == 1


def short_silence():
    # A one-token model result can be finite and nonzero but contain no speech.
    return np.full(int(RATE * 0.08), 1.2e-5, dtype=np.float32)


def test_timed_quality_rejects_short_silence_without_changing_legacy_policy():
    from meowdiobooks.backend.pacing import timing_policy
    wave = short_silence()
    assert assess_audio(wave, RATE, "Then ring.")["accepted"]
    receipt = assess_audio(wave, RATE, "Then ring.", timing=timing_policy())
    assert receipt["reasons"] == ["silent-for-timing"]


def test_timed_quality_checks_after_fades_and_does_not_hide_invalid_policy():
    from meowdiobooks.backend.pacing import timing_policy
    # Both samples are initially audible, but both become fade endpoints.
    receipt = assess_audio(np.full(2, 0.1), RATE, "Yes", timing=timing_policy())
    assert "silent-for-timing" in receipt["reasons"]
    with pytest.raises(ValueError, match="finite nonnegative"):
        assess_audio(speech(), RATE, TEXT, timing={**timing_policy(), "fadeInSeconds": -1})


def test_timed_quality_preserves_audible_quiet_samples(tmp_path):
    from meowdiobooks.backend.pacing import timing_policy
    good = speech() * 0.001
    model = model_for(iter([SimpleNamespace(audio=good)]))
    actual = _synthesize(model, TEXT, setup_reference(tmp_path), tmp_path, "english",
                         timing=timing_policy())
    np.testing.assert_array_equal(actual, good)
    assert len(model.calls) == 1


def test_short_silence_retries_before_writing_checkpoint(tmp_path):
    import json
    from meowdiobooks.backend.pacing import timing_policy
    good = speech(0.5)
    model = model_for(iter([SimpleNamespace(audio=short_silence(), token_count=1),
                           SimpleNamespace(audio=good, token_count=7)]))
    checkpoint = GenerationCheckpoint(tmp_path / "checkpoints", "a" * 64, 1, RATE)
    actual = _synthesize(model, "Then ring.", setup_reference(tmp_path), tmp_path, "english",
                         checkpoint=checkpoint, section_prefix="short", timing=timing_policy())
    np.testing.assert_array_equal(actual, good)
    assert len(model.calls) == 2
    receipt = json.loads((checkpoint.path / "short-00001.json").read_text())["quality"]
    assert [row["accepted"] for row in receipt["attempts"]] == [False, True]
    assert receipt["attempts"][0]["reasons"] == ["silent-for-timing"]


def test_silent_checkpoint_regenerates_only_rejected_section(tmp_path):
    from meowdiobooks.backend.pacing import timing_policy
    good = speech(0.5)
    model = model_for(iter([SimpleNamespace(audio=good)]))
    checkpoint = GenerationCheckpoint(tmp_path / "checkpoints", "a" * 64, 2, RATE)
    checkpoint.write("bad-00001", short_silence(), [], quality={"accepted": True})
    checkpoint.write("good-00001", good, [])
    healthy_bytes = (checkpoint.path / "good-00001.wav").read_bytes()
    segment = setup_reference(tmp_path)
    for prefix in ("good", "bad"):
        actual = _synthesize(model, "Then ring.", segment, tmp_path, "english",
                             checkpoint=checkpoint, section_prefix=prefix, timing=timing_policy())
        np.testing.assert_array_equal(actual, good)
    assert len(model.calls) == 1
    assert checkpoint.restored == 1
    assert (checkpoint.path / "good-00001.wav").read_bytes() == healthy_bytes


def test_short_silent_fragment_recovers_with_same_voice_and_source(tmp_path):
    from meowdiobooks.backend.pacing import timing_policy
    good = speech(0.5)
    model = model_for(iter([SimpleNamespace(audio=short_silence())] * 3
                          + [SimpleNamespace(audio=good)]))
    segment = setup_reference(tmp_path)
    recoveries = []
    actual = _synthesize(model, "Then ring", segment, tmp_path, "english",
                         timing=timing_policy(), recoveries=recoveries)
    np.testing.assert_array_equal(actual, good)
    assert len(model.calls) == 4
    assert all(text == "Then ring" for text, _ in model.calls)
    assert all(kwargs["lang_code"] == "english" for _, kwargs in model.calls)
    assert len({kwargs["ref_audio"] for _, kwargs in model.calls}) == 1
    assert all("ref_text" in kwargs for _, kwargs in model.calls[:3])
    assert "ref_text" not in model.calls[3][1]
    assert recoveries[0]["reason"] == "silent-after-transcript-conditioning"
    assert recoveries[0]["initialAttempts"] == 3
    assert recoveries[0]["recoveryAttempts"] == 1


@pytest.mark.parametrize("text,count", [("Then ring", 6), (TEXT, 3)])
def test_silent_retry_exhaustion_is_bounded_and_never_checkpointed(tmp_path, text, count):
    from meowdiobooks.backend.pacing import timing_policy
    model = model_for(iter([SimpleNamespace(audio=short_silence())] * count))
    checkpoint = GenerationCheckpoint(tmp_path / "checkpoints", "a" * 64, 1, RATE)
    with pytest.raises(RuntimeError, match="silent-for-timing"):
        _synthesize(model, text, setup_reference(tmp_path), tmp_path, "english",
                    checkpoint=checkpoint, timing=timing_policy())
    assert len(model.calls) == count
    assert not list(checkpoint.path.glob("*.wav"))


def test_short_quality_failures_do_not_expand_reference_fallback(tmp_path):
    from meowdiobooks.backend.pacing import timing_policy
    # Even when silent, a token-cap failure cannot qualify for short-speech recovery.
    bad = SimpleNamespace(audio=short_silence(), token_count=4096)
    model = model_for(iter([bad] * 3))
    with pytest.raises(RuntimeError, match="generation-limit"):
        _synthesize(model, "Then ring", setup_reference(tmp_path), tmp_path, "english",
                    timing=timing_policy())
    assert len(model.calls) == 3
    assert all("ref_text" in kwargs for _, kwargs in model.calls)
