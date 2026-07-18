from types import SimpleNamespace
from io import BytesIO

import numpy as np
import pytest
from scipy.io import wavfile

from meowdiobooks.backend.audio import (
    QWEN_GENERATION_ATTEMPTS,
    _generate_cloned_preview,
    _generate_preview,
    normalize_voice_sample,
)
from meowdiobooks.backend.tts_v2 import _synthesize


class RecordingModel:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def generate(self, text: str, **kwargs):
        self.calls.append({"text": text, **kwargs})
        return iter([SimpleNamespace(audio=np.array([0.1, -0.1], dtype=np.float32))])


def test_voice_design_primary_attempt_uses_qwen_checkpoint_defaults():
    model = RecordingModel()

    audio = _generate_preview(model, "Hello.", "A warm voice.", "english")

    np.testing.assert_array_equal(audio, np.array([0.1, -0.1], dtype=np.float32))
    assert model.calls == [
        {
            "text": "Hello.",
            "instruct": "A warm voice.",
            "lang_code": "english",
            "split_pattern": "",
            **QWEN_GENERATION_ATTEMPTS[0],
        }
    ]


def test_voice_clone_primary_attempt_uses_same_qwen_defaults(tmp_path):
    model = RecordingModel()
    reference = tmp_path / "voices" / "mara" / "voice-1.wav"
    reference.parent.mkdir(parents=True)
    reference.write_bytes(b"reference")

    audio = _synthesize(
        model,
        "We leave now.",
        {
            "id": "turn-1",
            "effectiveCharacterId": "mara",
            "referenceAudio": "voices/mara/voice-1.wav",
            "referenceText": "This is Mara's reference line.",
        },
        tmp_path,
        "english",
    )

    np.testing.assert_array_equal(audio, np.array([0.1, -0.1], dtype=np.float32))
    assert model.calls == [
        {
            "text": "We leave now.",
            "lang_code": "english",
            "split_pattern": "",
            "ref_audio": str(reference),
            "ref_text": "This is Mara's reference line.",
            **QWEN_GENERATION_ATTEMPTS[0],
        }
    ]


def test_voice_clone_can_use_transcript_free_speaker_embedding(tmp_path):
    model = RecordingModel()
    reference = tmp_path / "voices" / "mara" / "upload-1.wav"
    reference.parent.mkdir(parents=True)
    reference.write_bytes(b"reference")

    _synthesize(
        model,
        "We leave now.",
        {
            "id": "turn-1",
            "effectiveCharacterId": "mara",
            "referenceAudio": "voices/mara/upload-1.wav",
            "referenceMode": "speaker-embedding",
        },
        tmp_path,
        "english",
    )

    assert model.calls[0]["ref_audio"] == str(reference)
    assert "ref_text" not in model.calls[0]


def test_cloned_audition_speaks_preview_line_from_sample(tmp_path):
    model = RecordingModel()
    reference = tmp_path / "sample.wav"
    reference.write_bytes(b"reference")

    audio = _generate_cloned_preview(
        model,
        "This is Mara.",
        reference,
        "The original sample words.",
        "english",
    )

    np.testing.assert_array_equal(audio, np.array([0.1, -0.1], dtype=np.float32))
    assert model.calls == [
        {
            "text": "This is Mara.",
            "ref_audio": str(reference),
            "ref_text": "The original sample words.",
            "lang_code": "english",
            "split_pattern": "",
            **QWEN_GENERATION_ATTEMPTS[0],
        }
    ]


@pytest.mark.uses_audio_decoder
def test_uploaded_voice_sample_is_normalized_to_mono_24khz_wav():
    sample_rate = 16_000
    timeline = np.arange(sample_rate * 4, dtype=np.float32) / sample_rate
    stereo = np.stack(
        [0.25 * np.sin(2 * np.pi * 220 * timeline), 0.2 * np.sin(2 * np.pi * 330 * timeline)],
        axis=1,
    ).astype(np.float32)
    source = BytesIO()
    wavfile.write(source, sample_rate, stereo)

    normalized, duration = normalize_voice_sample(source.getvalue(), "sample.wav")

    rate, audio = wavfile.read(BytesIO(normalized))
    assert rate == 24_000
    assert audio.ndim == 1
    assert audio.dtype == np.float32
    assert duration == pytest.approx(4.0)


@pytest.mark.uses_audio_decoder
def test_uploaded_voice_sample_rejects_unsupported_format_and_silence():
    with pytest.raises(ValueError, match="WAV, MP3, or FLAC"):
        normalize_voice_sample(b"voice", "sample.m4a")

    source = BytesIO()
    wavfile.write(source, 24_000, np.zeros(24_000 * 4, dtype=np.float32))
    with pytest.raises(ValueError, match="silent"):
        normalize_voice_sample(source.getvalue(), "sample.wav")
