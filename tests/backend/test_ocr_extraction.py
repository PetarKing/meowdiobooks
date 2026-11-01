"""OCR preview/full-book parity and evidence-based recommendations."""
import json
import os
from pathlib import Path
import shutil
import subprocess

from PIL import Image
import pytest
from reportlab.pdfgen.canvas import Canvas

from meowdiobooks.backend.documents import extract_full_document, extract_pdf_page
from tests.backend.ocr_stub_files import read_stub_pdf, write_stub_png, write_stub_text


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


def runner(calls, *, root, recovered=RECOVERED, fail=False, full_pages=1):
    def run(command, **options):
        calls.append(command)
        if command[0] == 'pdftoppm':
            write_stub_png(root, command[-1] + '.png')
            return subprocess.CompletedProcess(command, 0)
        if command[1] == 'is-complex':
            stats = [{'pageNumber': n, 'textLength': 1800} for n in range(1, int(command[-1]) + 1)]
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(stats).encode())
        ocr = '--no-ocr' not in command
        if ocr:
            image_only = read_stub_pdf(root, command[2])
            assert len(image_only.pages) == 1 and not image_only.pages[0].extract_text()
            assert command[command.index('--target-pages') + 1] == '1'
            assert command[command.index('--max-pages') + 1] == '1'
        if fail and ocr:
            raise subprocess.CalledProcessError(1, command)
        text = recovered if ocr else 'Page 115 Publisher'
        pages = [{'page': n, 'text': text} for n in range(1, full_pages + 1)]
        if '--target-pages' in command:
            pages = [{'page': int(command[command.index('--target-pages') + 1]), 'text': text}]
        write_stub_text(root, command[-1], json.dumps({'pages': pages}))
        return subprocess.CompletedProcess(command, 0)
    return run


def test_raw_standard_parser_stays_ocr_free_before_automatic_fallback_and_caches_separately(tmp_path):
    pdf, cache, calls = source(tmp_path), tmp_path / 'cache', []
    run = runner(calls, root=tmp_path)
    preview = extract_pdf_page(pdf, cache, 1, 'liteparse', command_runner=run)
    assert preview['text'] == 'Page 115 Publisher'
    assert preview['method'] == 'liteparse' and len(calls) == 2
    assert calls[1][1] == 'is-complex'
    ocr = extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=run)
    assert ocr['text'] == RECOVERED
    assert '--no-ocr' in calls[0] and '--no-ocr' not in calls[3]
    assert extract_pdf_page(pdf, cache, 1, 'liteparse', command_runner=run)['text'] == preview['text']
    assert extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=run)['cached'] is True
    assert len(calls) == 4


def test_failed_explicit_ocr_does_not_damage_standard_and_can_retry(tmp_path):
    pdf, cache = source(tmp_path), tmp_path / 'cache'
    preview = extract_pdf_page(pdf, cache, 1, 'liteparse', command_runner=runner([], root=tmp_path))
    with pytest.raises(subprocess.CalledProcessError):
        extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=runner([], root=tmp_path, fail=True))
    assert extract_pdf_page(pdf, cache, 1, 'liteparse', command_runner=runner([], root=tmp_path))['text'] == preview['text']
    assert extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=runner([], root=tmp_path))['text'] == RECOVERED


def test_full_ocr_reuses_preview_cache_and_preserves_complete_physical_pages(tmp_path):
    calls = []
    pdf, cache = source(tmp_path, pages=2), tmp_path / 'cache'
    run = runner(calls, root=tmp_path)
    preview = extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=run)
    rows = extract_full_document(pdf, cache, 'ocr', command_runner=run)
    assert [r['page'] for r in rows] == [1, 2]
    assert all(r['method'] == 'ocr' and r['text'] == RECOVERED for r in rows)
    assert rows[0]['text'] == preview['text']
    assert all('--no-ocr' not in command for command in calls)
    assert len(calls) == 4
    extract_full_document(pdf, cache, 'ocr', command_runner=runner(calls, root=tmp_path, fail=True))
    assert len(calls) == 4


def test_incomplete_ocr_is_rejected_and_retry_does_not_reuse_it(tmp_path):
    pdf, cache = source(tmp_path), tmp_path / 'cache'

    def empty(command, **_options):
        if command[0] == 'pdftoppm':
            write_stub_png(tmp_path, command[-1] + '.png')
            return
        write_stub_text(tmp_path, command[-1], '{"pages": []}')

    with pytest.raises(ValueError, match='requested page'):
        extract_full_document(pdf, cache, 'ocr', command_runner=empty)
    assert not list(cache.rglob('page-0001.json'))
    assert not list(cache.rglob('ocr-render-*'))
    assert len(extract_full_document(pdf, cache, 'ocr', command_runner=runner([], root=tmp_path))) == 1


def test_concurrent_ocr_previews_use_independent_temporary_files(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    pdf, cache, paths = source(tmp_path), tmp_path / 'cache', []
    barrier = Barrier(2)

    def run(command, **_options):
        if command[0] == 'pdftoppm':
            write_stub_png(tmp_path, command[-1] + '.png')
            return
        output = command[-1]
        paths.append(output)
        write_stub_text(tmp_path, output, json.dumps({'pages': [{'page': 1, 'text': RECOVERED}]}))
        barrier.wait(timeout=5)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(extract_pdf_page, pdf, cache, 1, 'ocr', command_runner=run)
                   for _ in range(2)]
        assert all(f.result()['text'] == RECOVERED for f in futures)
    assert len(set(paths)) == 2
    assert not list(cache.rglob('*.raw.json'))
    assert not list(cache.rglob('ocr-render-*'))


def test_raster_ocr_maps_internal_page_one_back_to_physical_page_and_preserves_existing_preview(tmp_path):
    pdf, cache, calls = source(tmp_path, pages=2), tmp_path / 'cache', []
    cached_image = cache / 'pages/page-0002.png'
    cached_image.parent.mkdir(parents=True)
    Image.new('RGB', (400, 600), 'white').save(cached_image)
    before = cached_image.read_bytes()
    result = extract_pdf_page(pdf, cache, 2, 'ocr', command_runner=runner(calls, root=tmp_path))
    assert result['page'] == 2 and result['text'] == RECOVERED
    assert [call[0] for call in calls] == ['liteparse']
    assert calls[0][calls[0].index('--target-pages') + 1] == '1'
    assert cached_image.read_bytes() == before
    assert not list(cache.rglob('visible-page.pdf'))


def test_old_mixed_text_layer_ocr_cache_is_not_used_as_a_raster_result(tmp_path):
    pdf, cache, calls = source(tmp_path), tmp_path / 'cache', []
    old = cache / 'extraction/liteparse-ocr-eng-v1/page-0001.json'
    old.parent.mkdir(parents=True)
    old.write_text(json.dumps({'page': 1, 'text': 'Old saved layer only', 'method': 'ocr'}))
    result = extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=runner(calls, root=tmp_path))
    assert result['text'] == RECOVERED and result['cached'] is False
    assert [call[0] for call in calls] == ['pdftoppm', 'liteparse']
    assert old.exists()


@pytest.mark.parametrize('wrong_page', [2, True, None])
def test_raster_ocr_rejects_wrong_internal_page_identity_and_cleans_up(tmp_path, wrong_page):
    pdf, cache = source(tmp_path, pages=2), tmp_path / 'cache'

    def command(arguments, **_options):
        if arguments[0] == 'pdftoppm':
            write_stub_png(tmp_path, arguments[-1] + '.png')
        else:
            write_stub_text(tmp_path, arguments[-1], json.dumps({'pages': [{'page': wrong_page, 'text': RECOVERED}]}))

    with pytest.raises(ValueError, match='requested page'):
        extract_pdf_page(pdf, cache, 2, 'ocr', command_runner=command)
    assert not list(cache.rglob('ocr-render-*'))
    assert not list(cache.rglob('*.raw.json'))
    assert not list(cache.rglob('page-0002.json'))


def test_raster_conversion_rejects_oversized_image_before_loading_pixels(tmp_path, monkeypatch):
    pdf, cache = source(tmp_path), tmp_path / 'cache'
    real_open = Image.open

    def oversized(*args, **kwargs):
        trusted_root = os.path.realpath(tmp_path)
        candidate = os.path.realpath(args[0])
        if not candidate.startswith(trusted_root + os.sep):
            raise ValueError('Stub path is outside the trusted test directory')
        image = real_open(candidate, *args[1:], **kwargs)
        image._size = (20_000, 20_000)
        return image

    monkeypatch.setattr(Image, 'open', oversized)
    with pytest.raises(ValueError, match='safe processing limits'):
        extract_pdf_page(pdf, cache, 1, 'ocr', command_runner=runner([], root=tmp_path))
    assert not list(cache.rglob('ocr-render-*'))


@pytest.mark.parametrize('operation', ['json', 'png', 'pdf'])
@pytest.mark.parametrize('escape', ['absolute', 'traversal', 'sibling-prefix', 'symlink'])
def test_command_stub_files_cannot_escape_the_explicit_test_root(tmp_path, operation, escape):
    root = tmp_path / 'owned'
    root.mkdir()
    outside = tmp_path / ('owned-other' if escape == 'sibling-prefix' else 'external')
    outside.mkdir()
    sentinel = outside / 'sentinel.json'
    sentinel.write_text('Keep this outside file unchanged.')
    if escape == 'absolute':
        candidate = sentinel
    elif escape == 'traversal':
        inner = root / 'inner'
        inner.mkdir()
        candidate = inner / '..' / '..' / outside.name / 'sentinel.json'
    elif escape == 'sibling-prefix':
        candidate = outside / 'sentinel.json'
    else:
        link = root / 'redirect'
        link.symlink_to(outside, target_is_directory=True)
        candidate = link / 'sentinel.json'
    with pytest.raises(ValueError, match='outside the trusted test directory'):
        if operation == 'json':
            write_stub_text(root, candidate, 'Must not overwrite')
        elif operation == 'png':
            write_stub_png(root, candidate)
        else:
            read_stub_pdf(root, candidate)
    assert sentinel.read_text() == 'Keep this outside file unchanged.'


def test_injected_command_runner_rejects_unowned_read_and_write_paths(tmp_path):
    root = tmp_path / 'owned'
    root.mkdir()
    outside = tmp_path / 'outside.pdf'
    outside.write_text('Must not read or replace this file.')
    run = runner([], root=root)
    with pytest.raises(ValueError, match='outside the trusted test directory'):
        run(['liteparse', 'parse', str(root / 'input.pdf'), '--no-ocr', '-o', str(outside)])
    with pytest.raises(ValueError, match='outside the trusted test directory'):
        run(['liteparse', 'parse', str(outside), '--target-pages', '1', '--max-pages', '1',
             '--ocr-language', 'eng', '-o', str(root / 'output.json')])
    with pytest.raises(ValueError, match='outside the trusted test directory'):
        run(['pdftoppm', '-f', '1', '-l', '1', str(root / 'input.pdf'), str(tmp_path / 'outside')])
    assert outside.read_text() == 'Must not read or replace this file.'
    assert not (tmp_path / 'outside.png').exists()
    assert not (root / 'output.json').exists()


def conflicting_text_pdf(tmp_path):
    """Synthetic visible raster text plus deliberately conflicting invisible PDF text."""
    from PIL import ImageDraw, ImageFont

    image = Image.new('RGB', (1400, 700), 'white')
    font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
    if not Path(font_path).is_file():
        font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    if not Path(font_path).is_file():
        pytest.skip('Requires an explicitly available synthetic test font')
    font = ImageFont.truetype(font_path, 58)
    ImageDraw.Draw(image).text((60, 90), 'VISIBLE GARDEN STORY WORDS', fill='black', font=font)
    bitmap = tmp_path / 'visible.png'
    image.save(bitmap)
    pdf = tmp_path / 'conflicting-text.pdf'
    canvas = Canvas(str(pdf))
    canvas.drawString(50, 700, 'FIRST SOURCE PAGE')
    canvas.showPage()
    canvas.drawImage(str(bitmap), 30, 400, width=550, height=275)
    hidden = canvas.beginText(50, 300)
    hidden.setTextRenderMode(3)
    hidden.textLine('HIDDEN SEARCH LAYER MUST NOT REPLACE VISIBLE WORDS')
    canvas.drawText(hidden)
    canvas.save()
    return pdf


@pytest.mark.skipif(os.getenv('MEOWDIOBOOKS_TEST_RASTER_OCR') != '1'
                    or not shutil.which('liteparse') or not shutil.which('pdftoppm'),
                    reason='Requires explicit installed offline Tesseract/LiteParse OCR runtime')
def test_real_full_ocr_reads_visible_image_instead_of_conflicting_saved_layer(tmp_path):
    pdf, cache = conflicting_text_pdf(tmp_path), tmp_path / 'cache'
    native = extract_pdf_page(pdf, cache, 2, 'native')
    assert 'HIDDEN SEARCH LAYER' in native['text'] and 'VISIBLE GARDEN' not in native['text']
    recovered = extract_pdf_page(pdf, cache, 2, 'ocr')
    assert recovered['page'] == 2
    assert 'VISIBLE GARDEN STORY WORDS' in recovered['text']
    assert 'HIDDEN SEARCH LAYER' not in recovered['text']
    full = extract_full_document(pdf, cache, 'ocr')
    assert [row['page'] for row in full] == [1, 2]
    assert 'FIRST SOURCE PAGE' in full[0]['text']
    assert full[1]['text'] == recovered['text']
    assert not list(cache.rglob('ocr-render-*'))


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
    rows = extract_full_document(pdf, cache, 'liteparse', command_runner=runner(calls, root=tmp_path))
    assert rows[0]['text'] == 'Page 115 Publisher'
    assert all('--ocr-language' not in command for command in calls)


def test_standard_full_extraction_rejects_truncation_instead_of_publishing_it(tmp_path):
    pdf, cache = source(tmp_path, pages=2), tmp_path / 'cache'
    with pytest.raises(ValueError, match='every source page'):
        extract_full_document(pdf, cache, 'liteparse', command_runner=runner([], root=tmp_path, full_pages=1))
    assert not list(cache.rglob('full.json'))
    assert len(extract_full_document(pdf, cache, 'liteparse', command_runner=runner([], root=tmp_path, full_pages=2))) == 2
