from pathlib import Path
from types import SimpleNamespace

import pytest

from meowdiobooks.backend.transcription import _draft_from_model


class FakeModel:
    def __init__(self, text: str = "  Ciao   mondo. ", language="Italian"):
        self.text = text
        self.language = language
        self.request = None

    def generate(self, audio: str, **kwargs):
        self.request = {"audio": audio, **kwargs}
        return SimpleNamespace(text=self.text, language=self.language)


def test_voice_sample_transcription_auto_detects_language_and_normalizes_text(tmp_path):
    model = FakeModel()
    audio = tmp_path / "sample.wav"

    draft = _draft_from_model(model, audio)

    assert draft.text == "Ciao mondo."
    assert draft.language == "Italian"
    assert model.request == {
        "audio": str(audio),
        "language": None,
        "temperature": 0.0,
        "max_tokens": 512,
        "chunk_duration": 30.0,
    }


def test_voice_sample_transcription_rejects_an_empty_draft():
    with pytest.raises(ValueError, match="No speech"):
        _draft_from_model(FakeModel(text="   ", language=""), Path("sample.wav"))


def test_voice_sample_transcription_flattens_segment_language_lists():
    draft = _draft_from_model(FakeModel(language=["English", "English"]), Path("sample.wav"))

    assert draft.language == "English"
