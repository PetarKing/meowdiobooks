import pytest

from meowdiobooks.backend.languages import (
    AUDITION_TEMPLATES,
    LANGUAGE_ALIASES,
    audition_line,
    infer_language,
    normalize_language,
    representative_language_sample,
    supported_voice_languages,
)


def test_voice_language_support_comes_from_selected_model_config(tmp_path):
    (tmp_path / "models.toml").write_text(
        """
schema_version = 1
[defaults]
text = "text"
voice = "qwen-voice-design-1.7b"
[text_models.text]
label = "Text"
engine = "llama_cpp"
runtime_path = "llama-server"
model_path = "model.gguf"
context_size = 1024
gpu_layers = 1
source = "example/text"
revision = "one"
[voice_pipelines."qwen-voice-design-1.7b"]
label = "Qwen"
engine = "mlx_audio"
audition_path = "audition"
renderer_path = "renderer"
audition_source = "example/audition"
audition_revision = "one"
renderer_source = "example/renderer"
renderer_revision = "one"
languages = ["english", "french"]
""".strip(),
        encoding="utf-8",
    )
    assert supported_voice_languages(tmp_path, "qwen-voice-design-1.7b") == {"english", "french"}


def test_language_normalization_and_sample_are_deterministic():
    assert normalize_language("FR") == "french"
    assert normalize_language("Dutch") == ""
    pages = [{"text": str(index)} for index in range(5)]
    assert representative_language_sample(pages) == "0\n\n2\n\n4"
    assert infer_language([{"text": "This is plainly an English novel."}]) == "english"
    assert infer_language([{"text": "这是一本中文小说，里面有很多人物和对话。"}]) == "chinese"


def test_every_known_voice_language_has_a_native_audition_template():
    assert set(AUDITION_TEMPLATES) == set(LANGUAGE_ALIASES.values())
    assert audition_line("Mara", "zh").startswith("这是Mara的声音。")
    assert audition_line("Mara", "pt").startswith("Esta é a voz de Mara.")


def test_unknown_audition_language_is_rejected_instead_of_speaking_english():
    with pytest.raises(ValueError, match="Unsupported audition language"):
        audition_line("Mara", "klingon")
