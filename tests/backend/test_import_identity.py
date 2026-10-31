from hashlib import sha256
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen.canvas import Canvas

from meowdiobooks.backend.app_v2 import create_app_v2


def pdf(text="Import identity"):
    output = BytesIO()
    document = Canvas(output)
    document.drawString(72, 720, text)
    document.save()
    return output.getvalue()


def test_default_import_identity_and_host_resolver_keep_source_hash(tmp_path):
    raw = pdf()
    digest = sha256(raw).hexdigest()
    with TestClient(create_app_v2(tmp_path / "local")) as client:
        book = client.post("/api/books/import", files={"file": ("a.pdf", raw)}).json()["book"]
        assert book["id"] == f"book_{digest[:20]}"
        assert book["source_hash"] == digest
    observed = []

    def identity(source_hash):
        observed.append(source_hash)
        return "host_book_123"

    with TestClient(create_app_v2(tmp_path / "host", book_id_for_source=identity)) as client:
        first = client.post("/api/books/import", files={"file": ("a.pdf", raw)}).json()
        second = client.post("/api/books/import", files={"file": ("b.pdf", raw)}).json()
        assert first["book"]["id"] == "host_book_123"
        assert first["book"]["source_hash"] == digest
        assert second["duplicate"] is True
        assert observed == [digest, digest]


def test_resolver_collision_cannot_return_another_sources_book(tmp_path):
    app = create_app_v2(tmp_path, book_id_for_source=lambda _: "host_book")
    with TestClient(app) as client:
        first = client.post("/api/books/import", files={"file": ("a.pdf", pdf("first"))}).json()
        response = client.post("/api/books/import", files={"file": ("b.pdf", pdf("second"))})
        assert response.status_code == 409
        assert app.state.books.get("host_book").source_hash == first["book"]["source_hash"]
        assert len(app.state.books.all()) == 1


@pytest.mark.parametrize("identity", ["../outside", "/outside", "a/b", "a\\b", "", ".", 42])
def test_resolver_rejects_unsafe_identity_before_writing(tmp_path, identity):
    app = create_app_v2(tmp_path, book_id_for_source=lambda _: identity)
    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.post("/api/books/import", files={"file": ("a.pdf", pdf())}).status_code == 500
        assert app.state.books.all() == []
        assert list(tmp_path.rglob("original.pdf")) == []
