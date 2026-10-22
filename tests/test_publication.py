from pathlib import Path

import pytest

from scripts.check_publication import check_files, check_licenses


def test_publication_checks_links_and_images_with_encoded_paths(tmp_path: Path):
    (tmp_path / 'picture name.png').write_bytes(b'fixture')
    (tmp_path / 'README.md').write_text(
        '[image](picture%20name.png)\n<img src="picture name.png">\n'
        '[missing](gone.md)\n![missing image](gone.png)\n'
        '[external](https://example.com/no-file)\n[section](#section)\n'
    )
    assert check_files(tmp_path, ['README.md']) == [
        'README.md: missing local link gone.md',
        'README.md: missing local link gone.png',
    ]


def test_publication_rejects_private_material_but_allows_documented_fixtures(tmp_path: Path):
    names = ['.env', '.env.example', 'private.pdf', 'private.key',
             'SampleBooks/public-domain-evaluation/example.pdf', '.review-evidence/report.json']
    for name in names:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('fixture')
    errors = check_files(tmp_path, names)
    assert len(errors) == 4
    assert not any('.env.example' in error or 'SampleBooks/' in error for error in errors)


def test_publication_reports_personal_paths_without_printing_values(tmp_path: Path):
    (tmp_path / 'README.md').write_text('Output: ' + '/'.join(['', 'Users', 'private-user', 'private-book', '']))
    assert check_files(tmp_path, ['README.md']) == ['README.md: personal filesystem path']


def test_publication_rejects_drifted_package_license(tmp_path: Path):
    (tmp_path / 'LICENSE').write_text('canonical license')
    for name in ('frontend/LICENSE', 'release/python/LICENSE'):
        path = tmp_path / name
        path.parent.mkdir(parents=True)
        path.write_text('canonical license')
    assert check_licenses(tmp_path) == []
    (tmp_path / 'frontend/LICENSE').write_text('obsolete license')
    assert check_licenses(tmp_path) == ['frontend/LICENSE: must match the root LICENSE']


@pytest.mark.parametrize('name', ['output.txt', 'page.html', 'theme.css', 'bundle.js', 'build.log', 'NOTICE'])
def test_publication_scans_text_regardless_of_extension(tmp_path: Path, name: str):
    (tmp_path / name).write_text('/'.join(['', 'Users', 'private-user', 'book', '']))
    assert check_files(tmp_path, [name]) == [f'{name}: personal filesystem path']


def test_publication_skips_binary_files(tmp_path: Path):
    (tmp_path / 'image.png').write_bytes(b'\x89PNG\x00\xff')
    assert check_files(tmp_path, ['image.png']) == []
