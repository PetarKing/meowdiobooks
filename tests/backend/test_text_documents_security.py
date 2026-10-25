"""Independent hostile-input and source-retention checks for text imports."""

from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from meowdiobooks.backend import text_documents


def _epub(tmp_path, *, entries=None, manifest=None, spine=None):
    resources = {
        "mimetype": b"application/epub+zip",
        "META-INF/container.xml": (
            b'<container><rootfiles><rootfile full-path="OPS/book.opf"/>'
            b"</rootfiles></container>"
        ),
        "OPS/book.opf": (
            '<package><metadata><title>A Book</title></metadata><manifest>'
            + (manifest or '<item id="one" href="chapter.xhtml" '
               'media-type="application/xhtml+xml"/>')
            + '</manifest><spine>'
            + (spine or '<itemref idref="one"/>')
            + '</spine></package>'
        ).encode(),
        "OPS/chapter.xhtml": b"<html><body><p>The complete story.</p></body></html>",
    }
    resources.update(entries or {})
    path = tmp_path / "book.epub"
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        for name, payload in resources.items():
            archive.writestr(name, payload)
    return path


@pytest.mark.parametrize("name", [
    "../escape", "/absolute", "C:\\escape", "OPS\\escape", "OPS/../alias",
    "OPS/%2e%2e/alias", "https://example.test/book", "OPS/chapter.xhtml#alias",
])
def test_unsafe_or_ambiguous_archive_names_are_rejected(tmp_path, name):
    source = _epub(tmp_path, entries={name: b"untrusted"})
    with pytest.raises(ValueError):
        text_documents.read_text_document(source)
    assert not (tmp_path.parent / "escape").exists()


@pytest.mark.parametrize("href", [
    "../../escape", "%2e%2e/%2e%2e/escape", "/etc/passwd", "file:///etc/passwd",
    "https://example.test/chapter.xhtml", "//example.test/chapter.xhtml",
    "..%5cescape", "chapter.xhtml?download=true", "%00chapter.xhtml",
])
def test_spine_resource_resolution_stays_inside_archive(tmp_path, href):
    source = _epub(tmp_path, manifest=(
        f'<item id="one" href="{href}" media-type="application/xhtml+xml"/>'
    ))
    with pytest.raises(ValueError):
        text_documents.read_text_document(source)


@pytest.mark.parametrize("member", [
    "META-INF/container.xml", "OPS/book.opf", "OPS/chapter.xhtml",
])
def test_entity_definitions_are_rejected_at_every_xml_boundary(tmp_path, member):
    secret = tmp_path / "secret.txt"
    secret.write_text("DO NOT IMPORT THIS LOCAL FILE", encoding="utf-8")
    payload = (
        f'<!DOCTYPE html [<!ENTITY secret SYSTEM "{secret.as_uri()}">]>'
        '<html><body><p>&secret;</p></body></html>'
    ).encode()
    source = _epub(tmp_path, entries={member: payload})
    with pytest.raises(ValueError, match="entit"):
        text_documents.read_text_document(source)


def test_unused_entity_declarations_are_also_rejected(tmp_path):
    source = _epub(tmp_path, entries={"OPS/chapter.xhtml": (
        b'<!DOCTYPE html [<!ENTITY a "repeated text">]>'
        b"<html><body><p>Normal text.</p></body></html>"
    )})
    with pytest.raises(ValueError, match="entit"):
        text_documents.read_text_document(source)


def test_external_doctype_needs_no_remote_resolution(tmp_path):
    source = _epub(tmp_path, entries={"OPS/chapter.xhtml": (
        b'<!DOCTYPE html SYSTEM "file:///a/nonexistent/external.dtd">'
        b"<html><body><p>A &amp; B.</p></body></html>"
    )})
    assert text_documents.read_text_document(source)[0] == ["A & B."]


@pytest.mark.parametrize("limit", ["MAX_MEMBER_BYTES", "MAX_ARCHIVE_BYTES", "MAX_MEMBERS"])
def test_archive_expansion_limits_reject_before_parsing(tmp_path, monkeypatch, limit):
    source = _epub(tmp_path, entries={"OPS/unused.bin": b"x" * 10_000})
    monkeypatch.setattr(text_documents, limit, 1 if limit == "MAX_MEMBERS" else 1000)
    with pytest.raises(ValueError, match="limit"):
        text_documents.read_text_document(source)


def test_duplicate_archive_entries_are_rejected(tmp_path):
    source = _epub(tmp_path)
    with pytest.warns(UserWarning, match="Duplicate name"):
        with ZipFile(source, "a") as archive:
            archive.writestr("OPS/chapter.xhtml", b"<html><body>Replacement</body></html>")
    with pytest.raises(ValueError, match="ambiguous"):
        text_documents.read_text_document(source)


def _corrupt_deflate_payload(path):
    with ZipFile(path) as archive:
        entry = archive.getinfo("OPS/chapter.xhtml")
    raw = bytearray(path.read_bytes())
    offset = entry.header_offset + 30 + len(entry.filename.encode()) + len(entry.extra)
    raw[offset:offset + 4] = b"\xff\xff\xff\xff"
    path.write_bytes(raw)


def test_corrupt_deflate_data_is_a_validation_error(tmp_path):
    source = _epub(tmp_path)
    _corrupt_deflate_payload(source)
    with pytest.raises(ValueError, match="malformed|unsupported"):
        text_documents.read_text_document(source)


def test_corrupt_epub_import_returns_422_and_removes_source(tmp_path):
    from fastapi.testclient import TestClient

    from meowdiobooks.backend.app_v2 import create_app_v2

    source = _epub(tmp_path)
    _corrupt_deflate_payload(source)
    state = tmp_path / "state"
    with TestClient(create_app_v2(data_dir=state)) as client:
        response = client.post('/api/books/import', files={
            'file': ('corrupt.epub', source.read_bytes(), 'application/epub+zip'),
        })
        assert response.status_code == 422, response.text
        assert client.get('/api/books').json() == []
    assert not list(state.rglob('original.epub'))


def test_alias_ids_cannot_repeat_one_resource_to_bypass_expansion_limits(tmp_path):
    manifest = ''.join(
        f'<item id="part{i}" href="chapter.xhtml" media-type="application/xhtml+xml"/>'
        for i in range(100)
    )
    spine = ''.join(f'<itemref idref="part{i}"/>' for i in range(100))
    source = _epub(tmp_path, manifest=manifest, spine=spine)
    with pytest.raises(ValueError):
        text_documents.read_text_document(source)


def test_total_readable_text_is_bounded(tmp_path, monkeypatch):
    source = _epub(tmp_path)
    monkeypatch.setattr(text_documents, "MAX_TEXT_BYTES", 10)
    with pytest.raises(ValueError, match="limit"):
        text_documents.read_text_document(source)


def test_spine_order_nested_hrefs_and_supplementary_text_are_preserved(tmp_path):
    source = _epub(
        tmp_path,
        manifest=(
            '<item id="one" href="chapter.xhtml" media-type="application/xhtml+xml"/>'
            '<item id="two" href="parts/../second.xhtml#opening" '
            'media-type="application/xhtml+xml"/>'
        ),
        spine='<itemref idref="two"/><itemref idref="one" linear="no"/>',
        entries={"OPS/second.xhtml": b"<html><body><p>Second file first.</p></body></html>"},
    )
    assert text_documents.read_text_document(source)[0] == [
        "Second file first.", "The complete story.",
    ]


def test_inline_text_tails_alt_text_and_notes_survive_in_document_order(tmp_path):
    source = _epub(tmp_path, entries={"OPS/chapter.xhtml": (
        b"<html><head><title>Not body</title></head><body>"
        b"<p>A <em>small</em> cat.<br/>Next line.</p>"
        b"<script>DO NOT SPEAK</script><style>DO NOT SPEAK</style>"
        b'<p><img src="cover.png" alt="A cat drawing"/> Caption.</p>'
        b"<aside>Footnote survives.</aside></body></html>"
    )})
    output = text_documents.read_text_document(source)[0][0]
    assert "A small cat.\nNext line." in output
    assert "A cat drawing Caption." in output
    assert "Footnote survives." in output
    assert "DO NOT SPEAK" not in output
    assert "Not body" not in output


def test_svg_cover_image_wrapper_is_skipped_without_loading_resources(tmp_path):
    source = _epub(tmp_path, entries={"OPS/chapter.xhtml": (
        b'<html><body><svg xmlns="http://www.w3.org/2000/svg" '
        b'xmlns:xlink="http://www.w3.org/1999/xlink">'
        b'<title>Cover</title><desc>A cover image</desc><g>'
        b'<image xlink:href="file:///nonexistent/cover.jpg"/></g></svg>'
        b'<p>The complete story.</p></body></html>'
    )})
    assert text_documents.read_text_document(source)[0] == ["The complete story."]


@pytest.mark.parametrize("content", [
    '<text>Essential ending.</text>', '<g>Essential ending.</g>',
    '<foreignObject><p>Essential ending.</p></foreignObject>',
    '<use href="other.svg#text"/>',
])
def test_unsupported_svg_text_is_not_silently_omitted(tmp_path, content):
    source = _epub(tmp_path, entries={"OPS/chapter.xhtml": (
        '<html><body><p>Visible paragraph.</p>'
        f'<svg xmlns="http://www.w3.org/2000/svg">{content}</svg>'
        '</body></html>'
    ).encode()})
    with pytest.raises(ValueError):
        text_documents.read_text_document(source)


@pytest.mark.parametrize("payload", [b"\xff\xfea\x00", b"story\x00hidden", b"\x7f", b" \n\r\t"])
def test_binary_invalid_encoding_and_empty_text_are_rejected(tmp_path, payload):
    source = tmp_path / "book.txt"
    source.write_bytes(payload)
    with pytest.raises(ValueError):
        text_documents.read_text_document(source)


def test_text_size_is_bounded_and_bom_unicode_and_markdown_are_preserved(tmp_path, monkeypatch):
    source = tmp_path / "book.md"
    source.write_bytes("\ufeff# Café\r\n\r\nA **cat** says 你好.\rThe end.".encode())
    assert text_documents.read_text_document(source)[0] == [
        "# Café\n\nA **cat** says 你好.\nThe end.",
    ]
    monkeypatch.setattr(text_documents, "MAX_TEXT_BYTES", 10)
    with pytest.raises(ValueError, match="smaller"):
        text_documents.read_text_document(source)


def test_zip_directory_limit_is_checked_before_constructing_zipfile(tmp_path, monkeypatch):
    import struct
    from meowdiobooks.backend import text_documents

    source = tmp_path / "oversized-directory.epub"
    source.write_bytes(struct.pack("<4s4H2LH", b"PK\x05\x06", 0, 0, 60000, 60000, 0, 0, 0))
    def forbidden(*args, **kwargs):
        pytest.fail("ZipFile allocated entries before directory validation")
    monkeypatch.setattr(text_documents, "ZipFile", forbidden)
    with pytest.raises(ValueError, match="directory limits"):
        text_documents.read_text_document(source)


@pytest.mark.parametrize("comment_size", [0, 65535])
def test_zip64_cannot_override_checked_classic_directory_fields(tmp_path, monkeypatch, comment_size):
    import struct

    source = _epub(tmp_path)
    raw = source.read_bytes()
    offset = len(raw) - 22
    fields = list(struct.unpack("<4s4H2LH", raw[offset:]))
    count, directory_size, directory_offset = fields[4:7]
    zip64_record = struct.pack(
        "<4sQ2H2L4Q", b"PK\x06\x06", 44, 45, 45, 0, 0,
        count, count, directory_size, directory_offset,
    )
    locator = struct.pack("<4sLQL", b"PK\x06\x07", 0, offset, 1)
    fields[3] = fields[4] = fields[5] = 0
    fields[-1] = comment_size
    source.write_bytes(
        raw[:offset] + zip64_record + locator + struct.pack("<4s4H2LH", *fields)
        + b"x" * comment_size,
    )

    def forbidden(*_args, **_kwargs):
        pytest.fail("ZipFile processed ZIP64 metadata before directory validation")

    monkeypatch.setattr(text_documents, "ZipFile", forbidden)
    with pytest.raises(ValueError):
        text_documents.read_text_document(source)


def test_false_directory_count_is_rejected_before_constructing_zipfile(tmp_path, monkeypatch):
    import struct

    source = _epub(tmp_path)
    raw = source.read_bytes()
    fields = list(struct.unpack("<4s4H2LH", raw[-22:]))
    fields[3] = fields[4] = 1
    source.write_bytes(raw[:-22] + struct.pack("<4s4H2LH", *fields))

    def forbidden(*_args, **_kwargs):
        pytest.fail("ZipFile allocated entries from a false directory count")

    monkeypatch.setattr(text_documents, "ZipFile", forbidden)
    with pytest.raises(ValueError):
        text_documents.read_text_document(source)
