"""Local source import, preview, and extraction operations."""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
import time
from uuid import uuid4
from collections.abc import Callable, Mapping
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any

import pdfplumber
from pypdf import PdfReader
from pypdf._crypt_providers import crypt_provider
from pypdf.errors import DependencyError, PyPdfError, WrongPasswordError

from meowdiobooks.util import sha256_bytes

from .document_errors import DocumentImportError
from .text_documents import TEXT_SUFFIXES, read_text_document

SUPPORTED_SUFFIXES = {".pdf", *TEXT_SUFFIXES}
EXTRACTION_METHOD_VERSION = "documents-v4"
_LITEPARSE_CACHE_KEY = "liteparse-geometry-v1"
_OCR_CACHE_KEY = "liteparse-ocr-eng-v2"


def source_path(data_root: Path, book_id: str, source_name: str) -> Path:
    return (
        data_root / "packages" / book_id / "source" / f"original{Path(source_name).suffix.lower()}"
    )


class _ImportPdfReader(PdfReader):
    """Allow encryption only when the document opens with an empty password."""

    def _handle_encryption(self, password: str | bytes | None) -> None:
        # is_encrypted stays true after successful decryption. Supplying an
        # explicit empty password makes pinned pypdf 6.18.1 raise on failure;
        # its default None otherwise leaves a locked reader without raising.
        try:
            super()._handle_encryption(b"")
        except (WrongPasswordError, DependencyError, NotImplementedError) as error:
            raise DocumentImportError("encrypted-pdf") from error
        except (KeyError, TypeError, ValueError, AttributeError) as error:
            raise ValueError("The uploaded PDF is malformed or exceeds safe parsing limits") from error
        # AES-128 password verification uses RC4; missing AES support would
        # otherwise surface only when metadata or page content is decrypted.
        encryption = self._encryption
        if encryption is not None and crypt_provider[0] == "local_crypt_fallback" and any(
            method in {"/AESV2", "/AESV3"}
            for method in (encryption.StrF, encryption.StmF, encryption.EFF)
        ):
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


def extraction_sample_pages(
    source: Path, cache_root: Path, page_count: int, *, command_runner=None,
) -> list[dict[str, Any]]:
    """Screen every text layer cheaply; offer at most two image-page examples.

    Complexity's generic verdict also includes vector decorations on normal
    prose pages. Only sparse text plus substantial raster content is evidence
    for an image-text probe. Blank digital pages never qualify. A blank scan or
    illustration can qualify; recovery retains native text when OCR adds nothing.
    """
    ordinary = representative_pages(page_count)
    if source.suffix.lower() in TEXT_SUFFIXES:
        return ordinary
    cache = cache_root / "extraction" / "ocr-samples-v2.json"
    cached = _read_image_screen_cache(cache, page_count)
    if cached is not None:
        return cached["pages"]
    try:
        result = (command_runner if command_runner is not None else subprocess.run)(
            ["liteparse", "is-complex", str(source), "--compact", "--quiet",
             "--max-pages", str(page_count)],
            check=False, capture_output=True, timeout=60,
        )
        stats = json.loads(result.stdout)
        if result.returncode not in {0, 1} or not isinstance(stats, list) or [
            row.get("pageNumber") for row in stats
        ] != list(range(1, page_count + 1)):
            return ordinary
        candidates = [row for row in stats if row.get("textLength", 1000) < 200 and (
            row.get("fullPageImage") or row.get("imageCoverage", 0) >= .15
            or row.get("largestImageCoverage", 0) >= .15
        )]
        # Prefer strong image coverage with little saved text, then choose a
        # distant second page rather than probing adjacent front-matter scans.
        def interior(row):
            return page_count * .05 < row["pageNumber"] < page_count * .95

        candidates.sort(key=lambda row: (
            interior(row), bool(row.get("fullPageImage")), row.get("imageCoverage", 0),
            -row.get("textLength", 0), -abs(row["pageNumber"] - page_count / 2),
        ), reverse=True)
        selected = candidates[:1]
        if len(candidates) > 1:
            selected.append(max(candidates[1:], key=lambda row: (
                interior(row), abs(row["pageNumber"] - selected[0]["pageNumber"]),
            )))
        probes = [{"page": row["pageNumber"], "reason": "image text check", "ocrCandidate": True}
                  for row in selected]
        probe_pages = {row["page"] for row in probes}
        pages = probes + [row for row in ordinary if row["page"] not in probe_pages]
        cache.parent.mkdir(parents=True, exist_ok=True)
        _write_extraction_cache(cache, {"pages": pages,
                                        "imagePages": [row["pageNumber"] for row in candidates]})
        return pages
    except (OSError, ValueError, TypeError, AttributeError, RuntimeError, subprocess.SubprocessError):
        # Older/missing tools must not prevent manual preview or extraction.
        return ordinary




def _read_image_screen_cache(cache, page_count):
    try:
        result = json.loads(cache.read_text(encoding="utf-8"))
        pages, suspects = result["pages"], result["imagePages"]
        if (not isinstance(pages, list) or not 1 <= len(pages) <= 7
                or any(not isinstance(row, dict) or type(row.get("page")) is not int
                       or not 1 <= row["page"] <= page_count
                       or not isinstance(row.get("reason"), str) for row in pages)
                or len({row["page"] for row in pages}) != len(pages)
                or not isinstance(suspects, list)
                or any(type(page) is not int or not 1 <= page <= page_count for page in suspects)
                or len(set(suspects)) != len(suspects)):
            return None
        return result
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _flag_possible_image_text(source, cache_root, pages, command_runner, *, page_count=None):
    # Persist physical candidates for automatic recovery before Dialogue.
    count = len(pages) if page_count is None else page_count
    extraction_sample_pages(source, cache_root, count, command_runner=command_runner)
    cache = cache_root / "extraction" / "ocr-samples-v2.json"
    cached = _read_image_screen_cache(cache, count)
    if cached is None:
        return pages
    suspects = set(cached["imagePages"])
    return [{**row, "ocrCandidate": True, "warnings": [*row.get("warnings", []), {
        "code": "possible-image-text", "label": "This image may contain unextracted text.",
    }]} if row["page"] in suspects and row.get("method") != "ocr" else {**row, "ocrCandidate": False} for row in pages]


def auto_recover_pdf_pages(
    source, cache_root, pages, extract_page, report=None, *, preview=False, max_workers=1,
):
    """Recover sparse image pages before any dialogue processing.

    Operates on adapter data only: hosted PDF parsing stays inside its sandbox.
    Failure/cancellation propagates so no partial extraction is published. Adapters
    may opt into up to four concurrent pages; previews and the local default stay serial.
    """
    if type(max_workers) is not int or not 1 <= max_workers <= 4:
        raise ValueError("OCR parallelism must be between one and four workers")
    if preview:
        max_workers = 1
    notify = report or (lambda _progress, _message=None: None)
    def candidate(row):
        if row.get("method") == "ocr" or row.get("ocrCandidate") is False:
            return False
        text = row["text"].strip()
        return (row.get("ocrCandidate") is True
                or any(isinstance(w, Mapping) and w.get("code") == "possible-image-text"
                       for w in row.get("warnings", []))
                or not text or (preview and len(text) < 200))

    targets = [index for index, row in enumerate(pages) if candidate(row)]
    result = list(pages)

    def accept(index, recovered):
        original = pages[index]
        if (not isinstance(recovered, dict) or type(recovered.get("page")) is not int
                or recovered["page"] != original["page"] or not isinstance(recovered.get("text"), str)):
            raise ValueError("OCR did not return the requested page")
        text = recovered["text"].strip()
        old = original["text"].strip()
        def letters(value):
            return sum(char.isalnum() for char in value)
        words = re.findall(r"[^\W\d_]{2,}", text, re.UNICODE)
        cjk = sum("\u3400" <= char <= "\u9fff" for char in text)
        new_words = set(word.casefold() for word in words) - set(
            word.casefold() for word in re.findall(r"[^\W\d_]{2,}", old, re.UNICODE))
        new_cjk = set(char for char in text if "\u3400" <= char <= "\u9fff") - set(old)
        useful = ((len(words) >= 2 or cjk >= 4) and letters(text) > letters(old)
                  and bool(new_words or new_cjk))
        if useful:
            warnings = _warnings(text)
            for warning in recovered.get("warnings", []):
                if (isinstance(warning, Mapping)
                        and warning.get("code") not in {"empty", "empty-page", "possible-image-text"}
                        and warning not in warnings):
                    warnings.append(dict(warning))
            result[index] = {**original, **recovered, "text": text, "method": "ocr",
                             "warnings": warnings}

    def progress(completed):
        notify(60 + 35 * completed / len(targets),
               f"Recovering text with OCR ({min(completed + 1, len(targets))}/{len(targets)})")

    if max_workers == 1 or len(targets) < 2:
        for completed, index in enumerate(targets):
            progress(completed)
            accept(index, extract_page(source, cache_root, pages[index]["page"], "ocr"))
        if targets:
            progress(len(targets))
        return result

    progress(0)
    executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="meowdiobooks-ocr")
    pending = {}
    remaining = iter(targets)
    completed = 0

    def submit_next():
        index = next(remaining, None)
        if index is not None:
            pending[executor.submit(extract_page, source, cache_root, pages[index]["page"], "ocr")] = index

    try:
        for _ in range(max_workers):
            submit_next()
        while pending:
            # Reporting stays on the job thread, including cancellation checks
            # while recognizers run. Never enqueue the rest of the book at once.
            progress(completed)
            done, _ = wait(pending, timeout=.25, return_when=FIRST_COMPLETED)
            for future in done:
                accept(pending.pop(future), future.result())
                completed += 1
            progress(completed)
            for _ in done:
                submit_next()
    finally:
        for future in pending:
            future.cancel()
        # Running adapters retain their own deadlines. Join before returning or
        # raising so failed/cancelled work leaves no executor threads behind.
        executor.shutdown(wait=True, cancel_futures=True)
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
    cache_method = (_LITEPARSE_CACHE_KEY if method == "liteparse" else
                    _OCR_CACHE_KEY if method == "ocr" else method)
    cache = cache_root / "extraction" / cache_method / f"page-{page:04d}.json"
    if cache.is_file():
        result = json.loads(cache.read_text(encoding="utf-8"))
        result["cached"] = True
        return (_flag_possible_image_text(source, cache_root, [result], command_runner,
                                         page_count=len(PdfReader(source).pages))[0]
                if method == "liteparse" else result)
    cache.parent.mkdir(parents=True, exist_ok=True)
    if method in {"liteparse", "ocr"}:
        raw = cache.with_name(f"{cache.stem}-{uuid4().hex}.raw.json")
        raster_work = None
        try:
            parser_source, parser_page = source, page
            if method == "ocr":
                from PIL import Image

                # OCR must read the visible page, even when the PDF carries a
                # conflicting/incomplete saved text layer. Keep no native text
                # in the one-page parser input and map its page 1 back below.
                raster_work = tempfile.TemporaryDirectory(prefix="ocr-render-", dir=cache.parent)
                raster_root = Path(raster_work.name)
                cached_image = cache_root / "pages" / f"page-{page:04d}.png"
                render_cache = cache_root if cached_image.is_file() else raster_root
                image_path = render_pdf_page(source, render_cache, page, command_runner=command_runner)
                parser_source, parser_page = raster_root / "visible-page.pdf", 1
                try:
                    with Image.open(image_path) as image:
                        if image.format != "PNG" or image.width * image.height > 16_000_000:
                            raise ValueError("OCR page image exceeds safe processing limits")
                        with image.convert("RGB") as rgb:
                            rgb.save(parser_source, "PDF", resolution=145.0, quality=100, subsampling=0)
                except Image.DecompressionBombError as error:
                    raise ValueError("OCR page image exceeds safe processing limits") from error
            (command_runner if command_runner is not None else subprocess.run)(
                [
                    "liteparse",
                    "parse",
                    str(parser_source),
                    "--format",
                    "json",
                    "--target-pages",
                    str(parser_page),
                    *(["--no-ocr"] if method == "liteparse" else ["--ocr-language", "eng", "--max-pages", "1"]),
                    "--quiet",
                    "-o",
                    str(raw),
                ],
                check=True,
                capture_output=True,
                timeout=90,
            )
            parsed = json.loads(raw.read_text(encoding="utf-8"))
            if method == "ocr":
                pages = parsed.get("pages", [])
                number = (pages[0].get("page", pages[0].get("pageNum"))
                          if isinstance(pages, list) and len(pages) == 1 and isinstance(pages[0], dict)
                          else None)
                if type(number) is not int or number != 1:
                    raise ValueError("OCR did not return the requested page")
            text = _normalise_liteparse_page_text(parsed["pages"][0]) if parsed.get("pages") else ""
        finally:
            raw.unlink(missing_ok=True)
            if raster_work is not None:
                raster_work.cleanup()
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
    _write_extraction_cache(cache, result)
    return (_flag_possible_image_text(source, cache_root, [result], command_runner,
                                     page_count=len(PdfReader(source).pages))[0]
            if method == "liteparse" else result)


def _write_extraction_cache(path: Path, result: dict[str, Any]) -> None:
    pending = path.with_name(f"{path.stem}-{uuid4().hex}.pending.json")
    try:
        pending.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        pending.replace(path)
    finally:
        pending.unlink(missing_ok=True)


def extract_full_liteparse(
    source: Path, cache_root: Path, *, command_runner=None,
) -> list[dict[str, Any]]:
    cache = cache_root / "extraction" / _LITEPARSE_CACHE_KEY / "full.json"
    page_count = len(PdfReader(source).pages)

    def complete(parsed):
        rows = parsed.get("pages")
        return isinstance(rows, list) and [row.get("page", row.get("pageNum")) for row in rows] == list(
            range(1, page_count + 1))

    if cache.is_file():
        try:
            parsed = json.loads(cache.read_text(encoding="utf-8"))
            if complete(parsed):
                return parsed["pages"]
        except (OSError, ValueError, TypeError, AttributeError):
            pass
    cache.parent.mkdir(parents=True, exist_ok=True)
    pending = cache.with_name(f"{cache.stem}-{uuid4().hex}.pending.json")
    try:
        (command_runner if command_runner is not None else subprocess.run)(
            ["liteparse", "parse", str(source), "--format", "json", "--no-ocr",
             "--max-pages", str(page_count), "--quiet", "-o", str(pending)],
            check=True, capture_output=True, timeout=300,
        )
        parsed = json.loads(pending.read_text(encoding="utf-8"))
        if not complete(parsed):
            raise ValueError("Extraction did not return every source page in order")
        pending.replace(cache)
        return parsed["pages"]
    finally:
        pending.unlink(missing_ok=True)


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
                "method": method,
            })
        notify(90, f"Extracted {len(pages)} pages")
        return _flag_possible_image_text(source, cache_root, pages, command_runner)

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
    return (_flag_possible_image_text(source, cache_root, pages, command_runner)
            if method != "ocr" else pages)


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
