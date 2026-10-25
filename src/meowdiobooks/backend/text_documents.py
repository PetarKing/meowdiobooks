"""Bounded, offline EPUB and plain-text readers. Never unpack or render source HTML."""
from __future__ import annotations

import posixpath
import re
import struct
import zlib
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zipfile import BadZipFile, ZIP_DEFLATED, ZIP_STORED, ZipFile

from lxml import etree

TEXT_SUFFIXES = {".epub", ".txt", ".md"}
MAX_TEXT_BYTES = 20 * 1024 * 1024
MAX_MEMBER_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_MEMBERS = 2000
SECTION_CHARS = 6000


def _sections(text: str) -> list[str]:
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    result = []
    start = 0
    while start < len(text):
        end = len(text)
        if end - start > SECTION_CHARS:
            end = text.rfind("\n", start, start + SECTION_CHARS + 1)
            if end <= start:
                end = text.rfind(" ", start, start + SECTION_CHARS + 1)
            if end <= start:
                end = start + SECTION_CHARS
        result.append(text[start:end])
        start = end
        while start < len(text) and text[start].isspace():
            start += 1
    return result


def _member_path(value: str, base: str = "") -> str:
    url = urlsplit(value)
    path = unquote(url.path)
    if url.scheme or url.netloc or url.query or path.startswith("/") or "\\" in path:
        raise ValueError("EPUB contains an unsafe resource path")
    if not path or any(ord(char) < 32 for char in path):
        raise ValueError("EPUB contains an invalid resource path")
    resolved = posixpath.normpath(posixpath.join(base, path))
    if resolved == ".." or resolved.startswith("../"):
        raise ValueError("EPUB resource escapes the archive")
    return resolved


def _xml(raw: bytes):
    parser = etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True)
    try:
        root = etree.fromstring(raw, parser)
    except etree.XMLSyntaxError as error:
        raise ValueError("EPUB contains malformed XML") from error
    if (root.getroottree().docinfo.internalDTD is not None
            and list(root.getroottree().docinfo.internalDTD.iterentities())) or any(
                isinstance(node, etree._Entity) for node in root.iter()):
        raise ValueError("EPUB entity declarations and references are not supported")
    return root


def _tag(node) -> str:
    return etree.QName(node).localname.lower() if isinstance(node.tag, str) else ""


def _body_text(root) -> str:
    bodies = root.xpath('//*[local-name()="body"]')
    if len(bodies) != 1:
        raise ValueError("EPUB reading section has no unique body")
    output: list[str] = []
    blocks = {"p", "div", "section", "article", "blockquote", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "pre"}

    def visit(node):
        tag = _tag(node)
        if tag == "svg":
            # Common EPUB covers wrap an image in SVG. Skip only image wrappers;
            # never render/fetch them or silently drop SVG reading text.
            for child in node.iter():
                child_tag = _tag(child)
                if (child_tag not in {"svg", "g", "image", "title", "desc"}
                        or (child_tag not in {"title", "desc"} and (child.text or "").strip())
                        or (child is not node and (child.tail or "").strip())):
                    raise ValueError("EPUB contains unsupported embedded reading content")
            return
        if tag in {"iframe", "object", "audio", "video"}:
            raise ValueError("EPUB contains unsupported embedded reading content")
        if not tag or tag in {"script", "style"}:
            return
        if tag in blocks or tag == "br":
            output.append("\n\n" if tag in blocks else "\n")
        if node.text:
            output.append(re.sub(r"\s+", " ", node.text))
        if tag == "img" and node.get("alt"):
            output.append(node.get("alt"))
        for child in node:
            visit(child)
            if child.tail:
                output.append(re.sub(r"\s+", " ", child.tail))
        if tag in blocks:
            output.append("\n\n")
        elif tag in {"td", "th"}:
            output.append(" ")

    visit(bodies[0])
    return re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", "".join(output)).strip()


def read_text_document(path: Path) -> tuple[list[str], dict[str, str]]:
    if path.suffix.lower() in {".txt", ".md"}:
        with path.open("rb") as stream:
            raw = stream.read(MAX_TEXT_BYTES + 1)
        if len(raw) > MAX_TEXT_BYTES:
            raise ValueError("Text files must be 20 MiB or smaller")
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ValueError("Save text files as UTF-8 before importing") from error
        if re.search(r"[\x00-\x08\x0b\x0e-\x1f\x7f]", text):
            raise ValueError("Text file contains binary control characters")
        sections, metadata = _sections(text), {}
    elif path.suffix.lower() == ".epub":
        try:
            sections, metadata = _read_epub(path)
        except (BadZipFile, KeyError, RuntimeError, NotImplementedError, EOFError, zlib.error) as error:
            raise ValueError("The EPUB archive is malformed or unsupported") from error
    else:
        raise ValueError("Unsupported text document format")
    if not sections:
        raise ValueError("The document contains no readable text")
    return sections, metadata


def _check_archive_directory(path: Path) -> None:
    # Bound the central directory before ZipFile allocates one object per entry.
    size = path.stat().st_size
    if size > MAX_ARCHIVE_BYTES:
        raise ValueError("EPUB archive must be 64 MiB or smaller")
    with path.open("rb") as stream:
        stream.seek(max(0, size - 65577))
        tail = stream.read(65577)
    offset = tail.rfind(b"PK\x05\x06")
    if offset < 0 or len(tail) - offset < 22:
        raise ValueError("EPUB has no valid ZIP directory")
    if offset >= 20 and tail[offset - 20:offset - 16] == b"PK\x06\x07":
        raise ValueError("ZIP64 EPUB archives are not supported")
    _, disk, directory_disk, disk_count, count, directory_size, directory_offset, comment_size = struct.unpack(
        "<4s4H2LH", tail[offset:offset + 22],
    )
    if (disk or directory_disk or disk_count != count or count > MAX_MEMBERS
            or directory_offset == 0xFFFFFFFF or directory_size > 2 * 1024 * 1024
            or offset + 22 + comment_size != len(tail)):
        raise ValueError("EPUB exceeds archive directory limits")
    directory_start = size - len(tail) + offset - directory_size
    if directory_start < 0:
        raise ValueError("EPUB has an invalid ZIP directory")
    with path.open("rb") as stream:
        stream.seek(directory_start)
        directory = stream.read(directory_size)
    position = actual_count = 0
    while position < len(directory):
        if (len(directory) - position < 46
                or directory[position:position + 4] != b"PK\x01\x02"):
            raise ValueError("EPUB has an invalid ZIP directory")
        lengths = struct.unpack_from("<3H", directory, position + 28)
        position += 46 + sum(lengths)
        actual_count += 1
        if actual_count > MAX_MEMBERS:
            raise ValueError("EPUB exceeds archive directory limits")
    if position != len(directory) or actual_count != count:
        raise ValueError("EPUB has an inconsistent ZIP directory")


def _read_epub(path: Path) -> tuple[list[str], dict[str, str]]:
    _check_archive_directory(path)
    with ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_MEMBERS or sum(row.file_size for row in entries) > MAX_ARCHIVE_BYTES:
            raise ValueError("EPUB exceeds archive expansion limits")
        names: set[str] = set()
        for entry in entries:
            name = _member_path(entry.filename)
            if name in names or name != entry.filename.rstrip("/"):
                raise ValueError("EPUB contains ambiguous resource names")
            names.add(name)
            if entry.flag_bits & 1 or entry.compress_type not in {ZIP_STORED, ZIP_DEFLATED}:
                raise ValueError("Encrypted or unsupported EPUB compression")
            if entry.file_size > MAX_MEMBER_BYTES:
                raise ValueError("EPUB resource exceeds the 8 MiB limit")
        if "META-INF/encryption.xml" in names:
            raise ValueError("Encrypted EPUB resources are not supported")

        def read(name: str) -> bytes:
            with archive.open(name) as stream:
                raw = stream.read(MAX_MEMBER_BYTES + 1)
            if len(raw) > MAX_MEMBER_BYTES:
                raise ValueError("EPUB resource exceeds the 8 MiB limit")
            return raw

        if read("mimetype").strip() != b"application/epub+zip":
            raise ValueError("The uploaded file is not a valid EPUB")
        container = _xml(read("META-INF/container.xml"))
        roots = container.xpath('//*[local-name()="rootfile"]')
        if len(roots) != 1:
            raise ValueError("EPUB must contain one package document")
        package_name = _member_path(roots[0].get("full-path", ""))
        package = _xml(read(package_name))
        metadata = {}
        for key, tag in (("title", "title"), ("author", "creator")):
            values = package.xpath(f'//*[local-name()="metadata"]/*[local-name()="{tag}"]/text()')
            if values:
                metadata[key] = " ".join(str(values[0]).split())[:500]
        manifest = {}
        for item in package.xpath('//*[local-name()="manifest"]/*[local-name()="item"]'):
            identifier = item.get("id")
            if not identifier or identifier in manifest:
                raise ValueError("EPUB contains ambiguous manifest identifiers")
            manifest[identifier] = item
        sections = []
        seen = set()
        seen_resources = set()
        text_size = 0
        for reference in package.xpath('//*[local-name()="spine"]/*[local-name()="itemref"]'):
            identifier = reference.get("idref")
            if identifier in seen or identifier not in manifest:
                raise ValueError("EPUB contains an invalid reading order")
            seen.add(identifier)
            item = manifest[identifier]
            if item.get("media-type") != "application/xhtml+xml":
                raise ValueError("EPUB reading sections must be XHTML text")
            name = _member_path(item.get("href", ""), posixpath.dirname(package_name))
            if name in seen_resources:
                raise ValueError("EPUB repeats a reading resource")
            seen_resources.add(name)
            text = _body_text(_xml(read(name)))
            text_size += len(text.encode("utf-8"))
            if text_size > MAX_TEXT_BYTES:
                raise ValueError("EPUB readable text exceeds the 20 MiB limit")
            sections.extend(_sections(text))
        return sections, metadata
