"""Readable PDFs import; locked files retain classified, actionable guidance."""

import struct
from hashlib import sha256
from io import BytesIO
from zipfile import ZIP_BZIP2, ZIP_DEFLATED, ZipFile

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader, PdfWriter
from pypdf.errors import DependencyError
from reportlab.pdfgen.canvas import Canvas

from meowdiobooks.backend.app_v2 import create_app_v2
from meowdiobooks.backend.document_errors import DocumentImportError
from meowdiobooks.backend.documents import extract_pdf_page, inspect_source
from meowdiobooks.backend.text_documents import read_text_document

PDF_MESSAGE = "This PDF is encrypted or password-protected. Upload an unprotected copy to continue."
EPUB_MESSAGE = "This EPUB contains protected content. Upload an unprotected copy to continue."
COMPRESSION_MESSAGE = (
    "This EPUB uses unsupported compression. Upload another EPUB or a PDF, TXT, or Markdown file."
)


def _pdf(password, *, algorithm="RC4-128", unsupported_handler=False, metadata=True):
    plain = BytesIO()
    canvas = Canvas(plain, pagesize=(300, 200))
    canvas.drawString(20, 100, "A readable story behind an owner password.")
    canvas.save()
    writer = PdfWriter()
    writer.add_page(PdfReader(plain).pages[0])
    if metadata:
        writer.add_metadata({"/Title": "Readable story", "/Author": "Test author"})
    else:
        writer.metadata = None
    writer.encrypt(user_password=password, owner_password="owner-secret", algorithm=algorithm,
                   permissions_flag=4)
    output = BytesIO()
    writer.write(output)
    raw = output.getvalue()
    assert PdfReader(BytesIO(raw)).is_encrypted
    if unsupported_handler:
        # Keep byte offsets valid while selecting a nonstandard security handler.
        assert raw.count(b"/Filter /Standard") == 1
        raw = raw.replace(b"/Filter /Standard", b"/Filter /PubSecXX")
        with pytest.raises(NotImplementedError):
            PdfReader(BytesIO(raw))
    return raw


def _epub(protection):
    output = BytesIO()
    compression = ZIP_BZIP2 if protection == "compression" else ZIP_DEFLATED
    with ZipFile(output, "w", compression=compression) as archive:
        archive.writestr("mimetype", "application/epub+zip")
        archive.writestr("META-INF/container.xml", (
            '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'
        ))
        archive.writestr("book.opf", (
            '<package><manifest><item id="chapter" href="chapter.xhtml" '
            'media-type="application/xhtml+xml"/></manifest>'
            '<spine><itemref idref="chapter"/></spine></package>'
        ))
        archive.writestr("chapter.xhtml", "<html><body><p>A plain story.</p></body></html>")
        if protection == "manifest":
            archive.writestr("META-INF/encryption.xml", "<encryption/>")
    raw = bytearray(output.getvalue())
    if protection == "encrypted-bit":
        # zipfile cannot write encrypted ZIPs. Mark both directory and local headers;
        # rejection must happen before opening any protected member.
        for signature, flag_offset in [(b"PK\x03\x04", 6), (b"PK\x01\x02", 8)]:
            position = raw.index(signature) + flag_offset
            struct.pack_into("<H", raw, position, struct.unpack_from("<H", raw, position)[0] | 1)
        with ZipFile(BytesIO(raw)) as archive:
            assert archive.infolist()[0].flag_bits & 1
    return bytes(raw)


@pytest.mark.parametrize("password,algorithm,unsupported_handler", [
    ("reader-secret", "RC4-40", False), ("reader-secret", "RC4-128", False),
    ("reader-secret", "AES-128", False), ("reader-secret", "AES-256-R5", False),
    ("reader-secret", "AES-256", False),
    ("reader-secret", "RC4-128", True), ("", "RC4-128", True),
])
def test_real_encrypted_pdf_preserves_rejection_and_classifies_reason(
    tmp_path, password, algorithm, unsupported_handler,
):
    source = tmp_path / "protected.pdf"
    source.write_bytes(_pdf(password, algorithm=algorithm, unsupported_handler=unsupported_handler))
    with pytest.raises(DocumentImportError) as error:
        inspect_source(source)
    assert isinstance(error.value, ValueError)
    assert error.value.code == "encrypted-pdf"
    assert str(error.value) == PDF_MESSAGE


@pytest.mark.parametrize("algorithm", ["RC4-40", "RC4-128", "AES-128", "AES-256-R5", "AES-256"])
def test_passwordless_encrypted_pdf_imports_without_rewriting_and_extracts(tmp_path, algorithm):
    raw = _pdf("", algorithm=algorithm)
    with TestClient(create_app_v2(tmp_path)) as client:
        response = client.post("/api/books/import", files={"file": ("readable.pdf", raw)})
        assert response.status_code == 201, response.text
        book = response.json()["book"]
        assert book["source_hash"] == sha256(raw).hexdigest()
        assert (book["title"], book["author"], book["page_count"]) == (
            "Readable story", "Test author", 1,
        )
        source = tmp_path / "packages" / book["id"] / "source" / "original.pdf"
        assert source.read_bytes() == raw
        assert PdfReader(source).is_encrypted
        for method in ("native", "layout"):
            extracted = extract_pdf_page(source, source.parent / "cache", 1, method)
            assert "A readable story behind an owner password." in extracted["text"]
        duplicate = client.post("/api/books/import", files={"file": ("again.pdf", raw)})
        assert duplicate.status_code == 201
        assert duplicate.json()["duplicate"] is True
        assert duplicate.json()["book"]["source_hash"] == book["source_hash"]
        assert len(client.get("/api/books").json()) == 1


@pytest.mark.parametrize("failure", ["handler", "deferred", "metadata-free"])
def test_missing_crypto_support_preserves_classified_rejection_and_cleanup(tmp_path, monkeypatch, failure):
    raw = _pdf("", algorithm="AES-128", metadata=failure != "metadata-free")

    def unavailable(*_args, **_kwargs):
        raise DependencyError("Private crypto implementation diagnostic")

    if failure != "handler":
        from pypdf._crypt_providers import _fallback

        monkeypatch.setattr("pypdf._encryption.CryptAES", _fallback.CryptAES)
        monkeypatch.setattr("meowdiobooks.backend.documents.crypt_provider", _fallback.crypt_provider)
    else:
        monkeypatch.setattr("pypdf._reader.Encryption.read", unavailable)
    with TestClient(create_app_v2(tmp_path)) as client:
        response = client.post("/api/books/import", files={"file": ("readable.pdf", raw)})
        assert response.status_code == 422, response.text
        assert response.json()["detail"] == PDF_MESSAGE
        assert client.get("/api/books").json() == []
    assert not list(tmp_path.rglob("original.*"))


def test_fallback_crypto_still_imports_passwordless_rc4(tmp_path, monkeypatch):
    from pypdf._crypt_providers import _fallback

    raw = _pdf("", algorithm="RC4-128")
    monkeypatch.setattr("meowdiobooks.backend.documents.crypt_provider", _fallback.crypt_provider)
    monkeypatch.setattr("pypdf._encryption.CryptRC4", _fallback.CryptRC4)
    with TestClient(create_app_v2(tmp_path)) as client:
        response = client.post("/api/books/import", files={"file": ("readable.pdf", raw)})
        assert response.status_code == 201, response.text
        assert response.json()["book"]["title"] == "Readable story"


@pytest.mark.parametrize("field,value", [("/O", None), ("/P", "/Invalid"), ("/U", "/Invalid")])
def test_malformed_encryption_returns_validation_error_and_removes_source(tmp_path, field, value):
    from pypdf.generic import NameObject

    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.encrypt(user_password="", owner_password="owner-secret", algorithm="RC4-128")
    if value is None:
        del writer._encrypt_entry[NameObject(field)]
    else:
        writer._encrypt_entry[NameObject(field)] = NameObject(value)
    output = BytesIO()
    writer.write(output)
    with TestClient(create_app_v2(tmp_path)) as client:
        response = client.post("/api/books/import", files={"file": ("malformed.pdf", output.getvalue())})
        assert response.status_code == 422, response.text
        assert response.json()["detail"] == (
            "The uploaded PDF is malformed or exceeds safe parsing limits"
        )
        assert client.get("/api/books").json() == []
    assert not list(tmp_path.rglob("original.*"))


@pytest.mark.parametrize("protection,code,message", [
    ("manifest", "encrypted-epub", EPUB_MESSAGE),
    ("encrypted-bit", "encrypted-epub", EPUB_MESSAGE),
    ("compression", "unsupported-epub-compression", COMPRESSION_MESSAGE),
])
def test_epub_protection_and_compression_have_distinct_reasons(tmp_path, protection, code, message):
    source = tmp_path / "book.epub"
    source.write_bytes(_epub(protection))
    with pytest.raises(DocumentImportError) as error:
        read_text_document(source)
    assert error.value.code == code
    assert str(error.value) == message


@pytest.mark.parametrize("filename,raw,message", [
    ("protected.pdf", _pdf("reader-secret"), PDF_MESSAGE),
    ("aes128.pdf", _pdf("reader-secret", algorithm="AES-128"), PDF_MESSAGE),
    ("aes256.pdf", _pdf("reader-secret", algorithm="AES-256"), PDF_MESSAGE),
    ("unsupported-handler.pdf", _pdf("reader-secret", unsupported_handler=True), PDF_MESSAGE),
    ("unsupported-empty.pdf", _pdf("", unsupported_handler=True), PDF_MESSAGE),
    ("manifest.epub", _epub("manifest"), EPUB_MESSAGE),
    ("protected.epub", _epub("encrypted-bit"), EPUB_MESSAGE),
    ("compressed.epub", _epub("compression"), COMPRESSION_MESSAGE),
])
def test_import_returns_guidance_and_removes_rejected_source(tmp_path, filename, raw, message):
    with TestClient(create_app_v2(tmp_path)) as client:
        response = client.post("/api/books/import", files={"file": (filename, raw)})
        assert response.status_code == 422, response.text
        assert response.json()["detail"] == message
        assert client.get("/api/books").json() == []
    assert not list(tmp_path.rglob("original.*"))
    assert not list(tmp_path.rglob("latest.json"))


def test_ordinary_epub_still_imports(tmp_path):
    source = tmp_path / "plain.epub"
    source.write_bytes(_epub(None))
    assert inspect_source(source) == ("epub", 1)
    assert read_text_document(source)[0] == ["A plain story."]


def test_ordinary_pdf_still_imports(tmp_path):
    source = tmp_path / "plain.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.write(source)
    assert inspect_source(source) == ("pdf", 1)
    with TestClient(create_app_v2(tmp_path / "state")) as client:
        response = client.post("/api/books/import", files={"file": ("plain.pdf", source.read_bytes())})
        assert response.status_code == 201, response.text
        assert response.json()["book"]["page_count"] == 1
