"""API lifecycle checks for the extraction-free text import path."""

from hashlib import sha256
from io import BytesIO
from types import SimpleNamespace
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from fastapi.testclient import TestClient

from meowdiobooks.backend.app_v2 import create_app_v2
from meowdiobooks.backend.artifacts import read_artifact, write_artifact
from tests.backend.test_app_v2 import _accept, _process


TEXT = "A cat crossed the garden.\n\nThe moon rose above the trees."


def epub(*, chapter=None, extra=None, href="first.xhtml"):
    """Synthetic EPUB with ZIP/manifest order deliberately opposite to spine order."""
    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("mimetype", "application/epub+zip")
        archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>')
        archive.writestr("OPS/book.opf", f'''<package xmlns:dc="http://purl.org/dc/elements/1.1/">
          <metadata><dc:title>A Cat's Journey</dc:title><dc:creator>Test Author</dc:creator></metadata>
          <manifest><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/>
          <item id="first" href="{href}" media-type="application/xhtml+xml"/></manifest>
          <spine><itemref idref="first"/><itemref idref="second"/></spine></package>''')
        archive.writestr("OPS/second.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Second reading section.</p></body></html>')
        archive.writestr("OPS/first.xhtml", chapter or '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Do not narrate the HTML title</title></head><body><p>First reading section.</p><script>Do not narrate scripts</script><p>A <em>small</em> cat.</p></body></html>')
        for name, raw in (extra or {}).items():
            archive.writestr(name, raw)
    return output.getvalue()


@pytest.mark.parametrize("filename,raw,kind", [
    ("story.TXT", b"\xef\xbb\xbf" + TEXT.replace("\n", "\r\n").encode(), "text"),
    ("story.md", ("# Chapter One\n\n" + TEXT).encode(), "text"),
    ("story.epub", epub(), "epub"),
])
def test_import_automatically_accepts_text_and_preserves_source(tmp_path, filename, raw, kind):
    imported_calls = []

    def imported(book, source):
        imported_calls.append((book.id, source.read_bytes()))
        assert [row.stage.value for row in book.accepted_stage_revisions] == ["import", "extract"]
        assert read_artifact(source.parent.parent, "extraction")["method"] == "text"

    with TestClient(create_app_v2(tmp_path, on_book_imported=imported)) as client:
        response = client.post("/api/books/import", files={"file": (filename, raw)})
        assert response.status_code == 201, response.text
        book = response.json()["book"]
        assert book["source_kind"] == kind
        assert book["source_hash"] == sha256(raw).hexdigest()
        assert [row["stage"] for row in book["accepted_stage_revisions"]] == ["import", "extract"]
        package = tmp_path / "packages" / book["id"]
        extraction = read_artifact(package, "extraction")
        assert extraction["sourceHash"] == book["source_hash"]
        assert extraction["method"] == "text"
        assert extraction["pageCount"] == book["page_count"]
        if kind == "epub":
            assert book["title"] == "A Cat's Journey"
            assert book["author"] == "Test Author"
            assert [page["text"] for page in extraction["pages"]] == [
                "First reading section.\n\nA small cat.", "Second reading section.",
            ]
        else:
            assert TEXT in extraction["pages"][0]["text"]
        for page in extraction["pages"]:
            blocks = [row for row in extraction["blocks"] if row["page"] == page["page"]]
            assert "".join(row["text"] for row in blocks) == page["text"]
        snapshot = client.get(f"/api/books/{book['id']}/snapshot").json()
        assert snapshot["activeArtifacts"]["extraction"] == extraction["revision"]
        assert snapshot["pendingCandidates"] == {}
        assert snapshot["history"]["extraction"][0]["status"] == "accepted"
        preview = client.post(f"/api/books/{book['id']}/extraction/preview", json={"page": 1, "method": "text"})
        assert preview.status_code == 200, preview.text
        assert preview.json()["imageUrl"] is None
        assert preview.json()["sourceText"] == extraction["pages"][0]["text"]
        assert client.post(f"/api/books/{book['id']}/extraction/preview", json={"page": book["page_count"] + 1, "method": "text"}).status_code == 422
        duplicate = client.post("/api/books/import", files={"file": ("renamed." + filename.rsplit(".", 1)[1], raw)})
        assert duplicate.status_code == 201
        assert duplicate.json()["duplicate"] is True
        assert duplicate.json()["book"]["id"] == book["id"]
        assert read_artifact(package, "extraction")["revision"] == extraction["revision"]
        assert len(list((package / "source").iterdir())) == 1
    assert imported_calls == [(book["id"], raw)]


@pytest.mark.parametrize("filename,raw", [
    ("empty.txt", b" \n\t"),
    ("binary.txt", b"hello\x00world"),
    ("latin1.md", b"caf\xe9"),
    ("broken.epub", b"not a ZIP"),
    ("missing.epub", epub(href="missing.xhtml")),
    ("traversal.epub", epub(href="../../outside.xhtml")),
    ("remote.epub", epub(href="https://example.com/book.xhtml")),
    ("encrypted.epub", epub(extra={"META-INF/encryption.xml": "<encryption/>"})),
    ("entity.epub", epub(chapter='<!DOCTYPE html [<!ENTITY secret SYSTEM "file:///etc/passwd">]><html><body><p>&secret;</p></body></html>')),
])
def test_invalid_text_import_is_rejected_without_published_state(tmp_path, filename, raw):
    with TestClient(create_app_v2(tmp_path), raise_server_exceptions=False) as client:
        response = client.post("/api/books/import", files={"file": (filename, raw)})
        assert response.status_code == 422, response.text
        assert client.get("/api/books").json() == []
        assert not list(tmp_path.rglob("original.*"))
        assert not list(tmp_path.rglob("extraction/*.json"))


def test_text_reader_rejection_after_inspection_is_422_and_rolls_back(tmp_path):
    def reject(*_args):
        raise ValueError("Host refused document extraction")

    processor = SimpleNamespace(inspect_source=lambda _: ("text", 1), pdf_metadata=lambda _: {},
                                extract_full_document=reject, render_pdf_page=lambda *_: None)
    with TestClient(create_app_v2(tmp_path, file_processor=processor), raise_server_exceptions=False) as client:
        response = client.post("/api/books/import", files={"file": ("story.txt", TEXT.encode())})
        assert response.status_code == 422, response.text
        assert client.get("/api/books").json() == []
        assert list((tmp_path / "packages").iterdir()) == []


def test_host_processing_boundary_covers_automatic_text_import_and_preview(tmp_path, monkeypatch):
    calls = []

    def forbidden(*_args, **_kwargs):
        pytest.fail("Document parsing escaped the supplied host processor")

    for name in ("inspect_source", "pdf_metadata", "extract_full_document", "extract_pdf_page", "render_pdf_page"):
        monkeypatch.setattr(f"meowdiobooks.backend.app_v2.{name}", forbidden)

    def inspect(source):
        calls.append("inspect")
        assert source.read_bytes() == TEXT.encode()
        return "text", 1

    def metadata(_source):
        calls.append("metadata")
        return {"title": "Hosted text"}

    def extract(_source, _cache, method, report):
        calls.append("extract")
        assert method == "text"
        report(50, "Host extracted the document")
        return [{"page": 1, "text": TEXT, "warnings": [], "method": "text"}]

    def preview(*_args):
        calls.append("preview")
        return {"page": 1, "text": TEXT, "method": "text"}

    processor = SimpleNamespace(inspect_source=inspect, pdf_metadata=metadata,
                                extract_full_document=extract, extract_pdf_page=preview,
                                render_pdf_page=forbidden)
    with TestClient(create_app_v2(tmp_path, file_processor=processor)) as client:
        response = client.post("/api/books/import", files={"file": ("story.txt", TEXT.encode())})
        assert response.status_code == 201, response.text
        book = response.json()["book"]
        assert book["title"] == "Hosted text"
        response = client.post(f"/api/books/{book['id']}/extraction/preview", json={"page": 1, "method": "text"})
        assert response.status_code == 200, response.text
        assert response.json()["sourceText"] == TEXT
    assert calls == ["inspect", "metadata", "extract", "preview"]


def test_import_hook_failure_removes_automatically_accepted_artifact_and_can_retry(tmp_path):
    calls = []

    def imported(book, _source):
        calls.append(book.id)
        if len(calls) == 1:
            raise RuntimeError("Storage is unavailable")

    with TestClient(create_app_v2(tmp_path, on_book_imported=imported), raise_server_exceptions=False) as client:
        assert client.post("/api/books/import", files={"file": ("story.txt", TEXT.encode())}).status_code == 500
        assert client.get("/api/books").json() == []
        assert list((tmp_path / "packages").iterdir()) == []
        retry = client.post("/api/books/import", files={"file": ("story.txt", TEXT.encode())})
        assert retry.status_code == 201, retry.text
        assert retry.json()["duplicate"] is False
        book = retry.json()["book"]
        assert len(client.get(f"/api/books/{book['id']}/snapshot").json()["history"]["extraction"]) == 1


@pytest.mark.parametrize("filename,raw,expected_pages", [
    ("story.txt", TEXT.encode(), [TEXT]),
    ("story.md", TEXT.encode(), [TEXT]),
    ("story.epub", epub(), ["First reading section.\n\nA small cat.", "Second reading section."]),
])
def test_text_import_continues_directly_to_dialogue_and_source_linked_review(
    tmp_path, monkeypatch, filename, raw, expected_pages,
):
    monkeypatch.setattr("meowdiobooks.backend.cleanup_remote.run_cleanup_review",
                        lambda *args, **kwargs: {"occurrences": [], "summary": {"inputWindows": 0}})
    with TestClient(create_app_v2(tmp_path)) as client:
        response = client.post("/api/books/import", files={"file": (filename, raw)})
        assert response.status_code == 201, response.text
        book_id = response.json()["book"]["id"]
        dialogue = _process(client, book_id, "dialogue", {"strategy": "narrate"})
        _accept(client, book_id, "dialogue", dialogue["revision"])
        review = _process(client, book_id, "review", {})
        for page, expected in enumerate(expected_pages, 1):
            preview = client.post(f"/api/books/{book_id}/review/transcript-preview", json={"revision": review["revision"], "page": page})
            assert preview.status_code == 200, preview.text
            assert preview.json()["imageUrl"] is None
            assert preview.json()["sourceText"] == expected
            assert " ".join(span["text"] for span in preview.json()["spans"]).split() == expected.split()
        _accept(client, book_id, "review", review["revision"])


@pytest.mark.parametrize("existing_artifact", [False, True])
def test_failed_import_preserves_existing_package_files_without_leaking_new_artifacts(
    tmp_path, existing_artifact,
):
    raw = TEXT.encode()
    book_id = "book_" + sha256(raw).hexdigest()[:20]
    package = tmp_path / "packages" / book_id
    package.mkdir(parents=True)
    unrelated = package / "operator-note.txt"
    unrelated.write_text("Preserve unrelated work")
    if existing_artifact:
        write_artifact(package, "extraction", {"revision": "previous", "pages": [], "blocks": []})
    original_files = {path: path.read_bytes() for path in package.rglob("*") if path.is_file()}

    def reject(*_args):
        raise RuntimeError("Source storage unavailable")

    with TestClient(create_app_v2(tmp_path, on_book_imported=reject), raise_server_exceptions=False) as client:
        response = client.post("/api/books/import", files={"file": ("story.txt", raw)})
        assert response.status_code == 500
        assert client.get("/api/books").json() == []
    assert unrelated.read_text() == "Preserve unrelated work"
    assert not list(package.rglob("original.*"))
    assert {path: path.read_bytes() for path in package.rglob("*") if path.is_file()} == original_files


def test_persisted_text_import_resumes_and_rejects_modified_source_on_duplicate(tmp_path):
    raw = TEXT.encode()
    with TestClient(create_app_v2(tmp_path)) as client:
        response = client.post("/api/books/import", files={"file": ("story.md", raw)})
        assert response.status_code == 201
        book = response.json()["book"]
        prior = client.get(f"/api/books/{book['id']}/snapshot").json()["activeArtifacts"]
    with TestClient(create_app_v2(tmp_path)) as client:
        snapshot = client.get(f"/api/books/{book['id']}/snapshot").json()
        assert snapshot["book"]["source_kind"] == "text"
        assert snapshot["activeArtifacts"] == prior
        source = tmp_path / "packages" / book["id"] / "source" / "original.md"
        source.write_text("Modified source")
        duplicate = client.post("/api/books/import", files={"file": ("renamed.txt", raw)})
        assert duplicate.status_code == 409
        assert "integrity check" in duplicate.json()["detail"]
        assert source.read_text() == "Modified source"
        assert client.get(f"/api/books/{book['id']}/snapshot").json()["activeArtifacts"] == prior


@pytest.mark.parametrize("hosted", [False, True])
@pytest.mark.parametrize("filename,raw", [("story.txt", TEXT.encode()), ("story.md", TEXT.encode()), ("story.epub", epub())])
def test_text_export_uses_neutral_or_custom_cover_with_processor_boundary(
    tmp_path, monkeypatch, hosted, filename, raw,
):
    import json

    from PIL import Image

    from meowdiobooks.backend import documents

    captures = []
    rendered = []

    def package_audio(chapters, output, **metadata):
        assert [row.audio_path.read_bytes() for row in chapters] == [b"seeded chapter audio"]
        captures.append({**metadata, "cover_bytes": metadata["cover"].read_bytes()})
        output.write_bytes(b"packaged audio")
        return output

    def render(source, cache, page):
        rendered.append((source.suffix, page))
        return documents.render_pdf_page(source, cache, page)

    def forbidden(*_args, **_kwargs):
        pytest.fail("Export escaped the configured host processor")

    processor = None
    if hosted:
        processor = SimpleNamespace(
            inspect_source=documents.inspect_source, pdf_metadata=documents.pdf_metadata,
            extract_full_document=documents.extract_full_document,
            extract_pdf_page=documents.extract_pdf_page, render_pdf_page=render,
            package_audio_export=package_audio,
        )
    monkeypatch.setattr("meowdiobooks.backend.app_v2.render_pdf_page", forbidden if hosted else render)
    monkeypatch.setattr("meowdiobooks.backend.app_v2.package_audio_export", forbidden if hosted else package_audio)
    with TestClient(create_app_v2(tmp_path, file_processor=processor)) as client:
        response = client.post("/api/books/import", files={"file": (filename, raw)})
        assert response.status_code == 201, response.text
        book = response.json()["book"]
        package = tmp_path / "packages" / book["id"]
        inputs = {"dialogue": "dialogue-1", "review": "review-1", "cast": "cast-1"}
        write_artifact(package, "dialogue", {"revision": inputs["dialogue"], "spans": [{
            "id": "s1", "chapterId": "chapter-1", "blockId": "p1-b1",
            "sourceStart": 0, "sourceEnd": 6, "source": "Hello.", "text": "Hello.",
            "renderRole": "narration",
        }]})
        write_artifact(package, "review", {
            "revision": inputs["review"], "dialogueRevision": inputs["dialogue"],
            "spanChapterIds": {"s1": "chapter-1"},
            "chapters": [{"id": "chapter-1", "title": "First chapter"}],
        })
        write_artifact(package, "cast", {"revision": inputs["cast"]})
        write_artifact(package, "script", {
            "revision": "script-1", "status": "ready", "inputRevisions": inputs,
            "entries": [{"id": "e1", "kind": "source", "text": "Hello.",
                         "chapterId": "chapter-1", "sourceSpanIds": ["s1"]}],
            "sourceCoverage": {"status": "exact", "sourceSpanIds": ["s1"]},
        })
        audio = package / "audio" / "chapter-1" / "audio-1"
        audio.mkdir(parents=True)
        (audio / "chapter.wav").write_bytes(b"seeded chapter audio")
        (audio / "metadata.json").write_text(json.dumps({
            "chapterId": "chapter-1", "revision": "audio-1",
            "inputRevisions": {**inputs, "script": "script-1"},
        }))
        (audio.parent / "latest.json").write_text(json.dumps({"revision": "audio-1"}))
        chapters = [{"chapterId": "chapter-1", "revision": "audio-1"}]
        endpoint = f"/api/books/{book['id']}/exports/audio"
        response = client.post(endpoint, json={"chapters": chapters})
        assert response.status_code == 200, response.text
        assert response.content == b"packaged audio"
        assert rendered == [("." + filename.rsplit(".", 1)[1], 1)]
        with Image.open(BytesIO(captures[0]["cover_bytes"])) as cover:
            assert cover.format == "PNG"
            assert cover.size == (600, 800)
        assert captures[0]["title"] == book["title"]
        assert captures[0]["author"] == (book["author"] or "Meowdiobooks")
        custom = BytesIO()
        Image.new("RGB", (20, 30), "blue").save(custom, format="PNG")
        response = client.post(endpoint, data={"chapters": json.dumps(chapters)},
                               files={"cover": ("custom.png", custom.getvalue(), "image/png")})
        assert response.status_code == 200, response.text
        assert captures[1]["cover_bytes"] == custom.getvalue()
        assert len(rendered) == 1, "Custom covers must bypass source-page rendering"
        library = client.get("/api/library").json()
        assert len(library) == 2
        assert {client.get(f"/api/library/{row['id']}/cover").content for row in library} == {
            captures[0]["cover_bytes"], custom.getvalue(),
        }
