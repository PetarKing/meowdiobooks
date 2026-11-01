"""Validated model registry for local text and voice inference."""

from __future__ import annotations

import math
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from meowdiobooks.assets import model_registry_path

from .voice_candidates import VoiceCandidatePolicy


class ModelConfigError(ValueError):
    """Raised when ``models.toml`` cannot provide a safe runtime contract."""


@dataclass(frozen=True)
class TextModelConfig:
    id: str
    label: str
    display_name: str
    engine: str
    runtime_path: str
    model_path: str
    context_size: int
    gpu_layers: int
    source: str
    revision: str
    dialogue_benchmark: DialogueBenchmark | None


@dataclass(frozen=True)
class DialogueBenchmark:
    sample_size: int
    false_character_rate: float
    speaker_recall: float
    policy: str


@dataclass(frozen=True)
class RemoteTextModelConfig:
    id: str
    display_name: str
    engine: str
    base_url: str
    api_key_env: str
    model: str
    pricing_version: str
    reasoning_effort: str | None
    policy: str
    input_usd_per_million_tokens: float
    cached_input_usd_per_million_tokens: float
    cache_write_input_usd_per_million_tokens: float
    output_usd_per_million_tokens: float
    max_targets_per_batch: int
    max_concurrent_batches: int
    estimated_usd_per_target: float
    dialogue_benchmark: DialogueBenchmark | None

    service_tier: str | None = None
    default_service_tier_price_multiplier: float = 1.0
    long_context_input_token_threshold: int | None = None
    long_context_input_usd_per_million_tokens: float | None = None
    long_context_cached_input_usd_per_million_tokens: float | None = None
    long_context_cache_write_input_usd_per_million_tokens: float | None = None
    long_context_output_usd_per_million_tokens: float | None = None
    estimated_seconds_per_batch: float | None = None

    @property
    def domain(self) -> str:
        return urlparse(self.base_url).hostname or self.base_url


@dataclass(frozen=True)
class DialogueAttributionConfig:
    default_route: str
    large_review_threshold: int
    local_policy: str
    remote_profile: str | None
    adjudication_remote_profile: str | None = None


@dataclass(frozen=True)
class VoicePipelineConfig:
    id: str
    label: str
    engine: str
    audition_path: str
    renderer_path: str
    audition_source: str
    audition_revision: str
    renderer_source: str
    renderer_revision: str
    recipe_version: str
    languages: tuple[str, ...]


@dataclass(frozen=True)
class SpeechModelConfig:
    id: str
    label: str
    engine: str
    model_path: str
    source: str
    revision: str


@dataclass(frozen=True)
class ModelRegistry:
    default_text_id: str
    default_voice_id: str
    default_transcription_id: str | None
    text_models: dict[str, TextModelConfig]
    voice_pipelines: dict[str, VoicePipelineConfig]
    speech_models: dict[str, SpeechModelConfig]
    remote_text_models: dict[str, RemoteTextModelConfig]
    dialogue_attribution: DialogueAttributionConfig
    voice_candidate_policy: VoiceCandidatePolicy

    def active_text_model(self) -> TextModelConfig:
        return self.text_models[self.default_text_id]

    def voice_pipeline(self, model_id: str | None = None) -> VoicePipelineConfig:
        selected = model_id or self.default_voice_id
        try:
            return self.voice_pipelines[selected]
        except KeyError as error:
            raise ModelConfigError(f"Unknown voice model: {selected}") from error

    def transcription_model(self, model_id: str | None = None) -> SpeechModelConfig:
        selected = model_id or self.default_transcription_id
        if selected is None:
            raise ModelConfigError("No transcription model is configured")
        try:
            return self.speech_models[selected]
        except KeyError as error:
            raise ModelConfigError(f"Unknown transcription model: {selected}") from error

    def remote_dialogue_model(self) -> RemoteTextModelConfig | None:
        selected = self.dialogue_attribution.remote_profile
        if selected is None:
            return None
        try:
            return self.remote_text_models[selected]
        except KeyError as error:
            raise ModelConfigError(f"Unknown remote Dialogue model: {selected}") from error


    def remote_dialogue_adjudication_model(self) -> RemoteTextModelConfig | None:
        """Optional conflict-only profile; omission preserves the primary model."""
        selected = self.dialogue_attribution.adjudication_remote_profile
        if selected is None:
            return None
        try:
            return self.remote_text_models[selected]
        except KeyError as error:
            raise ModelConfigError(f"Unknown remote Dialogue adjudication model: {selected}") from error


def load_model_registry(repo_root: Path, *, models_path: Path | None = None) -> ModelRegistry:
    """Load an explicit registry file, local override, or packaged model contract.

    Compositions may pass a custom catalog filename without changing process environment
    or copying files. An explicit missing file fails rather than falling back silently.
    """

    path = Path(models_path) if models_path is not None else model_registry_path(repo_root)
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ModelConfigError(f"Cannot read {path}: {error}") from error
    except tomllib.TOMLDecodeError as error:
        raise ModelConfigError(f"Invalid {path}: {error}") from error
    if raw.get("schema_version") != 1:
        raise ModelConfigError("models.toml must use schema_version = 1")

    defaults = _table(raw, "defaults")
    text_models = {
        model_id: _text_model(model_id, value)
        for model_id, value in _table(raw, "text_models").items()
    }
    voice_pipelines = {
        model_id: _voice_pipeline(model_id, value)
        for model_id, value in _table(raw, "voice_pipelines").items()
    }
    speech_models = {
        model_id: _speech_model(model_id, value)
        for model_id, value in _optional_table(raw, "speech_models").items()
    }
    remote_text_models = {
        model_id: _remote_text_model(model_id, value)
        for model_id, value in _optional_table(raw, "remote_text_models").items()
    }
    dialogue_attribution = _dialogue_attribution(raw.get("dialogue_attribution"))
    try:
        voice_candidate_policy = VoiceCandidatePolicy.from_mapping(
            _optional_table(raw, "voice_candidates")
        )
    except ValueError as error:
        raise ModelConfigError(str(error)) from error
    default_text = _string(defaults, "text")
    default_voice = _string(defaults, "voice")
    default_transcription = _optional_string(defaults, "transcription")
    if default_text not in text_models:
        raise ModelConfigError(f"Default text model is not registered: {default_text}")
    if default_voice not in voice_pipelines:
        raise ModelConfigError(f"Default voice model is not registered: {default_voice}")
    if default_transcription is not None and default_transcription not in speech_models:
        raise ModelConfigError(
            f"Default transcription model is not registered: {default_transcription}"
        )
    if (
        dialogue_attribution.remote_profile is not None
        and dialogue_attribution.remote_profile not in remote_text_models
    ):
        raise ModelConfigError(
            f"Dialogue remote_profile is not registered: {dialogue_attribution.remote_profile}"
        )
    if (
        dialogue_attribution.adjudication_remote_profile is not None
        and dialogue_attribution.adjudication_remote_profile not in remote_text_models
    ):
        raise ModelConfigError(
            "Dialogue adjudication_remote_profile is not registered: "
            f"{dialogue_attribution.adjudication_remote_profile}"
        )
    return ModelRegistry(
        default_text,
        default_voice,
        default_transcription,
        text_models,
        voice_pipelines,
        speech_models,
        remote_text_models,
        dialogue_attribution,
        voice_candidate_policy,
    )


def asset_path(repo_root: Path, configured_path: str) -> Path:
    """Resolve a configured absolute, home-relative, or repository-relative asset path."""

    path = Path(configured_path).expanduser()
    return path if path.is_absolute() else repo_root / path


def dialogue_routing_preview(repo_root: Path, target_count: int) -> dict[str, Any]:
    """Return safe display metadata for the local-versus-remote Dialogue decision."""

    from .remote_llm import configured_api_key

    registry = load_model_registry(repo_root)
    local = registry.active_text_model()
    remote = registry.remote_dialogue_model()
    false_reduction = None
    recall_improvement = None
    if local.dialogue_benchmark and remote and remote.dialogue_benchmark:
        local_false = local.dialogue_benchmark.false_character_rate
        local_recall = local.dialogue_benchmark.speaker_recall
        if local_false > 0:
            false_reduction = round(
                (local_false - remote.dialogue_benchmark.false_character_rate) / local_false * 100
            )
        if local_recall > 0:
            recall_improvement = round(
                (remote.dialogue_benchmark.speaker_recall - local_recall) / local_recall * 100
            )
    return {
        "targetCount": max(0, int(target_count)),
        "largeReviewThreshold": registry.dialogue_attribution.large_review_threshold,
        "shouldPrompt": bool(
            remote and target_count > registry.dialogue_attribution.large_review_threshold
        ),
        "defaultRoute": registry.dialogue_attribution.default_route,
        "local": {
            "displayName": local.display_name,
            "apiCostUsd": 0.0,
        },
        "remote": (
            {
                "displayName": remote.display_name,
                "domain": remote.domain,
                "credentialConfigured": bool(configured_api_key(repo_root, remote.api_key_env)),
                "apiKeyEnvironmentVariable": remote.api_key_env,
                "estimatedCostUsd": round(
                    max(0, target_count) * remote.estimated_usd_per_target, 2
                ),
                **({"estimatedDurationSeconds": round(
                        2 * math.ceil(max(0, target_count) / remote.max_targets_per_batch)
                        * remote.estimated_seconds_per_batch / remote.max_concurrent_batches
                        * 1.25
                    )} if remote.estimated_seconds_per_batch is not None else {}),
                "falseNamesReductionPercent": false_reduction,
                "speakerRecallImprovementPercent": recall_improvement,
            }
            if remote
            else None
        ),
    }


def _text_model(model_id: str, value: Any) -> TextModelConfig:
    row = _mapping(value, f"text_models.{model_id}")
    engine = _string(row, "engine")
    if engine != "llama_cpp":
        raise ModelConfigError(f"Unsupported text engine for {model_id}: {engine}")
    context_size = _positive_int(row, "context_size")
    gpu_layers = _positive_int(row, "gpu_layers")
    return TextModelConfig(
        id=model_id,
        label=_string(row, "label"),
        display_name=_optional_string(row, "display_name") or _string(row, "label"),
        engine=engine,
        runtime_path=_string(row, "runtime_path"),
        model_path=_string(row, "model_path"),
        context_size=context_size,
        gpu_layers=gpu_layers,
        source=_string(row, "source"),
        revision=_string(row, "revision"),
        dialogue_benchmark=_dialogue_benchmark(row.get("dialogue_benchmark")),
    )


def _remote_text_model(model_id: str, value: Any) -> RemoteTextModelConfig:
    row = _mapping(value, f"remote_text_models.{model_id}")
    engine = _string(row, "engine")
    if engine not in {"openai_compatible", "openai_responses"}:
        raise ModelConfigError(f"Unsupported remote text engine for {model_id}: {engine}")
    base_url = _string(row, "base_url").rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ModelConfigError(f"Remote text model {model_id} requires an HTTP(S) base_url")
    reasoning_effort = _optional_string(row, "reasoning_effort")
    if reasoning_effort not in {None, "low", "medium", "high"}:
        raise ModelConfigError(
            f"Unsupported reasoning_effort for remote text model {model_id}: {reasoning_effort}"
        )
    service_tier = _optional_string(row, "service_tier")
    if service_tier not in {None, "default", "fast", "priority"}:
        raise ModelConfigError(f"Unsupported service_tier for remote text model {model_id}")
    long_price_keys = (
        "long_context_input_usd_per_million_tokens",
        "long_context_cached_input_usd_per_million_tokens",
        "long_context_cache_write_input_usd_per_million_tokens",
        "long_context_output_usd_per_million_tokens",
    )
    long_keys = ("long_context_input_token_threshold", *long_price_keys)
    if any(key in row for key in long_keys) and not all(key in row for key in long_keys):
        raise ModelConfigError("Long-context pricing requires a threshold and all four token rates")
    long_prices = {key: _non_negative_number(row, key) for key in long_price_keys if key in row}
    input_price = _non_negative_number(row, "input_usd_per_million_tokens")
    cache_write_price = (
        _non_negative_number(row, "cache_write_input_usd_per_million_tokens")
        if "cache_write_input_usd_per_million_tokens" in row
        else input_price
    )
    return RemoteTextModelConfig(
        id=model_id,
        display_name=_string(row, "display_name"),
        engine=engine,
        base_url=base_url,
        api_key_env=_string(row, "api_key_env"),
        model=_string(row, "model"),
        pricing_version=_string(row, "pricing_version"),
        reasoning_effort=reasoning_effort,
        service_tier=service_tier,
        default_service_tier_price_multiplier=(
            _non_negative_number(row, "default_service_tier_price_multiplier")
            if "default_service_tier_price_multiplier" in row else 1.0
        ),
        long_context_input_token_threshold=(
            _positive_int(row, "long_context_input_token_threshold")
            if "long_context_input_token_threshold" in row else None
        ),
        **long_prices,
        policy=_string(row, "policy"),
        input_usd_per_million_tokens=input_price,
        cached_input_usd_per_million_tokens=_non_negative_number(
            row, "cached_input_usd_per_million_tokens"
        ),
        cache_write_input_usd_per_million_tokens=cache_write_price,
        output_usd_per_million_tokens=_non_negative_number(row, "output_usd_per_million_tokens"),
        max_targets_per_batch=_positive_int(row, "max_targets_per_batch"),
        max_concurrent_batches=_positive_int(row, "max_concurrent_batches"),
        estimated_usd_per_target=_non_negative_number(row, "estimated_usd_per_target"),
        estimated_seconds_per_batch=_duration_hint(row),
        dialogue_benchmark=_dialogue_benchmark(row.get("dialogue_benchmark")),
    )


def _dialogue_attribution(value: Any) -> DialogueAttributionConfig:
    if value is None:
        return DialogueAttributionConfig("local", 100, "selective-exact-consensus", None)
    row = _mapping(value, "dialogue_attribution")
    default_route = _optional_string(row, "default_route") or "local"
    if default_route not in {"local", "remote"}:
        raise ModelConfigError(f"Unsupported Dialogue default_route: {default_route}")
    return DialogueAttributionConfig(
        default_route=default_route,
        large_review_threshold=_positive_int(row, "large_review_threshold"),
        local_policy=_optional_string(row, "local_policy") or "selective-exact-consensus",
        remote_profile=_optional_string(row, "remote_profile"),
        adjudication_remote_profile=_optional_string(row, "adjudication_remote_profile"),
    )


def _dialogue_benchmark(value: Any) -> DialogueBenchmark | None:
    if value is None:
        return None
    row = _mapping(value, "dialogue_benchmark")
    false_rate = _rate(row, "false_character_rate")
    recall = _rate(row, "speaker_recall")
    return DialogueBenchmark(
        sample_size=_positive_int(row, "sample_size"),
        false_character_rate=false_rate,
        speaker_recall=recall,
        policy=_string(row, "policy"),
    )


def _voice_pipeline(model_id: str, value: Any) -> VoicePipelineConfig:
    row = _mapping(value, f"voice_pipelines.{model_id}")
    engine = _string(row, "engine")
    if engine != "mlx_audio":
        raise ModelConfigError(f"Unsupported voice engine for {model_id}: {engine}")
    raw_languages = row.get("languages")
    if not isinstance(raw_languages, list) or not raw_languages:
        raise ModelConfigError(f"voice_pipelines.{model_id}.languages must be a non-empty list")
    languages = tuple(str(value).strip().casefold() for value in raw_languages)
    if any(not value for value in languages) or len(languages) != len(set(languages)):
        raise ModelConfigError(f"voice_pipelines.{model_id}.languages must be unique names")
    return VoicePipelineConfig(
        id=model_id,
        label=_string(row, "label"),
        engine=engine,
        audition_path=_string(row, "audition_path"),
        renderer_path=_string(row, "renderer_path"),
        audition_source=_string(row, "audition_source"),
        audition_revision=_string(row, "audition_revision"),
        renderer_source=_string(row, "renderer_source"),
        renderer_revision=_string(row, "renderer_revision"),
        recipe_version=_string(row, "recipe_version"),
        languages=languages,
    )


def _speech_model(model_id: str, value: Any) -> SpeechModelConfig:
    row = _mapping(value, f"speech_models.{model_id}")
    engine = _string(row, "engine")
    if engine != "mlx_audio":
        raise ModelConfigError(f"Unsupported speech engine for {model_id}: {engine}")
    return SpeechModelConfig(
        id=model_id,
        label=_string(row, "label"),
        engine=engine,
        model_path=_string(row, "model_path"),
        source=_string(row, "source"),
        revision=_string(row, "revision"),
    )


def _table(row: dict[str, Any], key: str) -> dict[str, Any]:
    return _mapping(row.get(key), key)


def _optional_table(row: dict[str, Any], key: str) -> dict[str, Any]:
    value = row.get(key)
    return {} if value is None else _mapping(value, key)


def _mapping(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ModelConfigError(f"models.toml requires [{name}]")
    return value


def _string(row: dict[str, Any], key: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ModelConfigError(f"models.toml requires a non-empty {key}")
    return value.strip()


def _optional_string(row: dict[str, Any], key: str) -> str | None:
    value = row.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ModelConfigError(f"models.toml requires a non-empty {key}")
    return value.strip()


def _positive_int(row: dict[str, Any], key: str) -> int:
    value = row.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ModelConfigError(f"models.toml requires a positive integer {key}")
    return value


def _duration_hint(row: dict[str, Any]) -> float | None:
    if "estimated_seconds_per_batch" not in row:
        return None
    value = _non_negative_number(row, "estimated_seconds_per_batch")
    if not math.isfinite(value) or value <= 0:
        raise ModelConfigError("estimated_seconds_per_batch must be positive and finite")
    return value


def _non_negative_number(row: dict[str, Any], key: str) -> float:
    value = row.get(key)
    if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
        raise ModelConfigError(f"models.toml requires a non-negative number {key}")
    return float(value)


def _rate(row: dict[str, Any], key: str) -> float:
    value = _non_negative_number(row, key)
    if value > 1:
        raise ModelConfigError(f"models.toml requires {key} between 0 and 1")
    return value
