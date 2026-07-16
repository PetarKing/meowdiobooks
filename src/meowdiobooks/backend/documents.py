"""Local PDF import, preview, and extraction operations."""

from __future__ import annotations

import json
import re
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pdfplumber
from pypdf import PdfReader

from meowdiobooks.util import sha256_bytes

SUPPORTED_SUFFIXES = {".pdf"}


def source_path(data_root: Path, book_id: str, source_name: str) -> Path:
    return (
        data_root / "packages" / book_id / "source" / f"original{Path(source_name).suffix.lower()}"
    )


def inspect_source(path: Path) -> tuple[str, int]:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise ValueError(f"Unsupported file type: {suffix or 'missing extension'}")
    if path.read_bytes()[:5] != b"%PDF-":
        raise ValueError("The uploaded file is not a valid PDF")
    reader = PdfReader(path)
    if reader.is_encrypted:
        raise ValueError("Encrypted PDFs are not supported yet")
    return "pdf", len(reader.pages)


def pdf_metadata(path: Path) -> dict[str, str]:
    """Read non-empty display metadata without treating it as source structure."""
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


def render_pdf_page(source: Path, cache_root: Path, page: int) -> Path:
    output = cache_root / "pages" / f"page-{page:04d}.png"
    if output.is_file():
        return output
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
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


def extract_pdf_page(source: Path, cache_root: Path, page: int, method: str) -> dict[str, Any]:
    started = time.perf_counter()
    cache = cache_root / "extraction" / method / f"page-{page:04d}.json"
    if cache.is_file():
        result = json.loads(cache.read_text(encoding="utf-8"))
        result["cached"] = True
        return result
    cache.parent.mkdir(parents=True, exist_ok=True)
    if method == "liteparse":
        raw = cache.with_suffix(".raw.json")
        subprocess.run(
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
        text = parsed["pages"][0]["text"] if parsed.get("pages") else ""
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


def extract_full_liteparse(source: Path, cache_root: Path) -> list[dict[str, Any]]:
    cache = cache_root / "extraction" / "liteparse" / "full.json"
    if not cache.is_file():
        cache.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
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
) -> list[dict[str, Any]]:
    """Extract every PDF page with one user-accepted method."""
    notify = report or (lambda _progress, _message=None: None)
    if method == "liteparse":
        notify(10, "Running LiteParse over the complete document")
        raw_pages = extract_full_liteparse(source, cache_root)
        pages = [
            {
                **page,
                "page": int(page.get("page", index)),
                "text": str(page.get("text", "")),
                "warnings": list(page.get("warnings") or _warnings(str(page.get("text", "")))),
                "method": "liteparse",
            }
            for index, page in enumerate(raw_pages, 1)
        ]
        notify(90, f"Extracted {len(pages)} pages")
        return pages

    reader = PdfReader(source)
    pages: list[dict[str, Any]] = []
    for page_number in range(1, len(reader.pages) + 1):
        result = extract_pdf_page(source, cache_root, page_number, method)
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
