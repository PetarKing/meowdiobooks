"""Targeted OCR makes an unpublished, source-bound replacement extraction."""
from copy import deepcopy
from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from reportlab.pdfgen.canvas import Canvas

from meowdiobooks.backend.app_v2 import create_app_v2
from meowdiobooks.backend.artifacts import active_artifacts, artifact_history, read_artifact, write_artifact
from meowdiobooks.backend.dialogue import pages_to_dialogue_blocks
from meowdiobooks.backend.documents import inspect_source
from meowdiobooks.backend.models import Book
from meowdiobooks.backend.storage import JsonStore
from tests.backend.test_app_v2 import _accept, _process, _wait


class OCRProcessor:
    def __init__(self):
        self.pages = [
            {"page": 1, "text": "Chapter 1\n\nOriginal story.\n", "method": "native",
             "warnings": [], "geometry": {"items": [1, 2]}},
            {"page": 2, "text": "", "method": "native",
             "warnings": [{"code": "empty", "label": "No text extracted"}]},
            {"page": 3, "text": "Page 3 Publisher", "method": "native", "warnings": []},
        ]
        self.calls = []
        self.full_calls = 0
        self.results = {}

    def inspect_source(self, source):
        return inspect_source(source)

    def pdf_metadata(self, _source):
        return {}

    def render_pdf_page(self, *_args):
        raise AssertionError("Targeted extraction must not render a preview")

    def extract_full_document(self, _source, _cache, method, _report):
        self.full_calls += 1
        if method == "text":
            return [{"page": 1, "text": _source.read_text(), "method": "text", "warnings": []}]
        assert method == "native"
        return deepcopy(self.pages)

    def extract_pdf_page(self, source, _cache, page, method):
        self.calls.append((source.name, page, method))
        result = self.results.get(page, f"Recovered source words on page {page}.")
        if isinstance(result, Exception):
            raise result
        return {"page": page, "method": "ocr", "text": result,
                "warnings": [], "elapsedSeconds": .1, "cached": False}


@pytest.fixture
def recovery(tmp_path):
    payload = BytesIO()
    canvas = Canvas(payload)
    for page in range(1, 4):
        canvas.drawString(72, 760, f"Source page {page}")
        canvas.showPage()
    canvas.save()
    processor = OCRProcessor()
    with TestClient(create_app_v2(tmp_path, file_processor=processor)) as client:
        response = client.post("/api/books/import", files={"file": (
            "source.pdf", payload.getvalue(), "application/pdf",
        )})
        assert response.status_code == 201, response.text
        book_id = response.json()["book"]["id"]
        result = _process(client, book_id, "extract", {"method": "native"})
        _accept(client, book_id, "extract", result["revision"])
        package = tmp_path / "packages" / book_id
        yield client, book_id, package, processor


def targeted(client, book_id, revision, pages=(2,)):
    response = client.post(f"/api/books/{book_id}/stages/extract/process", json={
        "settings": {"method": "ocr", "ocrPages": list(pages),
                     "baseExtractionRevision": revision},
    })
    assert response.status_code == 202, response.text
    return _wait(client, response.json()["id"])


def test_targeted_ocr_preserves_other_pages_and_invalidates_only_on_accept(recovery):
    client, book_id, package, processor = recovery
    base = read_artifact(package, "extraction")
    original_bytes = (package / "artifacts/extraction" / f"{base['revision']}.json").read_bytes()
    for kind in ["dialogue", "review", "cast", "script"]:
        write_artifact(package, kind, {"revision": f"original-{kind}"})
    before = active_artifacts(package)

    finished = targeted(client, book_id, base["revision"])

    assert finished["status"] == "succeeded", finished
    assert processor.calls == [("original.pdf", 2, "ocr")]
    assert processor.full_calls == 1
    assert active_artifacts(package) == before
    candidate = artifact_history(package, "extraction")[-1]
    assert candidate["revision"] != base["revision"]
    assert candidate["baseExtractionRevision"] == base["revision"]
    assert candidate["ocrPages"] == [2]
    assert candidate["recoveredPages"] == [2]
    assert candidate["method"] == "native"
    assert candidate["pages"][0] == base["pages"][0]
    assert candidate["pages"][2] == base["pages"][2]
    assert candidate["pages"][1]["method"] == "ocr"
    assert candidate["pages"][1]["text"] == "Recovered source words on page 2."
    assert candidate["pages"][1]["warnings"] == []
    assert candidate["blocks"] == pages_to_dialogue_blocks(candidate["pages"])

    _accept(client, book_id, "extract", candidate["revision"])

    assert set(active_artifacts(package)) == {"extraction"}
    assert read_artifact(package, "extraction")["revision"] == candidate["revision"]
    assert (package / "artifacts/extraction" / f"{base['revision']}.json").read_bytes() == original_bytes
    assert all((package / f"artifacts/{kind}/original-{kind}.json").is_file()
               for kind in ["dialogue", "review", "cast", "script"])


def test_sequential_repairs_retain_page_provenance_and_reject_stale_acceptance(recovery):
    client, book_id, package, processor = recovery
    original = read_artifact(package, "extraction")
    first = targeted(client, book_id, original["revision"])
    _accept(client, book_id, "extract", first["result"]["revision"])
    base = read_artifact(package, "extraction")
    second = targeted(client, book_id, base["revision"], [3])
    candidate = artifact_history(package, "extraction")[-1]
    assert candidate["ocrPages"] == [2, 3]
    assert candidate["recoveredPages"] == [3]
    assert candidate["pages"][1] == base["pages"][1]
    assert [row[1] for row in processor.calls] == [2, 3]

    replacement = {**base, "revision": uuid4().hex}
    write_artifact(package, "extraction", replacement)
    before = active_artifacts(package)
    response = client.post(f"/api/books/{book_id}/stages/extract/accept", json={
        "revision": second["result"]["revision"], "decisions": [],
    })
    assert response.status_code == 409
    assert "changed" in response.json()["detail"]
    assert active_artifacts(package) == before


@pytest.mark.parametrize("result", ["", " \n ", "Page 3 Publisher", " Page 3\nPublisher ",
                                   RuntimeError("OCR process failed")])
def test_failed_empty_or_unchanged_recovery_publishes_nothing(recovery, result):
    client, book_id, package, processor = recovery
    base = read_artifact(package, "extraction")
    processor.results[3] = result
    before = active_artifacts(package)
    history = artifact_history(package, "extraction")
    finished = targeted(client, book_id, base["revision"], [2, 3])
    assert finished["status"] == "failed", finished
    assert active_artifacts(package) == before
    assert artifact_history(package, "extraction") == history
    if not isinstance(result, Exception):
        assert "OCR found no" in finished["error"]


@pytest.mark.parametrize("change", ["revision", "source-hash", "missing-page", "duplicate-page", "order"])
def test_stale_or_incomplete_base_is_rejected_before_ocr(recovery, change):
    client, book_id, package, processor = recovery
    base = read_artifact(package, "extraction")
    modified = deepcopy(base)
    requested_revision = base["revision"]
    if change == "revision":
        requested_revision = "superseded-revision"
    else:
        modified["revision"] = uuid4().hex
        if change == "source-hash":
            modified["sourceHash"] = "different-source"
        elif change == "missing-page":
            modified["pages"] = modified["pages"][:2]
        elif change == "duplicate-page":
            modified["pages"][2]["page"] = 2
        else:
            modified["pages"].reverse()
        write_artifact(package, "extraction", modified)
        requested_revision = modified["revision"]
    before = active_artifacts(package)
    history = artifact_history(package, "extraction")
    finished = targeted(client, book_id, requested_revision)
    assert finished["status"] == "failed", finished
    assert processor.calls == []
    assert active_artifacts(package) == before
    assert artifact_history(package, "extraction") == history


def test_changed_original_source_is_rejected_before_ocr(recovery):
    client, book_id, package, processor = recovery
    base = read_artifact(package, "extraction")
    source = package / "source/original.pdf"
    source.write_bytes(source.read_bytes() + b"changed")
    before = active_artifacts(package)
    finished = targeted(client, book_id, base["revision"])
    assert finished["status"] == "failed"
    assert "Import the source document again" in finished["error"]
    assert not processor.calls
    assert active_artifacts(package) == before


@pytest.mark.parametrize("pages", [[0], [-1], [10001], [True], [1.5], [], [2, 2]])
def test_invalid_target_page_settings_are_rejected(recovery, pages):
    client, book_id, package, processor = recovery
    base = read_artifact(package, "extraction")
    response = client.post(f"/api/books/{book_id}/stages/extract/process", json={
        "settings": {"method": "ocr", "ocrPages": pages,
                     "baseExtractionRevision": base["revision"]},
    })
    assert response.status_code == 422
    assert not processor.calls


@pytest.mark.parametrize("settings", [
    {"method": "native", "ocrPages": [2], "baseExtractionRevision": "base"},
    {"method": "ocr", "ocrPages": [2]},
    {"method": "ocr", "baseExtractionRevision": "base"},
])
def test_targeted_settings_require_ocr_and_both_page_and_revision(recovery, settings):
    client, book_id, _package, processor = recovery
    response = client.post(f"/api/books/{book_id}/stages/extract/process", json={"settings": settings})
    assert response.status_code == 422
    assert not processor.calls


def test_out_of_document_target_is_rejected(recovery):
    client, book_id, package, processor = recovery
    base = read_artifact(package, "extraction")
    before = active_artifacts(package)
    assert targeted(client, book_id, base["revision"], [4])["status"] == "failed"
    assert not processor.calls
    assert active_artifacts(package) == before


def test_targeted_ocr_rejects_text_sources_before_reading_a_base(recovery):
    client, _book_id, _package, processor = recovery
    imported = client.post("/api/books/import", files={"file": (
        "source.txt", b"A plain text source.", "text/plain",
    )})
    assert imported.status_code == 201, imported.text
    book_id = imported.json()["book"]["id"]
    finished = targeted(client, book_id, "unused-base", [1])
    assert finished["status"] == "failed"
    assert finished["error"] == "Targeted OCR requires a PDF source."
    assert not processor.calls


def test_provider_cannot_replace_a_different_physical_page(recovery):
    client, book_id, package, processor = recovery
    base = read_artifact(package, "extraction")
    processor.extract_pdf_page = lambda *_args: {"page": 1, "text": "Wrong page."}
    before = active_artifacts(package)
    finished = targeted(client, book_id, base["revision"], [2])
    assert finished["status"] == "failed"
    assert finished["error"] == "OCR returned an invalid page. Please try again."
    assert active_artifacts(package) == before


def test_recovery_acceptance_rechecks_source_identity(recovery):
    client, book_id, package, _processor = recovery
    base = read_artifact(package, "extraction")
    finished = targeted(client, book_id, base["revision"])
    assert finished["status"] == "succeeded", finished
    books = JsonStore(package.parent.parent / "books.json", Book)
    book = books.get(book_id)
    book.source_hash = "replaced-source"
    books.put(book)
    before = active_artifacts(package)
    response = client.post(f"/api/books/{book_id}/stages/extract/accept", json={
        "revision": finished["result"]["revision"], "decisions": [],
    })
    assert response.status_code == 409
    assert response.json()["detail"] == "The OCR recovery does not match the current source."
    assert active_artifacts(package) == before
