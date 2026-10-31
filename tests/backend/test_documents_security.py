"""Bounded regression coverage for untrusted PDF import and parser upgrades."""

import os
import subprocess
import sys
from io import BytesIO
from pathlib import Path

import pytest
from reportlab.pdfgen.canvas import Canvas

from meowdiobooks.backend import documents


def test_invalid_source_header_is_checked_without_reading_the_full_upload(tmp_path, monkeypatch):
    class GuardedUpload(BytesIO):
        def read(self, size=-1):
            assert 0 <= size <= 5, "Signature check tried to buffer the full upload"
            return super().read(size)

    monkeypatch.setattr(Path, "open", lambda *_args, **_kwargs: GuardedUpload(b"NOT-PDF"))
    with pytest.raises(ValueError, match="not a valid PDF"):
        documents.inspect_source(tmp_path / "large.pdf")


def test_malformed_pdf_recovery_is_bounded_and_import_cleans_up(tmp_path):
    source = tmp_path / "malformed.pdf"
    source.write_bytes(
        b"%PDF-1.4\nxref\n0 1\n0000000000 65535 f \n"
        b"trailer\n<< /Size 1000000000 >>\nstartxref\n9\n%%EOF\n"
    )
    # Run adversarial parser input in a killable child so an accidental dependency
    # downgrade fails this test instead of pinning the entire test worker forever.
    code = """
import logging
import sys
from pathlib import Path
from fastapi.testclient import TestClient
from meowdiobooks.backend.app_v2 import create_app_v2
from meowdiobooks.backend.documents import inspect_source

logging.disable(logging.CRITICAL)
source = Path(sys.argv[1])
root = Path(sys.argv[2])
try:
    inspect_source(source)
except ValueError as error:
    assert "safe parsing limits" in str(error), str(error)
else:
    raise AssertionError("Malformed PDF was accepted")
with TestClient(create_app_v2(data_dir=root)) as client:
    response = client.post(
        "/api/books/import",
        files={"file": ("malformed.pdf", source.read_bytes(), "application/pdf")},
    )
    assert response.status_code == 422, response.text
    assert "safe parsing limits" in response.json()["detail"]
    assert client.get("/api/books").json() == []
assert not list(root.rglob("original.pdf")), "Rejected source was retained"
"""
    result = subprocess.run(
        [sys.executable, "-c", code, str(source), str(tmp_path / "state")],
        capture_output=True,
        text=True,
        timeout=20,
        env={
            **os.environ,
            "PYTHONPATH": str(Path(documents.__file__).resolve().parents[2]),
        },
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("method", ["native", "layout"])
def test_patched_parsers_preserve_import_metadata_and_extracted_text(tmp_path, method):
    source = tmp_path / "book.pdf"
    canvas = Canvas(str(source))
    canvas.setTitle("A Small Book")
    canvas.setAuthor("Test Author")
    canvas.drawString(72, 720, "A cat finds its voice.")
    canvas.showPage()
    canvas.save()

    assert documents.inspect_source(source) == ("pdf", 1)
    assert documents.pdf_metadata(source) == {"title": "A Small Book", "author": "Test Author"}
    extracted = documents.extract_pdf_page(source, tmp_path / "cache", 1, method)
    assert extracted["text"] == "A cat finds its voice."
    assert extracted["cached"] is False
    assert documents.extract_pdf_page(source, tmp_path / "cache", 1, method)["cached"] is True
