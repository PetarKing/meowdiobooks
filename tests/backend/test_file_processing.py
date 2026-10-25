from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from meowdiobooks.backend.app_v2 import create_app_v2
from meowdiobooks.backend.transcription import TranscriptionDraft
from tests.backend.test_app_v2 import _pdf, _wait


def test_host_processor_receives_import_preview_extraction_and_normalization(tmp_path, monkeypatch):
    calls = []

    def forbidden(*_args, **_kwargs):
        pytest.fail('A parsing operation escaped the configured processor')

    for name in ('inspect_source', 'pdf_metadata', 'extract_pdf_page', 'extract_full_document',
                 'render_pdf_page', 'normalize_voice_sample'):
        monkeypatch.setattr(f'meowdiobooks.backend.app_v2.{name}', forbidden)
    monkeypatch.setattr('meowdiobooks.backend.api.media.render_pdf_page', forbidden)

    def inspect(source):
        calls.append('inspect')
        assert source.read_bytes().startswith(b'%PDF-')
        return 'pdf', 1

    def preview(source, cache, page):
        calls.append('image')
        path = cache / 'example.png'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'processed-image')
        return path

    def extract(source, cache, method, report):
        calls.append('extract')
        report(50, 'Restricted processing')
        return [{'page': 1, 'text': 'Chapter One\nA cat crossed the garden.', 'warnings': []}]

    def normalize(raw, filename):
        calls.append('normalize')
        assert raw == b'untrusted' and filename == 'voice.wav'
        return b'normalized', 4.0

    def transcribe(_root, _book, sample):
        assert sample.read_bytes() == b'normalized'
        return TranscriptionDraft('Hello', 'English')

    processor = SimpleNamespace(
        inspect_source=inspect, pdf_metadata=lambda _: {'title': 'Processed title'},
        render_pdf_page=preview,
        extract_pdf_page=lambda *_: {'page': 1, 'text': 'A cat crossed the garden.'},
        extract_full_document=extract, normalize_voice_sample=normalize,
    )
    with TestClient(create_app_v2(tmp_path, file_processor=processor,
                                voice_sample_transcriber=transcribe)) as client:
        imported = client.post('/api/books/import', files={'file': ('book.pdf', _pdf(), 'application/pdf')})
        assert imported.status_code == 201, imported.text
        book = imported.json()['book']
        assert book['title'] == 'Processed title'
        prefix = f"/api/books/{book['id']}"
        assert client.post(prefix + '/extraction/preview', json={'page': 1, 'method': 'native'}).status_code == 200
        assert client.get(prefix + '/pages/1/image').content == b'processed-image'
        job = client.post(prefix + '/stages/extract/process', json={'settings': {'method': 'native'}})
        assert _wait(client, job.json()['id'])['status'] == 'succeeded'
        response = client.post(prefix + '/voice-samples/transcribe',
                               files={'file': ('voice.wav', b'untrusted', 'audio/wav')})
        assert response.status_code == 200, response.text
    assert calls == ['inspect', 'image', 'image', 'extract', 'normalize']


def test_processor_metadata_failure_rejects_import_and_removes_new_source(tmp_path):
    inspected_sources = []

    def reject(source):
        assert source.is_file()
        inspected_sources.append(source)
        raise ValueError('Metadata rejected')

    processor = SimpleNamespace(inspect_source=lambda _: ('pdf', 1), pdf_metadata=reject,
                                render_pdf_page=lambda *_: None)
    with TestClient(create_app_v2(tmp_path, file_processor=processor)) as client:
        result = client.post('/api/books/import', files={'file': ('book.pdf', _pdf(), 'application/pdf')})
        assert result.status_code == 422
        assert client.get('/api/books').json() == []
    assert len(inspected_sources) == 1
    assert not inspected_sources[0].exists()
    assert not list(tmp_path.rglob('*.pdf'))


@pytest.mark.parametrize('operation', ['inspect', 'metadata', 'normalize', 'transcribe'])
def test_synchronous_host_processing_does_not_block_other_requests(tmp_path, operation):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    entered = Event()
    release = Event()
    armed = Event()

    def wait_if_selected(name):
        if armed.is_set() and operation == name:
            entered.set()
            release.wait()

    def inspect(_source):
        wait_if_selected('inspect')
        return 'pdf', 1

    def metadata(_source):
        wait_if_selected('metadata')
        return {}

    def normalize(_raw, _filename):
        wait_if_selected('normalize')
        return b'normalized', 4.0

    def transcribe(*_args):
        wait_if_selected('transcribe')
        return TranscriptionDraft('Hello', 'English')

    processor = SimpleNamespace(
        inspect_source=inspect, pdf_metadata=metadata,
        normalize_voice_sample=normalize, render_pdf_page=lambda *_: None,
    )
    with TestClient(create_app_v2(tmp_path, file_processor=processor,
                                voice_sample_transcriber=transcribe)) as client:
        imported = client.post('/api/books/import',
                               files={'file': ('first.pdf', _pdf(), 'application/pdf')})
        assert imported.status_code == 201
        book_id = imported.json()['book']['id']
        armed.set()
        if operation in {'inspect', 'metadata'}:
            endpoint = '/api/books/import'
            files = {'file': ('second.pdf', _pdf('A different book.'), 'application/pdf')}
            expected = 201
        else:
            endpoint = f'/api/books/{book_id}/voice-samples/transcribe'
            files = {'file': ('voice.wav', b'voice sample', 'audio/wav')}
            expected = 200
        with ThreadPoolExecutor(max_workers=2) as threads:
            processing = threads.submit(client.post, endpoint, files=files)
            try:
                assert entered.wait(timeout=5), 'Host operation was not entered'
                health = threads.submit(client.get, '/api/health')
                assert health.result(timeout=2).status_code == 200
                assert not processing.done()
            finally:
                release.set()
            assert processing.result(timeout=5).status_code == expected


def test_concurrent_duplicate_imports_parse_and_publish_only_once(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    entered = Event()
    release = Event()
    calls = []
    published = []

    def inspect(source):
        calls.append(source)
        entered.set()
        release.wait()
        return 'pdf', 1

    processor = SimpleNamespace(inspect_source=inspect, pdf_metadata=lambda _: {},
                                render_pdf_page=lambda *_: None)
    raw = _pdf()
    with TestClient(create_app_v2(tmp_path, file_processor=processor,
                                on_book_imported=lambda book, _: published.append(book.id))) as client:
        with ThreadPoolExecutor(max_workers=2) as threads:
            def upload():
                return client.post('/api/books/import',
                                   files={'file': ('book.pdf', raw, 'application/pdf')})

            first = threads.submit(upload)
            try:
                assert entered.wait(timeout=5)
                second = threads.submit(upload)
                assert client.get('/api/health').status_code == 200
            finally:
                release.set()
            responses = [future.result(timeout=5) for future in (first, second)]
        assert [response.status_code for response in responses] == [201, 201]
        payloads = [response.json() for response in responses]
        assert sorted(payload['duplicate'] for payload in payloads) == [False, True]
        assert payloads[0]['book']['id'] == payloads[1]['book']['id']
        assert len(client.get('/api/books').json()) == 1
    assert len(calls) == len(published) == 1
    assert calls[0].read_bytes() == raw
