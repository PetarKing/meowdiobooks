from pathlib import Path

import pytest

from meowdiobooks.backend.model_config import (
    ModelConfigError,
    asset_path,
    dialogue_routing_preview,
    load_model_registry,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_dialogue_duration_hint_accounts_for_two_passes_workers_and_conflict_headroom(tmp_path):
    text = (REPO_ROOT / "models.toml").read_text()
    text = text.replace('max_concurrent_batches = 8', 'max_concurrent_batches = 16\nestimated_seconds_per_batch = 6')
    (tmp_path / 'models.toml').write_text(text)
    routing = dialogue_routing_preview(tmp_path, 5955)
    assert routing['remote']['estimatedDurationSeconds'] == round(2 * 745 * 6 / 16 * 1.25)


@pytest.mark.parametrize('value', ['0', '-1', 'nan', 'inf'])
def test_dialogue_duration_hint_rejects_unusable_calibration(tmp_path, value):
    text = (REPO_ROOT / "models.toml").read_text()
    (tmp_path / 'models.toml').write_text(text.replace(
        'max_concurrent_batches = 8', f'max_concurrent_batches = 8\nestimated_seconds_per_batch = {value}'))
    with pytest.raises(ModelConfigError):
        load_model_registry(tmp_path)


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
    assert remote.input_usd_per_million_tokens == 0.2
    assert remote.cached_input_usd_per_million_tokens == 0.02
    assert remote.cache_write_input_usd_per_million_tokens == 0.25
    assert remote.output_usd_per_million_tokens == 1.0
    assert remote.model == "gpt-6-luna"
    assert remote.service_tier == "fast"
    assert remote.reasoning_effort == "low"
    assert remote.policy == "dual-pass-with-tools-v1"
    assert remote.max_targets_per_batch == 8
    assert remote.max_concurrent_batches == 8
    assert remote.estimated_usd_per_target == 0.00085
    assert voice.audition_path == "models/qwen_1_7b_voice_design"
    assert voice.renderer_path == "models/qwen_1_7b_base_8bit"
    assert voice.recipe_version == "2"
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
        "estimatedCostUsd": 0.80,
        "falseNamesReductionPercent": None,
        "speakerRecallImprovementPercent": None,
    }


def test_legacy_remote_profile_remains_loadable_without_new_pricing_fields(tmp_path):
    source = (REPO_ROOT / "models.toml").read_text()
    source = "\n".join(line for line in source.splitlines() if not line.startswith((
        "service_tier", "default_service_tier_price_multiplier", "long_context_"
    )))
    (tmp_path / "models.toml").write_text(source)
    remote = load_model_registry(tmp_path).remote_dialogue_model()
    assert remote.service_tier is None
    assert remote.long_context_input_token_threshold is None
    assert remote.default_service_tier_price_multiplier == 1


def test_partial_long_context_pricing_is_rejected(tmp_path):
    source = (REPO_ROOT / "models.toml").read_text()
    (tmp_path / "models.toml").write_text(source.replace(
        "long_context_output_usd_per_million_tokens = 1.5", ""
    ))
    with pytest.raises(ModelConfigError, match="Long-context pricing requires"):
        load_model_registry(tmp_path)


def test_unknown_requested_service_tier_is_rejected(tmp_path):
    source = (REPO_ROOT / "models.toml").read_text()
    (tmp_path / "models.toml").write_text(source.replace('service_tier = "fast"', 'service_tier = "typo"'))
    with pytest.raises(ModelConfigError, match="Unsupported service_tier"):
        load_model_registry(tmp_path)


def test_explicit_catalog_path_honors_alternate_filename_without_changing_default(tmp_path):
    source = (REPO_ROOT / "models.toml").read_text()
    (tmp_path / "models.toml").write_text(source)
    alternate = tmp_path / "custom-prices.toml"
    alternate.write_text(source.replace(
        "output_usd_per_million_tokens = 1.0", "output_usd_per_million_tokens = 10.0"
    ))
    assert load_model_registry(tmp_path).remote_dialogue_model().output_usd_per_million_tokens == 1.0
    assert load_model_registry(tmp_path, models_path=alternate).remote_dialogue_model().output_usd_per_million_tokens == 10.0


def test_explicit_missing_catalog_does_not_silently_use_default():
    with pytest.raises(ModelConfigError, match="Cannot read"):
        load_model_registry(REPO_ROOT, models_path=REPO_ROOT / "missing-registry.toml")
