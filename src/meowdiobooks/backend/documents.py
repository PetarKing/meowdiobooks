"""Local source import, preview, and extraction operations."""

from __future__ import annotations

import json
import re
import subprocess
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import pdfplumber
from pypdf import PdfReader
from pypdf.errors import PyPdfError

from meowdiobooks.util import sha256_bytes

from .document_errors import DocumentImportError
from .text_documents import TEXT_SUFFIXES, read_text_document

SUPPORTED_SUFFIXES = {".pdf", *TEXT_SUFFIXES}
EXTRACTION_METHOD_VERSION = "documents-v3"
_LITEPARSE_CACHE_KEY = "liteparse-geometry-v1"


def source_path(data_root: Path, book_id: str, source_name: str) -> Path:
    return (
        data_root / "packages" / book_id / "source" / f"original{Path(source_name).suffix.lower()}"
    )


class _ImportPdfReader(PdfReader):
    """Reject encrypted imports before choosing or invoking a security handler."""

    def _handle_encryption(self, password: str | bytes | None) -> None:
        # Pinned pypdf 6.18.1 invokes this hook only after its parsed trailer marks
        # the document encrypted. Reject here before unsupported handlers or an
        # unavailable crypto implementation can bypass import validation/cleanup.
        raise DocumentImportError("encrypted-pdf")


def inspect_source(path: Path) -> tuple[str, int]:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise ValueError(f"Unsupported file type: {suffix or 'missing extension'}")
    if suffix in TEXT_SUFFIXES:
        sections, _ = read_text_document(path)
        return ("epub" if suffix == ".epub" else "text"), len(sections)
    with path.open("rb") as source:
        signature = source.read(5)
    if signature != b"%PDF-":
        raise ValueError("The uploaded file is not a valid PDF")
    try:
        reader = _ImportPdfReader(path)
        if reader.is_encrypted:
            raise DocumentImportError("encrypted-pdf")
        return "pdf", len(reader.pages)
    except PyPdfError as error:
        raise ValueError("The uploaded PDF is malformed or exceeds safe parsing limits") from error


def pdf_metadata(path: Path) -> dict[str, str]:
    """Read non-empty display metadata without treating it as source structure."""
    if path.suffix.lower() in TEXT_SUFFIXES:
        return read_text_document(path)[1]
    metadata = PdfReader(path).metadata
    if metadata is None:
        return {}
    result: dict[str, str] = {}
    for key, value in (("title", metadata.title), ("author", metadata.author)):
        clean = " ".join(str(value or "").split()).strip()
        if clean:
            result[key] = clean
    return result


def imported_book_id(payload: bytes) -> tuple[str, str]:
    digest = sha256_bytes(payload)
    return f"book_{digest[:20]}", digest


def representative_pages(page_count: int) -> list[dict[str, Any]]:
    candidates = [
        (1, "opening page"),
        (min(page_count, max(2, round(page_count * 0.2))), "early sample"),
        (min(page_count, max(2, round(page_count * 0.5))), "middle sample"),
        (min(page_count, max(2, round(page_count * 0.8))), "late sample"),
        (page_count, "final page"),
    ]
    result: list[dict[str, Any]] = []
    seen: set[int] = set()
    for page, reason in candidates:
        if page not in seen:
            result.append({"page": page, "reason": reason})
            seen.add(page)
    return result


def render_default_cover(cache_root: Path) -> Path:
    """Draw the bundled, language-neutral audiobook cover without model calls."""
    from shutil import copyfile

    output = cache_root / "audiobook-cover-v2.png"
    if not output.is_file():
        output.parent.mkdir(parents=True, exist_ok=True)
        copyfile(Path(__file__).with_name("assets") / "default-cover.png", output)
    return output


def render_pdf_page(source: Path, cache_root: Path, page: int, *, command_runner=None) -> Path:
    if source.suffix.lower() in TEXT_SUFFIXES:
        return render_default_cover(cache_root)
    output = cache_root / "pages" / f"page-{page:04d}.png"
    if output.is_file():
        return output
    output.parent.mkdir(parents=True, exist_ok=True)
    (command_runner if command_runner is not None else subprocess.run)(
        [
            "pdftoppm",
            "-f",
            str(page),
            "-l",
            str(page),
            "-singlefile",
            "-png",
            "-r",
            "145",
            str(source),
            str(output.with_suffix("")),
        ],
        check=True,
        capture_output=True,
        timeout=60,
    )
    if not output.is_file():
        raise RuntimeError(f"Page renderer produced no image for page {page}")
    return output


def _normalise_liteparse_page_text(page: Mapping[str, Any]) -> str:
    """Restore paragraph gaps LiteParse exposes only through item geometry.

    LiteParse's plain text preserves visual line wraps but can flatten larger
    vertical paragraph gaps to the same single newline. We insert only missing
    blank separators. If text rows and geometric rows cannot be aligned exactly,
    the parser text remains untouched rather than risking source reordering.
    """

    source = str(page.get("text", ""))
    lines = source.splitlines()
    items = page.get("textItems")
    if not source or not isinstance(items, list) or not items:
        return source
    if not lines or any(not line.strip() for line in lines):
        return source

    rows: list[tuple[float, float]] = []
    for item in items:
        if not isinstance(item, Mapping):
            return source
        try:
            y = float(item["y"])
            height = float(item["height"])
            rotation = float(item.get("rotation", 0))
        except (KeyError, TypeError, ValueError):
            return source
        if height <= 0 or rotation != 0:
            return source
        if rows and abs(y - rows[-1][0]) <= max(height, rows[-1][1]) * 0.35:
            rows[-1] = (rows[-1][0], max(rows[-1][1], height))
        else:
            rows.append((y, height))

    if len(rows) != len(lines):
        return source

    output = [lines[0]]
    for index, line in enumerate(lines[1:], 1):
        previous_y, previous_height = rows[index - 1]
        y, height = rows[index]
        if y - previous_y > max(previous_height, height) * 1.55:
            output.append("")
        output.append(line)
    return "\n".join(output)


def extract_pdf_page(
    source: Path, cache_root: Path, page: int, method: str, *, command_runner=None,
) -> dict[str, Any]:
    if source.suffix.lower() in TEXT_SUFFIXES:
        pages = extract_full_document(source, cache_root, method)
        if not 1 <= page <= len(pages):
            raise ValueError("Page is outside this document")
        return {**pages[page - 1], "elapsedSeconds": 0, "cached": False}
    if method == "text":
        raise ValueError("Use a PDF extraction method for PDF sources")
    started = time.perf_counter()
    cache_method = _LITEPARSE_CACHE_KEY if method == "liteparse" else method
    cache = cache_root / "extraction" / cache_method / f"page-{page:04d}.json"
    if cache.is_file():
        result = json.loads(cache.read_text(encoding="utf-8"))
        result["cached"] = True
        return result
    cache.parent.mkdir(parents=True, exist_ok=True)
    if method == "liteparse":
        raw = cache.with_suffix(".raw.json")
        (command_runner if command_runner is not None else subprocess.run)(
            [
                "liteparse",
                "parse",
                str(source),
                "--format",
                "json",
                "--target-pages",
                str(page),
                "--no-ocr",
                "--quiet",
                "-o",
                str(raw),
            ],
            check=True,
            capture_output=True,
            timeout=90,
        )
        parsed = json.loads(raw.read_text(encoding="utf-8"))
        text = _normalise_liteparse_page_text(parsed["pages"][0]) if parsed.get("pages") else ""
        raw.unlink(missing_ok=True)
    elif method == "native":
        pdf_page = PdfReader(source).pages[page - 1]
        try:
            text = pdf_page.extract_text(extraction_mode="layout") or ""
        except KeyError:
            text = pdf_page.extract_text() or ""
    elif method == "layout":
        with pdfplumber.open(source) as document:
            text = document.pages[page - 1].extract_text(layout=True) or ""
    else:
        raise ValueError(f"Unknown extraction method: {method}")
    clean = text.strip()
    result = {
        "page": page,
        "method": method,
        "text": clean,
        "warnings": _warnings(clean),
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "cached": False,
    }
    cache.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def extract_full_liteparse(
    source: Path, cache_root: Path, *, command_runner=None,
) -> list[dict[str, Any]]:
    cache = cache_root / "extraction" / _LITEPARSE_CACHE_KEY / "full.json"
    if not cache.is_file():
        cache.parent.mkdir(parents=True, exist_ok=True)
        (command_runner if command_runner is not None else subprocess.run)(
            [
                "liteparse",
                "parse",
                str(source),
                "--format",
                "json",
                "--no-ocr",
                "--quiet",
                "-o",
                str(cache),
            ],
            check=True,
            capture_output=True,
            timeout=300,
        )
    return json.loads(cache.read_text(encoding="utf-8"))["pages"]


def extract_full_document(
    source: Path,
    cache_root: Path,
    method: str,
    report: Callable[[float, str | None], None] | None = None,
    *, command_runner=None,
) -> list[dict[str, Any]]:
    """Read every PDF page or stable text section through the same artifact contract."""
    command_options = {"command_runner": command_runner} if command_runner is not None else {}
    notify = report or (lambda _progress, _message=None: None)
    if source.suffix.lower() in TEXT_SUFFIXES:
        if method != "text":
            raise ValueError("Use direct text extraction for EPUB and text sources")
        sections, _ = read_text_document(source)
        notify(90, f"Read {len(sections)} text sections")
        return [{"page": index, "text": text, "method": "text", "warnings": _warnings(text)}
                for index, text in enumerate(sections, 1)]
    if method == "text":
        raise ValueError("Use a PDF extraction method for PDF sources")
    if method == "liteparse":
        notify(10, "Running LiteParse over the complete document")
        raw_pages = extract_full_liteparse(source, cache_root, **command_options)
        pages: list[dict[str, Any]] = []
        for index, page in enumerate(raw_pages, 1):
            text = _normalise_liteparse_page_text(page)
            pages.append({
                **page,
                "page": int(page.get("page", index)),
                "text": text,
                "warnings": list(page.get("warnings") or _warnings(text)),
                "method": "liteparse",
            })
        notify(90, f"Extracted {len(pages)} pages")
        return pages

    reader = PdfReader(source)
    pages: list[dict[str, Any]] = []
    for page_number in range(1, len(reader.pages) + 1):
        result = extract_pdf_page(source, cache_root, page_number, method, **command_options)
        pages.append(
            {
                "page": page_number,
                "text": result["text"],
                "warnings": list(result.get("warnings", [])),
                "method": method,
                "elapsedSeconds": result.get("elapsedSeconds"),
                "cached": bool(result.get("cached", False)),
            }
        )
        notify(
            5 + page_number / len(reader.pages) * 90,
            f"Extracted page {page_number} of {len(reader.pages)}",
        )
    return pages


def _warnings(text: str) -> list[dict[str, str]]:
    warnings: list[dict[str, str]] = []
    if not text:
        warnings.append({"code": "empty", "label": "No text extracted"})
    if re.search(r"\b\w+-\s*\n\s*\w+", text):
        warnings.append({"code": "line-hyphenation", "label": "Possible line-break hyphenation"})
    if text and len(text) < 40:
        warnings.append({"code": "low-text", "label": "Very little text extracted"})
    if _ocr_artifact_score(text) >= 3:
        warnings.append({"code": "ocr-artifacts", "label": "Possible OCR or extraction artifacts"})
    return warnings


def _ocr_artifact_score(text: str) -> int:
    return sum(
        (
            len(re.findall(r"\ufffd|[\x00-\x08\x0b\x0c\x0e-\x1f]", text)),
            len(re.findall(r"(?<!\w)[|{}<>]{2,}(?!\w)", text)),
            len(re.findall(r"\b\w*[A-Za-z]\d[A-Za-z]\w*\b|\b\w*\d[A-Za-z]\d\w*\b", text)),
        )
    )
