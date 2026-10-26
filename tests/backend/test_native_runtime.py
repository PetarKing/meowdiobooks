from types import SimpleNamespace

import numpy as np
import pytest

from meowdiobooks.backend.audio import generate_cast_previews, generate_cloned_audition
from meowdiobooks.backend.native_runtime import load_native_model
from meowdiobooks.backend.transcription import transcribe_voice_sample
from meowdiobooks.backend.tts_v2 import render_plan_audio


@pytest.mark.parametrize('operation', ['audition', 'clone', 'transcribe', 'render'])
@pytest.mark.parametrize('fail', [False, True])
def test_native_operations_release_exact_host_lease_on_success_and_failure(
    tmp_path, monkeypatch, operation, fail,
):
    model_path = tmp_path / 'weights'
    model_path.mkdir()
    pipeline = SimpleNamespace(
        audition_path='weights', renderer_path='weights', id='test-pipeline',
        renderer_source='test/base-8bit', renderer_revision='test-revision', recipe_version='2',
    )
    registry = SimpleNamespace(
        voice_pipeline=lambda _: pipeline,
        transcription_model=lambda _: SimpleNamespace(model_path='weights', engine='mlx_audio'),
    )
    for module in ('audio', 'transcription', 'tts_v2'):
        monkeypatch.setattr(f'meowdiobooks.backend.{module}.load_model_registry', lambda _: registry)
        monkeypatch.setattr(f'meowdiobooks.backend.{module}.asset_path', lambda root, path: root / path)

    calls = []
    releases = []

    class Model:
        sample_rate = 24000

        def generate(self, *_args, **_kwargs):
            if fail:
                raise RuntimeError('inference failed')
            if operation == 'transcribe':
                return SimpleNamespace(text='Hello.', language='English')
            return [SimpleNamespace(audio=np.full(2400, .1, dtype=np.float32))]

    model = Model()

    def loader(path, kind):
        calls.append((path, kind))
        return model, lambda: releases.append(kind)

    reference = tmp_path / 'reference.wav'
    reference.write_bytes(b'host-normalized-reference')

    def run():
        if operation == 'clone':
            return generate_cloned_audition(tmp_path, reference, 'Hello.', 'Hello.',
                                           'english', model_loader=loader)
        if operation == 'audition':
            return generate_cast_previews(tmp_path, tmp_path / 'package', 'book',
                [{'id': 'cat', 'name': 'Cat', 'voiceDirection': 'Warm voice', 'previewLine': 'Hello.'}],
                lambda *_: None, 'english', model_loader=loader)
        if operation == 'transcribe':
            return transcribe_voice_sample(tmp_path, reference, model_loader=loader)
        plan = {'contract': 'meowdiobooks.render-plan.v2', 'chapters': [
            {'chapterId': 'chapter', 'segments': [{'id': 'segment', 'text': 'Hello.',
              'referenceAudio': str(reference), 'referenceText': 'Hello.'}]}]}
        return render_plan_audio(tmp_path, tmp_path / 'package', 'book', plan, 'english',
                                 lambda *_: None, model_loader=loader)

    if fail:
        with pytest.raises(RuntimeError):
            run()
    else:
        assert run()
    kind = 'stt' if operation == 'transcribe' else 'tts'
    assert calls == [(model_path.resolve(), kind)]
    assert releases == [kind]


def test_missing_model_is_rejected_before_host_loader(tmp_path):
    with pytest.raises(RuntimeError, match='not installed'):
        load_native_model(tmp_path / 'missing', 'tts', lambda *_: pytest.fail('must not load'))
