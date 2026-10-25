from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen.canvas import Canvas

from meowdiobooks.backend.app_v2 import create_app_v2


def source_pdf():
    output = BytesIO()
    document = Canvas(output)
    document.drawString(72, 720, 'A small synthetic book.')
    document.save()
    return output.getvalue()


@pytest.mark.parametrize('limit', [0, -1, True, 1.5, '100', 500_000_001])
def test_invalid_import_limit_fails_at_composition(tmp_path, limit):
    with pytest.raises(ValueError, match='max_import_bytes'):
        create_app_v2(tmp_path, max_import_bytes=limit)


def test_file_limit_accepts_boundary_and_rejects_next_byte_without_writes(tmp_path):
    raw = source_pdf()
    app = create_app_v2(tmp_path, max_import_bytes=len(raw))
    with TestClient(app) as client:
        rejected = client.post('/api/books/import', files={'file': ('large.pdf', raw + b' ')})
        assert rejected.status_code == 413
        assert app.state.books.all() == []
        assert not list(tmp_path.rglob('original.pdf'))
        accepted = client.post('/api/books/import', files={'file': ('fits.pdf', raw)})
        assert accepted.status_code == 201
        assert len(app.state.books.all()) == 1


def test_limit_precedes_document_parser(tmp_path):
    app = create_app_v2(tmp_path, max_import_bytes=8)
    with TestClient(app) as client:
        response = client.post('/api/books/import', files={'file': ('invalid.pdf', b'not a PDF' * 10)})
        assert response.status_code == 413
        assert app.state.books.all() == []
