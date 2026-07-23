from pathlib import Path

import pytest

from meowdiobooks.backend.model_config import (
    ModelConfigError,
    asset_path,
    dialogue_routing_preview,
    load_model_registry,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_default_registry_preserves_current_models_and_all_supported_languages():
    registry = load_model_registry(REPO_ROOT)

    text = registry.active_text_model()
    remote = registry.remote_dialogue_model()
    voice = registry.voice_pipeline()
    speech = registry.transcription_model()
    assert text.runtime_path == ".local/llama.cpp/b9637/llama-server"
    assert text.model_path == ".local/models/qwen35-9b/Qwen_Qwen3.5-9B-Q4_K_M.gguf"
    assert remote is not None
    assert remote.engine == "openai_responses"
    assert remote.input_usd_per_million_tokens == 1.0
    assert remote.cached_input_usd_per_million_tokens == 0.1
    assert remote.output_usd_per_million_tokens == 6.0
    assert remote.max_targets_per_batch == 6
    assert remote.max_concurrent_batches == 6
    assert voice.audition_path == "models/qwen_1_7b_voice_design"
    assert voice.renderer_path == "models/qwen_1_7b_base_4bit"
    assert voice.recipe_version == "1"
    assert registry.voice_candidate_policy.enabled is True
    assert registry.voice_candidate_policy.coverage_fraction == 0.8
    assert registry.voice_candidate_policy.min_voices == 2
    assert registry.voice_candidate_policy.max_voices == 4
    assert registry.voice_candidate_policy.extra_candidates == 1
    assert speech.engine == "mlx_audio"
    assert speech.model_path == "models/qwen3_asr_0_6b_4bit"
    assert speech.revision == "313d850181767edf09f00a9c289becca70e58cd0"
    assert set(voice.languages) == {
        "chinese",
        "english",
        "french",
        "german",
        "italian",
        "japanese",
        "korean",
        "portuguese",
        "russian",
        "spanish",
    }


def test_asset_paths_may_be_repository_relative_home_relative_or_absolute(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    assert asset_path(tmp_path, "models/example") == tmp_path / "models/example"
    assert asset_path(tmp_path, "~/models/example") == tmp_path / "home/models/example"
    assert asset_path(tmp_path, "/opt/models/example") == Path("/opt/models/example")


def test_unknown_model_engine_is_rejected_before_runtime(tmp_path):
    source = (REPO_ROOT / "models.toml").read_text(encoding="utf-8")
    (tmp_path / "models.toml").write_text(
        source.replace('engine = "llama_cpp"', 'engine = "anything"', 1),
        encoding="utf-8",
    )

    with pytest.raises(ModelConfigError, match="Unsupported text engine"):
        load_model_registry(tmp_path)


def test_dialogue_routing_preview_uses_model_display_cost_and_benchmark_config(tmp_path):
    (tmp_path / "models.toml").write_text(
        (REPO_ROOT / "models.toml").read_text(encoding="utf-8"), encoding="utf-8"
    )

    routing = dialogue_routing_preview(tmp_path, 938)

    assert routing["shouldPrompt"] is True
    assert routing["local"] == {"displayName": "Qwen", "apiCostUsd": 0.0}
    assert routing["remote"] == {
        "displayName": "Luna",
        "domain": "api.openai.com",
        "credentialConfigured": False,
        "apiKeyEnvironmentVariable": "OPENAI_API_KEY",
        "estimatedCostUsd": 0.68,
        "falseNamesReductionPercent": 85,
        "speakerRecallImprovementPercent": 272,
    }
