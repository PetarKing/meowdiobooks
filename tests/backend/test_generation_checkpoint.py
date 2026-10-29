"""Recovery uses synthetic source text and deterministic audio, never model calls."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from scipy.io import wavfile

from meowdiobooks.backend import tts_v2
from meowdiobooks.backend.generation_checkpoint import CHECKPOINT_DIRECTORY
from meowdiobooks.backend.pacing import timing_policy


class SyntheticModel:
    sample_rate = 24_000

    def __init__(self):
        self.calls = []
        self.fail_text = None

    def generate(self, text, **kwargs):
        self.calls.append((text, kwargs))
        if text == self.fail_text:
            raise KeyboardInterrupt("synthetic process interruption")
        # Distinct stable output for every utterance/reference. Includes quiet edges
        # and a tail burst so timing, fade and mix regressions change the comparison.
        seed = hashlib.sha256((text + str(kwargs.get("ref_text"))).encode()).digest()[0]
        speech = np.sin(np.arange(4000, dtype=np.float32) * 0.13) * (0.1 + seed / 1000)
        audio = np.concatenate([np.zeros(400), speech, np.zeros(300), [0.07], np.zeros(500)])
        return iter([SimpleNamespace(audio=audio.astype(np.float32))])


@pytest.fixture
def render_case(tmp_path, monkeypatch):
    (tmp_path / "models.toml").write_bytes(
        (Path(__file__).resolve().parents[2] / "models.toml").read_bytes()
    )
    package = tmp_path / "package"
    package.mkdir()
    wavfile.write(package / "voice.wav", 24_000, np.array([0.2, -0.2], dtype=np.float32))
    segment = {
        "id": "segment-1", "text": "A synthetic opening…A synthetic middle…A synthetic ending.",
        "referenceAudio": "voice.wav", "referenceText": "An accepted synthetic reference.",
        "referenceMode": "transcript-conditioned", "voiceRevision": "voice-1",
        "effectiveCharacterId": "narrator", "effectiveSpeaker": "Narrator",
    }
    plan = {"contract": "meowdiobooks.render-plan.v2", "inputRevisions": {"cast": "cast-1"},
            "chapters": [{"chapterId": "chapter-1", "segments": [segment]}]}
    model = SyntheticModel()
    monkeypatch.setattr(tts_v2, "_load_model", lambda *args: (model, lambda: None))

    def render(*, source=None, selected_plan=None, checkpoint_dir=None, report=None, language="english"):
        return tts_v2.render_plan_audio(
            tmp_path, source or package, "synthetic-book", selected_plan or plan, language,
            report or (lambda *_: None), checkpoint_dir=checkpoint_dir,
        )

    return SimpleNamespace(model=model, package=package, plan=plan, render=render)


@pytest.mark.parametrize("timed", [False, True])
@pytest.mark.parametrize("mixed", [False, True])
def test_interrupted_long_passage_resumes_sections_with_identical_pcm(render_case, timed, mixed):
    case = render_case
    if timed:
        case.plan["timing"] = timing_policy()
    if mixed:
        first = case.plan["chapters"][0]["segments"][0]
        first["mixGroupId"] = "duet"
        case.plan["chapters"][0]["segments"].append(
            {**first, "id": "second", "effectiveCharacterId": "other",
             "referenceText": "A different accepted synthetic reference."}
        )
    original = case.render()
    expected = Path(original[0]["artifactPath"]).read_bytes()
    prior = (case.package / "audio/chapter-1/latest.json").read_bytes()
    shutil.rmtree(case.package / CHECKPOINT_DIRECTORY)
    case.model.calls.clear()
    case.model.fail_text = "A synthetic middle…"
    with pytest.raises(KeyboardInterrupt):
        case.render()
    assert (case.package / "audio/chapter-1/latest.json").read_bytes() == prior
    assert not list((case.package / "audio/chapter-1").glob(".*.staging"))
    assert len(list((case.package / CHECKPOINT_DIRECTORY).glob("*/*.wav"))) == 1
    case.model.fail_text = None
    case.model.calls.clear()
    progress = []
    resumed = case.render(report=lambda percent, message: progress.append(percent))
    assert Path(resumed[0]["artifactPath"]).read_bytes() == expected
    assert len(case.model.calls) == (5 if mixed else 2)
    assert progress == sorted(progress)
    assert progress[-1] == 100
    status = json.loads(next((case.package / CHECKPOINT_DIRECTORY).glob("*/progress.json")).read_text())
    assert status["completedSections"] == status["totalSections"] == (6 if mixed else 3)
    assert status["restoredSections"] == 1
    assert status["state"] == "complete"
    assert set(status) == {"contract", "key", "state", "totalSections", "completedSections",
                           "restoredSections", "startedAt", "updatedAt"}


def test_completed_chapter_resumes_after_disposable_package_is_removed(render_case, tmp_path):
    case = render_case
    root = tmp_path / "durable-private-checkpoints"
    original = case.render(checkpoint_dir=root)
    expected = Path(original[0]["artifactPath"]).read_bytes()
    moved = tmp_path / "new-stage"
    moved.mkdir()
    shutil.copyfile(case.package / "voice.wav", moved / "moved-voice.wav")
    plan = copy.deepcopy(case.plan)
    plan["chapters"][0]["segments"][0]["referenceAudio"] = str(moved / "moved-voice.wav")
    shutil.rmtree(case.package)
    case.model.calls.clear()
    resumed = case.render(source=moved, selected_plan=plan, checkpoint_dir=root)
    assert case.model.calls == []
    assert Path(resumed[0]["artifactPath"]).read_bytes() == expected
    assert not (moved / CHECKPOINT_DIRECTORY).exists()


def test_later_chapter_failure_retains_earlier_completed_chapter_sections(render_case):
    case = render_case
    first = case.plan["chapters"][0]
    second = copy.deepcopy(first)
    second["chapterId"] = "chapter-2"
    first["segments"][0]["text"] = "A complete synthetic first chapter."
    case.plan["chapters"].append(second)
    case.model.fail_text = "A synthetic middle…"
    with pytest.raises(KeyboardInterrupt):
        case.render()
    assert (case.package / "audio/chapter-1/latest.json").exists()
    assert not (case.package / "audio/chapter-2/latest.json").exists()
    shutil.rmtree(case.package / "audio")
    case.model.calls.clear()
    case.model.fail_text = None
    result = case.render()
    assert len(result) == 2
    assert len(case.model.calls) == 2


@pytest.mark.parametrize("change", ["config", "weights", "path"])
def test_installed_model_replacement_invalidates_same_registry_revision(render_case, change):
    case = render_case
    model = case.package.parent / "models/qwen_1_7b_base_8bit"
    model.mkdir(parents=True)
    (model / "config.json").write_text('{"synthetic": 1}')
    (model / "model.safetensors").write_bytes(b"synthetic weight signature only")
    case.render()
    if change == "config":
        (model / "config.json").write_text('{"synthetic": 2}')
    elif change == "weights":
        (model / "model.safetensors").write_bytes(b"synthetic replacement weights")
    else:
        catalog = case.package.parent / "models.toml"
        catalog.write_text(catalog.read_text().replace('renderer_path = "models/qwen_1_7b_base_8bit"',
                                                      'renderer_path = "models/other-base"'))
    case.model.calls.clear()
    case.render()
    assert len(case.model.calls) == 3


@pytest.mark.parametrize("change", ["text", "order", "voice", "reference", "reference-mode",
                                    "language", "model", "runtime", "target", "timing"])
def test_output_affecting_recipe_changes_never_reuse_sections(render_case, monkeypatch, change):
    case = render_case
    case.render()
    segment = case.plan["chapters"][0]["segments"][0]
    language = "english"
    if change == "text":
        segment["text"] = "A changed synthetic opening…A synthetic middle…A synthetic ending."
    elif change == "order":
        segment["text"] = "A synthetic ending…A synthetic middle…A synthetic opening."
    elif change == "voice":
        segment["referenceText"] = "A newly accepted reference transcript."
    elif change == "reference":
        wavfile.write(case.package / "voice.wav", 24_000, np.array([0.3, -0.3], dtype=np.float32))
    elif change == "reference-mode":
        segment["referenceMode"] = "speaker-embedding"
    elif change == "language":
        language = "dutch"
    elif change == "model":
        catalog = case.package.parent / "models.toml"
        catalog.write_text(catalog.read_text().replace("e7dd0585652209fa0d7783659aad4e8a324de11c",
                                                      "a" * 40))
    elif change == "runtime":
        monkeypatch.setattr(tts_v2, "version", lambda _: "new-test-runtime")
    elif change == "target":
        monkeypatch.setenv("MEOWDIOBOOKS_TTS_TARGET_CHARACTERS", "240")
    elif change == "timing":
        case.plan["timing"] = timing_policy()
    case.model.calls.clear()
    case.render(language=language)
    assert len(case.model.calls) == 3
    assert len(list((case.package / CHECKPOINT_DIRECTORY).iterdir())) == 2


@pytest.mark.parametrize("damage", ["wav", "metadata", "missing", "nonfinite", "sample-rate",
                                   "truncated-matching-digest"])
def test_corrupt_or_incomplete_sections_regenerate_only_that_section(render_case, damage):
    case = render_case
    original = case.render()
    expected = Path(original[0]["artifactPath"]).read_bytes()
    path = next((case.package / CHECKPOINT_DIRECTORY).glob("*/*00001.wav"))
    if damage == "truncated-matching-digest":
        path.write_bytes(b"RIFF")
        metadata = json.loads(path.with_suffix(".json").read_text())
        metadata["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        path.with_suffix(".json").write_text(json.dumps(metadata))
    elif damage == "wav":
        path.write_bytes(b"interrupted WAV")
    elif damage == "metadata":
        path.with_suffix(".json").write_text("{")
    elif damage == "missing":
        path.with_suffix(".json").unlink()
    else:
        wavfile.write(path, 12_000 if damage == "sample-rate" else 24_000,
                      np.array([0.1, np.nan if damage == "nonfinite" else -0.1], dtype=np.float32))
        metadata = json.loads(path.with_suffix(".json").read_text())
        metadata.update(sha256=hashlib.sha256(path.read_bytes()).hexdigest(), samples=2)
        path.with_suffix(".json").write_text(json.dumps(metadata))
    case.model.calls.clear()
    resumed = case.render()
    assert len(case.model.calls) == 1
    assert Path(resumed[0]["artifactPath"]).read_bytes() == expected


def test_progress_cancellation_keeps_just_completed_section(render_case):
    case = render_case

    def cancel(percent, message):
        if percent > 2:
            raise RuntimeError("synthetic cancellation")

    with pytest.raises(RuntimeError, match="synthetic cancellation"):
        case.render(report=cancel)
    assert not (case.package / "audio/chapter-1/latest.json").exists()
    status = json.loads(next((case.package / CHECKPOINT_DIRECTORY).glob("*/progress.json")).read_text())
    assert status["completedSections"] == 1
    assert status["state"] == "interrupted"
    case.model.calls.clear()
    case.render()
    assert len(case.model.calls) == 2


@pytest.mark.parametrize("link", ["ancestor", "root", "recipe", "wav", "progress"])
def test_checkpoint_symlinks_fail_closed_without_reading_or_mutating_target(render_case, tmp_path, link):
    case = render_case
    case.render()
    root = case.package / CHECKPOINT_DIRECTORY
    recipe = next(root.iterdir())
    target = tmp_path / "outside"
    target.mkdir()
    sentinel = target / "sentinel"
    sentinel.write_text("unchanged")
    if link == "ancestor":
        shutil.rmtree(root.parent)
        root.parent.symlink_to(target, target_is_directory=True)
    elif link == "root":
        shutil.rmtree(root)
        root.symlink_to(target, target_is_directory=True)
    elif link == "recipe":
        shutil.rmtree(recipe)
        recipe.symlink_to(target, target_is_directory=True)
    else:
        path = next(recipe.glob("*.wav")) if link == "wav" else recipe / "progress.json"
        path.unlink()
        path.symlink_to(sentinel)
    with pytest.raises(ValueError, match="symlink"):
        case.render()
    assert sentinel.read_text() == "unchanged"
    assert list(target.iterdir()) == [sentinel]


@pytest.mark.parametrize("kind", ["fifo", "directory"])
def test_nonregular_checkpoint_files_fail_without_blocking(render_case, kind):
    case = render_case
    case.render()
    path = next((case.package / CHECKPOINT_DIRECTORY).glob("*/*.wav"))
    path.unlink()
    if kind == "fifo":
        os.mkfifo(path)
    else:
        path.mkdir()
    with pytest.raises(ValueError, match="regular files"):
        case.render()


def test_progress_write_failure_does_not_mask_render_interruption(render_case, monkeypatch):
    from meowdiobooks.backend.generation_checkpoint import GenerationCheckpoint
    original = GenerationCheckpoint.progress

    def full_disk(self, state):
        if state == "interrupted":
            raise OSError("synthetic disk full")
        return original(self, state)

    monkeypatch.setattr(GenerationCheckpoint, "progress", full_disk)
    render_case.model.fail_text = "A synthetic middle…"
    with pytest.raises(KeyboardInterrupt, match="synthetic process interruption"):
        render_case.render()


@pytest.mark.parametrize("sample", ["01-alice-explicit-dialogue.pdf",
                                   "02-pride-inferred-multispeaker.pdf",
                                   "03-ah-q-traditional-chinese-dialogue.pdf"])
def test_public_domain_sources_resume_to_identical_audio(render_case, sample):
    import pdfplumber
    case = render_case
    source = Path(__file__).resolve().parents[2] / "SampleBooks/public-domain-evaluation" / sample
    with pdfplumber.open(source) as document:
        text = " ".join(page.extract_text() or "" for page in document.pages)
    segment = case.plan["chapters"][0]["segments"][0]
    segment["text"] = text
    sections = tts_v2._synthesis_units(tts_v2._clean_text(text))
    assert len(sections) >= 4
    before = case.render()
    expected = Path(before[0]["artifactPath"]).read_bytes()
    shutil.rmtree(case.package / CHECKPOINT_DIRECTORY)
    case.model.fail_text = sections[2]
    with pytest.raises(KeyboardInterrupt):
        case.render()
    case.model.fail_text = None
    case.model.calls.clear()
    after = case.render()
    assert len(case.model.calls) == len(sections) - 2
    assert Path(after[0]["artifactPath"]).read_bytes() == expected
