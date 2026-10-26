from copy import deepcopy
import shutil
from types import SimpleNamespace

import pytest

from meowdiobooks.backend.local_voice_reuse import LocalVoiceReuse


class Books:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows

    def get(self, key):
        return next((row for row in self.rows if row.id == key), None)


@pytest.fixture
def scene(tmp_path):
    books = Books([SimpleNamespace(id='older', title='Subaru one', created_at='2026-01-01'),
                   SimpleNamespace(id='newer', title='Subaru two', created_at='2026-02-01'),
                   SimpleNamespace(id='destination', title='Third', created_at='2026-03-01')])
    casts = {}
    for book in books.rows[:2]:
        root = tmp_path / book.id / 'voices' / 'subaru'
        root.mkdir(parents=True)
        for rev in ('first', 'chosen'):
            (root / f'{rev}.wav').write_bytes(f'{book.id}-{rev}'.encode())
        (root / 'chosen.reference.wav').write_bytes(f'{book.id}-identity'.encode())
        casts[book.id] = {'status': 'accepted', 'language': 'english', 'voiceModel': 'local-qwen',
            'identities': [{'characterId': 'subaru', 'name': 'Subaru', 'category': 'character',
                'literalLabels': ['Subaru'], 'voiceAccepted': True, 'acceptedVoiceRevision': 'chosen',
                'voicePreviewRevision': 'first',
                'voiceCandidates': [{'revision': 'first', 'referenceText': 'Wrong'},
                    {'revision': 'chosen', 'referenceText': 'Chosen transcript',
                     'referenceAudio': 'voices/subaru/chosen.reference.wav'}]}]}
    adapter = LocalVoiceReuse(books=books, package_for_book=lambda key: tmp_path / key,
                             cast_for_book=lambda key: deepcopy(casts.get(key, {})))
    target = {'characterId': 'new-subaru', 'name': 'Subaru', 'category': 'character', 'literalLabels': ['Subaru']}
    return adapter, casts, target, tmp_path


def test_latest_accepted_choice_copies_identity_and_survives_source_deletion(scene):
    adapter, casts, target, root = scene
    preview = adapter.preview('destination', root/'destination', [target], [], 'english', 'local-qwen')
    assert preview['previousVoiceMatches'] == {'Subaru': {'bookTitle': 'Subaru two'}}
    imported = adapter.apply('destination', root/'destination', [target], [], 'english', 'local-qwen',
                             preview_fingerprint=preview['fingerprint'])['new-subaru']
    candidate = imported['voiceCandidates'][0]
    assert candidate['source'] == 'previous-book'
    assert candidate['referenceText'] == 'Chosen transcript'
    assert '/destination/' in candidate['previewUrl']
    assert not imported['voiceAccepted']
    reference = root/'destination'/candidate['referenceAudio']
    assert reference.read_bytes() == b'newer-identity'
    audio = reference.with_name(candidate['revision']+'.wav')
    assert audio.read_bytes() == b'newer-chosen'
    shutil.rmtree(root/'newer')
    assert reference.read_bytes() == b'newer-identity'
    assert audio.read_bytes() == b'newer-chosen'


@pytest.mark.parametrize('label', ['Subaru captain', 'Subaruu', 'Rem'])
def test_non_exact_labels_never_reuse(scene, label):
    adapter, _, target, root = scene
    target.update(name=label, literalLabels=[label])
    assert adapter.apply('destination', root/'destination', [target], [], 'english', 'local-qwen') == {}


@pytest.mark.parametrize('field,value', [('language', 'japanese'), ('voiceModel', 'other'), ('status', 'draft')])
def test_incompatible_latest_book_falls_back_to_older(scene, field, value):
    adapter, casts, target, root = scene
    casts['newer'][field] = value
    result = adapter.apply('destination', root/'destination', [target], [], 'english', 'local-qwen')
    assert result['new-subaru']['previousBookTitle'] == 'Subaru one'


@pytest.mark.parametrize('path', ['../../outside.wav', '/tmp/outside.wav', 'voices/subaru/first.wav'])
def test_malformed_reference_is_never_imported(scene, path):
    adapter, casts, target, root = scene
    for cast in casts.values():
        cast['identities'][0]['voiceCandidates'][1]['referenceAudio'] = path
    assert adapter.apply('destination', root/'destination', [target], [], 'english', 'local-qwen') == {}


def test_symlink_escape_is_never_imported(scene):
    adapter, casts, target, root = scene
    outside = root/'outside'
    outside.mkdir()
    (outside/'chosen.reference.wav').write_bytes(b'outside')
    for name in casts:
        path = root/name/'voices'/'subaru'/'chosen.reference.wav'
        path.unlink()
        path.symlink_to(outside/'chosen.reference.wav')
    assert adapter.apply('destination', root/'destination', [target], [], 'english', 'local-qwen') == {}


def test_changed_sources_reject_stale_fingerprint_before_copy(scene):
    adapter, casts, target, root = scene
    preview = adapter.preview('destination', root/'destination', [target], [], 'english', 'local-qwen')
    casts['newer']['identities'][0]['voiceAccepted'] = False
    with pytest.raises(ValueError, match='changed'):
        adapter.apply('destination', root/'destination', [target], [], 'english', 'local-qwen',
                      preview_fingerprint=preview['fingerprint'])
    assert not (root/'destination').exists()


def test_generated_local_candidate_uses_preview_as_reference(scene):
    adapter, casts, target, root = scene
    for cast in casts.values():
        cast['identities'][0]['voiceCandidates'][1].pop('referenceAudio')
    preview = adapter.preview('destination', root/'destination', [target], [], 'english', 'local-qwen')
    target['lineCount'] = 20  # Runtime enrichment must not invalidate identity matching.
    result = adapter.apply('destination', root/'destination', [target], [], 'english', 'local-qwen',
                           preview_fingerprint=preview['fingerprint'])['new-subaru']
    assert (root/'destination'/result['referenceAudio']).read_bytes() == b'newer-chosen'


def test_destination_symlink_cannot_write_outside_book(scene):
    adapter, _, target, root = scene
    destination = root/'destination'
    destination.mkdir()
    outside = root/'outside'
    outside.mkdir()
    (destination/'voices').symlink_to(outside)
    with pytest.raises(ValueError, match='outside'):
        adapter.apply('destination', destination, [target], [], 'english', 'local-qwen')
    assert not list(outside.iterdir())


def test_accepted_shared_voice_copies_anchor_preview_and_reference(scene):
    adapter, casts, target, root = scene
    for book_id, cast in casts.items():
        (root/book_id/'voices'/'subaru').rename(root/book_id/'voices'/'anchor')
        chosen = cast['identities'][0]['voiceCandidates'][1]
        chosen.update(source='shared', sharedVoiceGroupId='group',
                      referenceAudio='voices/anchor/chosen.reference.wav',
                      previewUrl=f'/api/books/{book_id}/voices/anchor/chosen/audio')
    result = adapter.apply('destination', root/'destination', [target], [], 'english', 'local-qwen')['new-subaru']
    reference = root/'destination'/result['referenceAudio']
    assert reference.read_bytes() == b'newer-identity'
    assert reference.with_name(result['voicePreviewRevision']+'.wav').read_bytes() == b'newer-chosen'
    assert '/voices/new-subaru/' in result['previewUrl']
    assert 'anchor' not in result['referenceAudio']


def test_destination_must_be_in_supplied_store(scene):
    adapter, _, target, root = scene
    with pytest.raises(ValueError, match='Destination book'):
        adapter.apply('unknown', root/'unknown', [target], [], 'english', 'local-qwen')
    assert not (root/'unknown').exists()


def test_default_adapter_reads_latest_approved_history_not_unapproved_active_cast(scene):
    from meowdiobooks.backend.artifacts import write_artifact
    adapter, casts, target, root = scene
    for book_id, cast in casts.items():
        write_artifact(root/book_id, 'cast', {**cast, 'revision': 'approved', 'phase': 'accepted'}, publish=False)
        write_artifact(root/book_id, 'cast', {**cast, 'revision': 'draft', 'status': 'needs-voice-review', 'phase': 'audition-review'})
    local = LocalVoiceReuse(books=adapter.books, package_for_book=adapter.package_for_book)
    result = local.apply('destination', root/'destination', [target], [], 'english', 'local-qwen')
    assert result['new-subaru']['previousBookTitle'] == 'Subaru two'
    # New approval with no selected voices supersedes that book's previous approved cast.
    write_artifact(root/'newer', 'cast', {**casts['newer'], 'revision': 'approved-empty',
        'phase': 'accepted', 'identities': []}, publish=False)
    result = local.apply('destination', root/'destination', [target], [], 'english', 'local-qwen')
    assert result['new-subaru']['previousBookTitle'] == 'Subaru one'
