"""Execution-boundary compatibility and failure tests without external programs."""
import json
from pathlib import Path
import shutil
import subprocess
import wave
import zipfile

import pytest

from meowdiobooks.backend.documents import extract_full_document, extract_pdf_page, render_pdf_page
from meowdiobooks.backend.m4b import M4BChapter, M4BExportError, package_audio_export
from meowdiobooks.backend.models import AudioExportPreset


_OPERATIONS = ['render', 'page', 'full', 'm4b', 'mp3']


@pytest.fixture
def operation(tmp_path):
    source = tmp_path / 'book.pdf'
    from reportlab.pdfgen.canvas import Canvas
    canvas = Canvas(str(source))
    for page in range(2):
        canvas.drawString(50, 700, f'Source page {page + 1}')
        canvas.showPage()
    canvas.save()
    cover = tmp_path / 'cover.png'
    cover.write_bytes(b'synthetic-cover')
    audio = tmp_path / 'chapter.wav'
    with wave.open(str(audio), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes(b'\0\0' * 2400)
    chapters = [M4BChapter('first', 'First chapter', audio), M4BChapter('second', 'Second chapter', audio)]
    work = tmp_path / 'work'

    def invoke(name, **options):
        if name == 'render':
            return render_pdf_page(source, work, 2, **options)
        if name == 'page':
            return extract_pdf_page(source, work, 2, 'liteparse', **options)
        if name == 'full':
            return extract_full_document(source, work, 'liteparse', **options)
        preset = AudioExportPreset.MP3_CHAPTERS if name == 'mp3' else AudioExportPreset.M4B_HIGH
        return package_audio_export(chapters, work / ('book.zip' if name == 'mp3' else 'book.m4b'),
            title='A Book', author='An Author', cover=cover, description='Description',
            preset=preset, ffmpeg='/host-tools/ffmpeg', **options)

    return invoke, work


def _successful_command(command, **options):
    assert options['check'] is (command[1] != 'is-complex') and options['capture_output'] is True
    assert options['timeout'] > 0
    if command[0] == 'pdftoppm':
        Path(command[-1] + '.png').write_bytes(b'host-rendered-png')
    elif command[0] == 'liteparse' and command[1] == 'is-complex':
        return subprocess.CompletedProcess(command, 0, stdout=b'[]', stderr=b'')
    elif command[0] == 'liteparse':
        pages = [{'page': 2, 'text': 'The second page.'}] if '--target-pages' in command else [
            {'page': 1, 'text': 'The first page.'}, {'page': 2, 'text': 'The second page.'},
        ]
        Path(command[-1]).write_text(json.dumps({'pages': pages}))
    else:
        assert command[0] == '/host-tools/ffmpeg'
        Path(command[-1]).write_bytes(b'encoded-audio')
    return subprocess.CompletedProcess(command, 0, stdout=b'', stderr=b'')


@pytest.mark.parametrize('name', _OPERATIONS)
@pytest.mark.parametrize('truthy', [True, False])
def test_injected_runner_retains_default_arguments_without_subprocess_fallback(
    operation, monkeypatch, name, truthy,
):
    invoke, work = operation
    default_calls, host_calls = [], []

    def default(command, **options):
        default_calls.append((command, options))
        return _successful_command(command, **options)

    monkeypatch.setattr(subprocess, 'run', default)
    invoke(name)
    shutil.rmtree(work)

    class Runner:
        def __bool__(self):
            return truthy

        def __call__(self, command, **options):
            host_calls.append((command, options))
            return _successful_command(command, **options)

    def forbidden(*_args, **_kwargs):
        pytest.fail('Host execution escaped to an unrestricted subprocess')

    monkeypatch.setattr(subprocess, 'run', forbidden)
    result = invoke(name, command_runner=Runner())
    # Parser output paths are unique per invocation to avoid preview races.
    def stable_calls(calls):
        return [(command[:-1] + ["<parser-output>"] if command[0] == 'liteparse' else command,
                 options) for command, options in calls]

    assert stable_calls(host_calls) == stable_calls(default_calls)
    assert len(host_calls) == (2 if name in {'mp3', 'page', 'full'} else 1)
    if name == 'render':
        assert result.read_bytes() == b'host-rendered-png'
    elif name == 'page':
        assert result['text'] == 'The second page.' and result['page'] == 2
    elif name == 'full':
        assert [page['text'] for page in result] == ['The first page.', 'The second page.']
    elif name == 'm4b':
        assert result.read_bytes() == b'encoded-audio'
    else:
        with zipfile.ZipFile(result) as archive:
            assert archive.namelist() == ['01 - First chapter.mp3', '02 - Second chapter.mp3']
            assert all(archive.read(name) == b'encoded-audio' for name in archive.namelist())


@pytest.mark.parametrize('name', _OPERATIONS)
def test_host_rejection_never_retries_default_runner(operation, monkeypatch, name):
    invoke, _work = operation
    calls = []

    def reject(command, **_options):
        calls.append(command)
        raise ValueError('Command rejected by host policy')

    def forbidden(*_args, **_kwargs):
        pytest.fail('Rejected command fell back to an unrestricted subprocess')

    monkeypatch.setattr(subprocess, 'run', forbidden)
    with pytest.raises(ValueError, match='rejected by host policy'):
        invoke(name, command_runner=reject)
    assert len(calls) == 1


@pytest.mark.parametrize('name', ['m4b', 'mp3'])
def test_host_timeout_preserves_packaging_failure_cleanup(operation, name):
    invoke, work = operation

    def timeout(command, **options):
        Path(command[-1]).write_bytes(b'incomplete-audio')
        raise subprocess.TimeoutExpired(command, options['timeout'])

    with pytest.raises(M4BExportError, match='within one hour'):
        invoke(name, command_runner=timeout)
    assert not (work / 'book.m4b').exists()
    assert not (work / 'book.zip').exists()
    assert not (work / 'mp3-chapters').exists()


def test_falsey_file_processor_still_handles_import_and_media(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from meowdiobooks.backend.app_v2 import create_app_v2
    from tests.backend.test_app_v2 import _pdf

    class Processor:
        def __bool__(self):
            return False

        def inspect_source(self, _source):
            return 'pdf', 1

        def pdf_metadata(self, _source):
            return {'title': 'Host-processed title'}

        def render_pdf_page(self, _source, cache, _page):
            output = cache / 'host.png'
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(b'host-preview')
            return output

    def forbidden(*_args, **_kwargs):
        pytest.fail('Falsey host processor was bypassed')

    for name in ('inspect_source', 'pdf_metadata', 'render_pdf_page'):
        monkeypatch.setattr(f'meowdiobooks.backend.app_v2.{name}', forbidden)
    monkeypatch.setattr('meowdiobooks.backend.api.media.render_pdf_page', forbidden)
    with TestClient(create_app_v2(tmp_path, file_processor=Processor())) as client:
        response = client.post('/api/books/import', files={'file': ('book.pdf', _pdf(), 'application/pdf')})
        assert response.status_code == 201, response.text
        book = response.json()['book']
        assert book['title'] == 'Host-processed title'
        assert client.get(f"/api/books/{book['id']}/pages/1/image").content == b'host-preview'


def test_falsey_page_renderer_is_not_bypassed(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from meowdiobooks.backend.api.media import create_media_router

    output = tmp_path / 'preview.png'
    output.write_bytes(b'host-preview')

    class Renderer:
        def __bool__(self):
            return False

        def __call__(self, *_args):
            return output

    def forbidden(*_args, **_kwargs):
        pytest.fail('Falsey host renderer was bypassed')

    monkeypatch.setattr('meowdiobooks.backend.api.media.render_pdf_page', forbidden)
    app = FastAPI()
    app.include_router(create_media_router(tmp_path,
        lambda _: SimpleNamespace(id='book', source_name='book.pdf', page_count=1),
        lambda _: tmp_path, page_renderer=Renderer()))
    with TestClient(app) as client:
        assert client.get('/api/books/book/pages/1/image').content == b'host-preview'
