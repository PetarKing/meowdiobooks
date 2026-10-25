from types import SimpleNamespace
from io import BytesIO
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile

from meowdiobooks.backend.audio import (
    QWEN_GENERATION_ATTEMPTS,
    _generate_cloned_preview,
    _generate_preview,
    normalize_voice_sample,
)
from meowdiobooks.backend.tts_v2 import _clean_text, _synthesis_units, _synthesize


class RecordingModel:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def generate(self, text: str, **kwargs):
        self.calls.append({"text": text, **kwargs})
        return iter([SimpleNamespace(audio=np.array([0.1, -0.1], dtype=np.float32))])


@pytest.mark.parametrize('text', [
    'Erm.. Hello there.',
    'A longer opening sentence. Oh. Another complete sentence.',
    'Another complete sentence. Yes.',
    'Oh. No. Um. Another complete sentence.',
    'Oh. No. Uh.', 'Yes.', '“Oh.” Another complete sentence.',
    '嗯。 花園裡的貓正在安靜地散步。',
    '花園裡的貓正在安靜地散步。 嗯。',
    '嗯。 啊。 好。 花園裡的貓正在安靜地散步。',
    'An ordinary first sentence. Another ordinary sentence.',
])
def test_ordinary_turns_keep_complete_context_without_changing_text(text):
    units = _synthesis_units(text)
    assert units == [_clean_text(text)]
    assert ' '.join(units) == _clean_text(text)


def test_punctuation_without_speech_produces_no_synthesis_units():
    assert _synthesis_units(' ... !!! ') == []


@pytest.mark.parametrize('fragment', ['Oh.', 'Oh. No.', '“Oh.”', '嗯。 啊。', '...'])
@pytest.mark.parametrize('position', ['leading', 'middle', 'trailing'])
def test_long_passages_preserve_fragments_and_every_cleaned_source_character(fragment, position):
    sentence = 'This ordinary complete sentence supplies enough speech context for a long passage.'
    sentences = [sentence] * 8
    sentences.insert({'leading': 0, 'middle': 4, 'trailing': 8}[position], fragment)
    text = ' '.join(sentences)
    units = _synthesis_units(text)
    assert len(text) > 500
    if fragment != '...':
        assert fragment not in units
    assert ' '.join(units) == text


def test_long_passage_sentence_boundaries_and_unsplittable_words_remain_intact():
    sentences = ['This is an ordinary sentence with enough context.'] * 12
    assert _synthesis_units(' '.join(sentences)) == [
        ' '.join(sentences[index:index + 2]) for index in range(0, 12, 2)
    ]
    unsplittable = 'a' * 501
    assert _synthesis_units(unsplittable) == [unsplittable]


def test_short_fragment_context_is_spoken_once_with_unchanged_conditioning(tmp_path):
    model = RecordingModel()
    reference = tmp_path / 'reference.wav'
    reference.write_bytes(b'reference')
    segment = {'id': 'passage', 'referenceAudio': 'reference.wav',
               'referenceText': 'The accepted voice reference.'}
    _synthesize(model, 'Erm.. Hello there.', segment, tmp_path, 'english')
    assert model.calls == [{
        'text': 'Erm.. Hello there.', 'lang_code': 'english', 'split_pattern': '',
        'ref_audio': str(reference), 'ref_text': segment['referenceText'],
        **QWEN_GENERATION_ATTEMPTS[0],
    }]


@pytest.mark.parametrize('results,summary', [
    ([], 'results=0, empty=0, nonfinite=0'),
    ([[]], 'results=1, empty=1, nonfinite=0'),
    ([[float('nan')]], 'results=1, empty=0, nonfinite=1'),
    ([[], [float('inf')], [float('nan'), 0.1]], 'results=3, empty=1, nonfinite=2'),
])
def test_exhausted_audio_attempts_explain_rejected_samples_without_source_text(tmp_path, results, summary):
    class FailingModel(RecordingModel):
        def generate(self, text, **kwargs):
            self.calls.append({'text': text, **kwargs})
            return iter(SimpleNamespace(audio=np.asarray(row, dtype=np.float32)) for row in results)

    reference = tmp_path / 'reference.wav'
    reference.write_bytes(b'reference')
    model = FailingModel()
    with pytest.raises(RuntimeError) as caught:
        _synthesize(model, 'Sensitive manuscript words.',
                    {'id': 'passage', 'referenceAudio': 'reference.wav',
                     'referenceText': 'Sensitive reference words.'}, tmp_path, 'english')
    assert str(caught.value).count(summary) == len(QWEN_GENERATION_ATTEMPTS)
    assert len(model.calls) == len(QWEN_GENERATION_ATTEMPTS)
    assert 'Sensitive' not in str(caught.value)
    assert str(reference) not in str(caught.value)


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


class ShortWordRecoveryModel(RecordingModel):
    sample_rate = 24_000

    def generate(self, text, **kwargs):
        self.calls.append({'text': text, **kwargs})
        if text == 'Erm..' and kwargs.get('ref_text') == 'Accepted reference.':
            return iter([])
        return iter([SimpleNamespace(audio=np.array([0.1, -0.1], dtype=np.float32))])


def recovery_segment(tmp_path, **overrides):
    (tmp_path / 'reference.wav').write_bytes(b'reference')
    return {'id': 'short', 'text': 'Erm..', 'effectiveCharacterId': 'speaker',
            'referenceAudio': 'reference.wav', 'referenceText': 'Accepted reference.', **overrides}


def test_short_word_recovery_keeps_source_and_reference_and_records_mode(tmp_path):
    model = ShortWordRecoveryModel()
    segment = recovery_segment(tmp_path)
    before = dict(segment)
    recoveries = []
    result = _synthesize(model, segment['text'], segment, tmp_path, 'english', recoveries=recoveries)
    np.testing.assert_array_equal(result, [np.float32(0.1), np.float32(-0.1)])
    assert segment == before
    assert len(model.calls) == 4
    assert all(call['text'] == 'Erm..' for call in model.calls)
    assert all(call['ref_audio'] == str(tmp_path / 'reference.wav') for call in model.calls)
    assert all(call['ref_text'] == 'Accepted reference.' for call in model.calls[:3])
    assert 'ref_text' not in model.calls[3]
    assert recoveries == [{
        'segmentId': 'short', 'effectiveCharacterId': 'speaker', 'unitIndex': 1,
        'originalReferenceMode': 'transcript-conditioned',
        'effectiveReferenceMode': 'speaker-embedding',
        'reason': 'no-results-after-transcript-conditioning',
        'initialAttempts': 3, 'recoveryAttempts': 1,
    }]
    _synthesize(model, 'Next complete passage.', segment, tmp_path, 'english')
    assert model.calls[-1]['ref_text'] == 'Accepted reference.'


@pytest.mark.parametrize('kind', ['empty', 'nonfinite', 'exception', 'mixed'])
def test_recovery_requires_every_initial_attempt_to_yield_zero_results(tmp_path, kind):
    class Model(RecordingModel):
        def generate(self, text, **kwargs):
            self.calls.append({'text': text, **kwargs})
            selected = kind if len(self.calls) == 1 or kind != 'mixed' else 'zero'
            if selected in {'exception', 'mixed'}:
                raise ValueError('backend failed')
            rows = {'zero': [], 'empty': [[]], 'nonfinite': [[float('nan')]]}[selected]
            return iter(SimpleNamespace(audio=np.asarray(row)) for row in rows)
    model = Model()
    with pytest.raises(RuntimeError):
        _synthesize(model, 'Erm..', recovery_segment(tmp_path), tmp_path, 'english')
    assert len(model.calls) == 3
    assert all('ref_text' in call for call in model.calls)


@pytest.mark.parametrize('text,mode', [
    ('Two words.', 'transcript-conditioned'), ('a' * 33, 'transcript-conditioned'),
    ('Erm..', 'speaker-embedding'),
])
def test_recovery_is_limited_to_short_standalone_transcript_conditioned_units(tmp_path, text, mode):
    class Model(RecordingModel):
        def generate(self, text, **kwargs):
            self.calls.append({'text': text, **kwargs})
            return iter([])
    model = Model()
    with pytest.raises(RuntimeError):
        _synthesize(model, text, recovery_segment(tmp_path, referenceMode=mode), tmp_path, 'english')
    assert len(model.calls) == 3


def test_recovery_is_bounded_and_never_returns_silence_on_failure(tmp_path):
    class Model(RecordingModel):
        def generate(self, text, **kwargs):
            self.calls.append({'text': text, **kwargs})
            return iter([])
    model = Model()
    recoveries = []
    with pytest.raises(RuntimeError, match='speaker-embedding attempt 3: no usable samples'):
        _synthesize(model, 'Erm..', recovery_segment(tmp_path), tmp_path, 'english', recoveries=recoveries)
    assert len(model.calls) == 6
    assert recoveries == []


def test_recovery_does_not_swallow_cancellation(tmp_path):
    class Model(RecordingModel):
        def generate(self, text, **kwargs):
            if 'ref_text' not in kwargs:
                raise KeyboardInterrupt()
            return iter([])
    segment = recovery_segment(tmp_path)
    with pytest.raises(KeyboardInterrupt):
        _synthesize(Model(), 'Erm..', segment, tmp_path, 'english')
    assert segment['referenceText'] == 'Accepted reference.'


def test_mixed_render_records_recovery_for_correct_member(tmp_path, monkeypatch):
    import json
    from meowdiobooks.backend import tts_v2
    first = recovery_segment(tmp_path, id='first', effectiveCharacterId='first-voice',
                             referenceText='Other reference.', mixGroupId='duet')
    second = {**first, 'id': 'second', 'effectiveCharacterId': 'second-voice',
              'referenceText': 'Accepted reference.'}
    model = ShortWordRecoveryModel()
    monkeypatch.setattr(tts_v2, '_load_model', lambda *args: (model, lambda: None))
    result = tts_v2.render_plan_audio(tmp_path, tmp_path, 'book', {
        'contract': 'meowdiobooks.render-plan.v2',
        'chapters': [{'chapterId': 'chapter', 'segments': [first, second]}],
    }, 'english', lambda *args: None)
    metadata = json.loads(Path(result[0]['metadataPath']).read_text())
    event = metadata['segments'][0]['synthesisRecoveries'][0]
    assert event['segmentId'] == 'second'
    assert event['effectiveCharacterId'] == 'second-voice'
    assert len(model.calls) == 5


def test_failed_recovery_preserves_previous_published_chapter(tmp_path, monkeypatch):
    from meowdiobooks.backend import tts_v2
    class Model(RecordingModel):
        sample_rate = 24_000
        def generate(self, text, **kwargs):
            return iter([])
    segment = recovery_segment(tmp_path)
    chapter = tmp_path / 'audio' / 'chapter'
    chapter.mkdir(parents=True)
    latest = chapter / 'latest.json'
    latest.write_text('{"revision":"previous"}')
    monkeypatch.setattr(tts_v2, '_load_model', lambda *args: (Model(), lambda: None))
    with pytest.raises(RuntimeError):
        tts_v2.render_plan_audio(tmp_path, tmp_path, 'book', {
            'contract': 'meowdiobooks.render-plan.v2',
            'chapters': [{'chapterId': 'chapter', 'segments': [segment]}],
        }, 'english', lambda *args: None)
    assert latest.read_text() == '{"revision":"previous"}'
    assert not list(chapter.glob('.*.staging'))


@pytest.mark.parametrize('separator', ['...', '…', '.....', '……', '...?!', '…”'])
def test_ellipsis_forces_split_even_without_whitespace(separator):
    text = f'Wait{separator}Come back here.'
    assert _synthesis_units(text) == [f'Wait{separator}', 'Come back here.']


def test_target_chooses_nearest_boundary_on_either_side_and_preserves_long_sentence():
    # 81 + 40 + space = 122: crossing is closer to 120 than stopping at 81.
    first, second, third = 'A' * 80 + '.', 'B' * 39 + '.', 'C' * 95 + '.'
    assert _synthesis_units(f'{first} {second} {third}') == [f'{first} {second}', third]
    # 101 + 80 + space = 182: stopping below target is closer.
    first, second = 'A' * 100 + '.', 'B' * 79 + '.'
    assert _synthesis_units(f'{first} {second}') == [first, second]
    assert _synthesis_units('A' * 1000 + '.') == ['A' * 1000 + '.']


def test_ellipsis_pause_is_exact_and_never_a_spoken_punctuation_request(tmp_path):
    model = RecordingModel()
    model.sample_rate = 24_000
    segment = recovery_segment(tmp_path)
    audio = _synthesize(model, '…Wait...Come back here…', segment, tmp_path, 'english')
    assert [call['text'] for call in model.calls] == ['Wait...', 'Come back here…']
    expected = np.concatenate([
        np.zeros(6000), [0.1, -0.1], np.zeros(6000), [0.1, -0.1], np.zeros(6000),
    ]).astype(np.float32)
    np.testing.assert_array_equal(audio, expected)


def test_short_word_after_ellipsis_retains_bounded_recovery(tmp_path):
    model = ShortWordRecoveryModel()
    recoveries = []
    audio = _synthesize(model, 'A complete thought…Erm..', recovery_segment(tmp_path),
                        tmp_path, 'english', recoveries=recoveries)
    assert len(audio) == 6004
    assert len(model.calls) == 5
    assert recoveries[0]['unitIndex'] == 2
    assert model.calls[-1]['text'] == 'Erm..'
    assert 'ref_text' not in model.calls[-1]


def test_multilingual_sentence_boundaries_preserve_nonwhitespace_characters():
    text = '這是第一句話而且有足夠的長度。' * 20 + '嗯…下一段也應該獨立。'
    units = _synthesis_units(text)
    assert len(units) > 2
    assert ''.join(''.join(units).split()) == ''.join(text.split())
    assert all(unit.endswith(('。', '…')) for unit in units)


def test_ellipsis_receipt_describes_actual_pause_and_units(tmp_path, monkeypatch):
    import json
    from meowdiobooks.backend import tts_v2
    model = ShortWordRecoveryModel()
    monkeypatch.setattr(tts_v2, '_load_model', lambda *args: (model, lambda: None))
    segment = recovery_segment(tmp_path, text='Wait…Come back here.')
    results = tts_v2.render_plan_audio(tmp_path, tmp_path, 'book', {
        'contract': 'meowdiobooks.render-plan.v2',
        'chapters': [{'chapterId': 'chapter', 'segments': [segment]}],
    }, 'english', lambda *args: None)
    metadata = json.loads(Path(results[0]['metadataPath']).read_text())
    assert metadata['renderer']['chunking'] == {
        'policy': 'sentence-target-ellipsis-v1', 'targetCharacters': 120,
        'ellipsisPauseSeconds': 0.25,
    }
    assert metadata['segments'][0]['synthesisUnits'] == [
        {'text': 'Wait…', 'pauseAfterSeconds': 0.25},
        {'text': 'Come back here.', 'pauseAfterSeconds': 0.0},
    ]
    rate, audio = wavfile.read(results[0]['artifactPath'])
    assert len(audio) == 4 + rate // 4


@pytest.mark.parametrize('closing', ['」', '』', '”', '”』'])
@pytest.mark.parametrize('terminator', ['。', '！？', '？！'])
def test_cjk_closing_quotes_remain_with_the_preceding_sentence(closing, terminator):
    first = '「' + '貓' * 119 + terminator + closing
    second = '下一句話有足夠多個字。'
    assert _synthesis_units(first + second) == [first, second]


@pytest.mark.parametrize('value', ['', '0', '-1', '1.5', 'abc'])
def test_invalid_target_fails_before_acquiring_model(tmp_path, monkeypatch, value):
    from meowdiobooks.backend import tts_v2
    monkeypatch.setenv('MEOWDIOBOOKS_TTS_TARGET_CHARACTERS', value)
    monkeypatch.setattr(tts_v2, '_load_model', lambda *args: pytest.fail('Model must not load'))
    with pytest.raises(tts_v2.TTSContractError, match='positive integer'):
        tts_v2.render_plan_audio(tmp_path, tmp_path, 'book', {
            'contract': 'meowdiobooks.render-plan.v2',
            'chapters': [{'chapterId': 'chapter', 'segments': []}],
        }, 'english', lambda *args: None)


def test_configured_target_controls_calls_and_receipt(tmp_path, monkeypatch):
    import json
    from meowdiobooks.backend import tts_v2
    model = ShortWordRecoveryModel()
    monkeypatch.setattr(tts_v2, '_load_model', lambda *args: (model, lambda: None))
    sentence = 'This complete sentence describes the quiet room beside the garden and the open window.'
    text = ' '.join([sentence] * 3)
    plan = {'contract': 'meowdiobooks.render-plan.v2', 'chapters': [
        {'chapterId': 'chapter', 'segments': [recovery_segment(tmp_path, text=text)]},
    ]}
    for target, calls in [(120, 3), (240, 1)]:
        monkeypatch.setenv('MEOWDIOBOOKS_TTS_TARGET_CHARACTERS', str(target))
        model.calls.clear()
        result = tts_v2.render_plan_audio(tmp_path, tmp_path, 'book', plan,
                                          'english', lambda *args: None)
        assert len(model.calls) == calls
        metadata = json.loads(Path(result[0]['metadataPath']).read_text())
        assert metadata['renderer']['chunking']['targetCharacters'] == target
        assert [row['text'] for row in metadata['segments'][0]['synthesisUnits']] == [
            call['text'] for call in model.calls
        ]


@pytest.mark.parametrize('title', ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'J.'])
def test_sentence_target_does_not_cut_after_titles_or_initials(title):
    first = 'The room was quiet and everyone watched the garden while waiting patiently for the messenger. '
    following = f'{title} Brown ' + 'walked slowly ' * 10 + 'home.'
    assert _synthesis_units(first + following) == [first.strip(), following]
