"""OCR preview/full-book parity and evidence-based recommendations."""
import json
from pathlib import Path
import subprocess

from PIL import Image
import pytest
from reportlab.pdfgen.canvas import Canvas

from meowdiobooks.backend.documents import extract_full_document, extract_pdf_page


RECOVERED = (
    'Student evaluation. Academic ability is strong and the interview shows room for growth. '
    'The instructor describes a thoughtful person who should participate more actively in class. '
    'Friends and cooperation are important parts of school life.'
)


def source(tmp_path, *, image=True, pages=1):
    path = tmp_path / 'source.pdf'
    canvas = Canvas(str(path), pagesize=(400, 600))
    for _ in range(pages):
        if image:
            canvas.drawInlineImage(Image.new('RGB', (200, 300), 'white'), 50, 150, 300, 400)
        canvas.drawString(20, 20, 'Page 115 Publisher')
        canvas.showPage()
    canvas.save()
    return path


def runner(calls, *, recovered=RECOVERED, fail=False, full_pages=1):
    def run(command, **options):
        calls.append(command)
        if command[1] == 'is-complex':
            stats = [{'pageNumber': n, 'textLength': 1800} for n in range(1, int(command[-1]) + 1)]
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(stats).encode())
        ocr = '--no-ocr' not in command
        if fail and ocr:
            raise subprocess.CalledProcessError(1, command)
        text = recovered if ocr else 'Page 115 Publisher'
        pages = [{'page': n, 'text': text} for n in range(1, full_pages + 1)]
        if '--target-pages' in command:
            pages = [{'page': int(command[command.index('--target-pages') + 1]), 'text': text}]
        Path(command[-1]).write_text(json.dumps({'pages': pages}))
        return subprocess.CompletedProcess(command, 0)
    return run


def test_raw_standard_parser_stays_ocr_free_before_automatic_fallback_and_caches_separately(tmp_path):
    pdf, cache, calls = source(tmp_path), tmp_path / 'cache', []
    run = runner(calls)
    preview = extract_pdf_page(pdf, cache, 1, 'liteparse', command_runner=run)
    assert preview['text'] == 'Page 115 Publisher'
    assert preview['method'] == 'liteparse' and len(calls) == 2
    assert calls[1][1] == 'is-complex'
    ocr = extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=run)
    assert ocr['text'] == RECOVERED
    assert '--no-ocr' in calls[0] and '--no-ocr' not in calls[2]
    assert extract_pdf_page(pdf, cache, 1, 'liteparse', command_runner=run)['text'] == preview['text']
    assert extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=run)['cached'] is True
    assert len(calls) == 3


def test_failed_explicit_ocr_does_not_damage_standard_and_can_retry(tmp_path):
    pdf, cache = source(tmp_path), tmp_path / 'cache'
    preview = extract_pdf_page(pdf, cache, 1, 'liteparse', command_runner=runner([]))
    with pytest.raises(subprocess.CalledProcessError):
        extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=runner([], fail=True))
    assert extract_pdf_page(pdf, cache, 1, 'liteparse', command_runner=runner([]))['text'] == preview['text']
    assert extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=runner([]))['text'] == RECOVERED


def test_full_ocr_reuses_preview_cache_and_preserves_complete_physical_pages(tmp_path):
    calls = []
    pdf, cache = source(tmp_path, pages=2), tmp_path / 'cache'
    run = runner(calls)
    preview = extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=run)
    rows = extract_full_document(pdf, cache, 'ocr', command_runner=run)
    assert [r['page'] for r in rows] == [1, 2]
    assert all(r['method'] == 'ocr' and r['text'] == RECOVERED for r in rows)
    assert rows[0]['text'] == preview['text']
    assert all('--no-ocr' not in command for command in calls)
    assert len(calls) == 2
    extract_full_document(pdf, cache, 'ocr', command_runner=runner(calls, fail=True))
    assert len(calls) == 2


def test_incomplete_ocr_is_rejected_and_retry_does_not_reuse_it(tmp_path):
    pdf, cache = source(tmp_path), tmp_path / 'cache'

    def empty(command, **_options):
        Path(command[-1]).write_text('{"pages": []}')

    with pytest.raises(ValueError, match='requested page'):
        extract_full_document(pdf, cache, 'ocr', command_runner=empty)
    assert not list(cache.rglob('page-0001.json'))
    assert len(extract_full_document(pdf, cache, 'ocr', command_runner=runner([]))) == 1


def test_concurrent_ocr_previews_use_independent_temporary_files(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    pdf, cache, paths = source(tmp_path), tmp_path / 'cache', []
    barrier = Barrier(2)

    def run(command, **_options):
        output = Path(command[-1])
        paths.append(output)
        output.write_text(json.dumps({'pages': [{'page': 1, 'text': RECOVERED}]}))
        barrier.wait(timeout=5)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(extract_pdf_page, pdf, cache, 1, 'ocr', command_runner=run)
                   for _ in range(2)]
        assert all(f.result()['text'] == RECOVERED for f in futures)
    assert len(set(paths)) == 2
    assert not list(cache.rglob('*.raw.json'))


def test_whole_book_screen_targets_interior_image_pages_without_running_ocr(tmp_path):
    from meowdiobooks.backend.documents import extraction_sample_pages

    stats = [{'pageNumber': n, 'textLength': 1800, 'imageCoverage': .01,
              'needsOcr': True, 'reasons': ['vector-text']} for n in range(1, 224)]
    # A cover, a blank digital page, and a sparse interior image-text page.
    stats[0].update(textLength=0, fullPageImage=True)
    stats[20].update(textLength=0, imageCoverage=0, fullPageImage=False)
    stats[114].update(textLength=45, imageCoverage=.65)
    stats[172].update(textLength=20, fullPageImage=True)
    calls = []

    def scan(command, **options):
        calls.append(command)
        assert command[1] == 'is-complex' and options['check'] is False
        return subprocess.CompletedProcess(command, 1, stdout=json.dumps(stats).encode())

    rows = extraction_sample_pages(tmp_path / 'source.pdf', tmp_path / 'cache', 223,
                                   command_runner=scan)
    probes = [row for row in rows if row.get('ocrCandidate')]
    assert {row['page'] for row in probes} == {115, 173}
    assert len(calls) == 1 and len(rows) <= 7
    assert extraction_sample_pages(tmp_path / 'source.pdf', tmp_path / 'cache', 223,
                                   command_runner=scan) == rows
    assert len(calls) == 1


@pytest.mark.parametrize('returncode,payload', [(1, b'not json'), (1, b'[]'), (2, b'[]')])
def test_failed_or_incomplete_screen_preserves_manual_samples(tmp_path, returncode, payload):
    from meowdiobooks.backend.documents import extraction_sample_pages, representative_pages

    def scan(command, **_options):
        return subprocess.CompletedProcess(command, returncode, stdout=payload)

    assert extraction_sample_pages(tmp_path / 'source.pdf', tmp_path, 5,
                                   command_runner=scan) == representative_pages(5)


def test_high_page_candidate_and_white_raster_cannot_recommend_from_metadata_alone(tmp_path):
    from meowdiobooks.backend.documents import extraction_sample_pages

    stats = [{'pageNumber': n, 'textLength': 2000} for n in range(1, 1201)]
    stats[1100].update(textLength=0, fullPageImage=True)

    def scan(command, **_options):
        assert command[-1] == '1200'
        return subprocess.CompletedProcess(command, 1, stdout=json.dumps(stats).encode())

    rows = extraction_sample_pages(tmp_path / 'source.pdf', tmp_path, 1200, command_runner=scan)
    assert rows[0] == {'page': 1101, 'reason': 'image text check', 'ocrCandidate': True}
    assert 'recommendation' not in rows[0]


@pytest.mark.parametrize('payload', ['{truncated', '{}', '{"pages":null,"imagePages":[]}',
                                    '{"pages":[{"page":999,"reason":"bad"}],"imagePages":[]}'])
def test_corrupt_optional_screen_cache_cannot_break_standard_extraction(tmp_path, payload):
    from meowdiobooks.backend.documents import extraction_sample_pages, representative_pages
    pdf, cache = source(tmp_path), tmp_path / 'cache'
    cached = cache / 'extraction/ocr-samples-v2.json'
    cached.parent.mkdir(parents=True)
    cached.write_text(payload)
    assert extraction_sample_pages(pdf, cache, 1, command_runner=lambda *_a, **_k:
        subprocess.CompletedProcess([], 1, stdout=b'not json')) == representative_pages(1)
    calls = []
    rows = extract_full_document(pdf, cache, 'liteparse', command_runner=runner(calls))
    assert rows[0]['text'] == 'Page 115 Publisher'
    assert all('--ocr-language' not in command for command in calls)


def test_standard_full_extraction_rejects_truncation_instead_of_publishing_it(tmp_path):
    pdf, cache = source(tmp_path, pages=2), tmp_path / 'cache'
    with pytest.raises(ValueError, match='every source page'):
        extract_full_document(pdf, cache, 'liteparse', command_runner=runner([], full_pages=1))
    assert not list(cache.rglob('full.json'))
    assert len(extract_full_document(pdf, cache, 'liteparse', command_runner=runner([], full_pages=2))) == 2
