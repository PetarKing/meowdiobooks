"""Standard extraction recovers missing image text before Dialogue or Review."""
from copy import deepcopy
import pytest

from meowdiobooks.backend.documents import auto_recover_pdf_pages
from tests.backend.ocr_stub_files import write_stub_text


def page(number, text, *, candidate=None, flagged=False, **extra):
    row = {"page": number, "text": text, "method": "liteparse", "warnings": [], **extra}
    if candidate is not None:
        row["ocrCandidate"] = candidate
    if flagged:
        row["warnings"].append({"code": "possible-image-text", "label": "Possible image text"})
    return row


def run(tmp_path, pages, recovered, *, preview=False, report=None):
    before = deepcopy(pages)
    calls = []
    source, cache = tmp_path / "source.pdf", tmp_path / "cache"

    def extract(source_path, cache_path, number, method):
        assert source_path == source and cache_path == cache and method == "ocr"
        calls.append(number)
        result = recovered[number]
        if isinstance(result, BaseException):
            raise result
        return deepcopy(result)

    result = auto_recover_pdf_pages(source, cache, pages, extract, report, preview=preview)
    assert pages == before, "Automatic fallback must not mutate raw parser rows"
    return result, calls


def ocr(number, text, **extra):
    return {"page": number, "text": text, "method": "ocr", "warnings": [], **extra}


def test_full_extraction_uses_image_flags_and_unknown_empty_pages_but_skips_known_blanks(tmp_path):
    rows = [page(1, "Correct native story text. " * 20),
            page(2, "Page 115 Publisher", candidate=True, flagged=True),
            page(3, ""), page(4, "", candidate=False), page(5, "A short native page.")]
    result, calls = run(tmp_path, rows, {
        2: ocr(2, "The student evaluation contains useful comments from the instructor."),
        3: ocr(3, "An image-only page contains newly recovered story text."),
    })
    assert calls == [2, 3]
    assert result[0] == rows[0] and result[3:] == rows[3:]
    assert result[1]["text"].startswith("The student evaluation")
    assert result[2]["text"].startswith("An image-only page")
    assert [row["page"] for row in result] == [1, 2, 3, 4, 5]


def test_sparse_preview_uses_requested_physical_page_not_subset_index(tmp_path):
    rows = [page(124, "Page 115 Publisher")]
    recovered = "The interviewer describes room for growth and the instructor asks for greater initiative."
    result, calls = run(tmp_path, rows, {124: ocr(124, recovered)}, preview=True)
    assert calls == [124]
    assert result[0]["page"] == 124 and result[0]["text"] == recovered


def test_sparse_preview_is_bounded_and_valid_negative_screen_wins(tmp_path):
    rows = [page(7, "A short native page."), page(9, "", candidate=False),
            page(12, "A large ordinary prose paragraph. " * 20)]
    recovered = "A useful previously missed passage explains the next events in the story."
    result, calls = run(tmp_path, rows, {7: ocr(7, recovered)}, preview=True)
    assert calls == [7]
    assert result[1:] == rows[1:]
    unchanged, full_calls = run(tmp_path, rows, {})
    assert full_calls == [] and unchanged == rows


@pytest.mark.parametrize("text", ["", "   \n  ", "... !!! ??? 12345", "One", "A name."])
def test_empty_junk_or_weaker_ocr_retains_saved_text_and_metadata_exactly(tmp_path, text):
    rows = [page(2, "Page 115 Goldenagato https://mp4directs.com", flagged=True,
                 textItems=[{"text": "Saved footer", "x": 4}], nativeMetadata={"rotation": 0})]
    result, calls = run(tmp_path, rows, {2: ocr(2, text)})
    assert calls == [2] and result == rows


def test_whitespace_only_change_is_not_accepted_as_recovered_text(tmp_path):
    rows = [page(2, "Original saved useful words.", flagged=True)]
    result, _calls = run(tmp_path, rows, {2: ocr(2, "Original  saved\nuseful words.")})
    assert result == rows


def test_repeated_native_footer_is_not_new_content(tmp_path):
    rows = [page(2, "Page 115 Publisher", flagged=True)]
    result, _calls = run(tmp_path, rows, {2: ocr(2, "Page 115 Publisher\n" * 20)})
    assert result == rows


def test_non_latin_image_text_can_qualify_without_spaces(tmp_path):
    rows = [page(3, "", candidate=True, flagged=True)]
    result, _calls = run(tmp_path, rows, {3: ocr(3, "这是图像里的正文文字")})
    assert result[0]["text"] == "这是图像里的正文文字"


def test_accepted_recovery_keeps_engine_receipt_and_clears_missing_text_warning(tmp_path):
    rows = [page(2, "", flagged=True)]
    result, _calls = run(tmp_path, rows, {2: ocr(2, "Alice found useful words inside the picture.",
        ocrEngine="injected-strong-engine", ocrModelRevision="pinned-revision")})
    assert result[0]["ocrEngine"] == "injected-strong-engine"
    assert result[0]["ocrModelRevision"] == "pinned-revision"
    assert result[0]["method"] == "ocr"
    assert not any(row["code"] in {"empty", "empty-page", "possible-image-text"}
                   for row in result[0].get("warnings", []))


def test_useful_recognizer_warnings_survive_but_stale_missing_text_flags_do_not(tmp_path):
    rows = [page(2, "", flagged=True)]
    recovered = ocr(2, "A useful recovered passage contains two columns of text.")
    recovered["warnings"] = [{"code": "reading-order", "label": "Check the column order."},
                              {"code": "empty", "label": "Obsolete empty result."}]
    result, _calls = run(tmp_path, rows, {2: recovered})
    assert result[0]["warnings"] == [{"code": "reading-order", "label": "Check the column order."}]


def _screened_raw_fixture(tmp_path):
    import json
    import subprocess
    from reportlab.pdfgen.canvas import Canvas

    source = tmp_path / "source.pdf"
    canvas = Canvas(str(source))
    for number in range(1, 4):
        canvas.drawString(50, 700, f"Synthetic physical page {number}")
        canvas.showPage()
    canvas.save()
    rows = [{"page": 1, "text": "Useful native prose."},
            {"page": 2, "text": "Page 115 Publisher"}, {"page": 3, "text": ""}]
    calls = []

    def command(arguments, **_options):
        calls.append(arguments)
        if arguments[1] == "is-complex":
            assert arguments[-2:] == ["--max-pages", "3"]
            stats = [{"pageNumber": number, "textLength": len(row["text"]),
                      "imageCoverage": .7 if number == 2 else 0}
                     for number, row in enumerate(rows, 1)]
            return subprocess.CompletedProcess(arguments, 1, stdout=json.dumps(stats).encode())
        assert "--no-ocr" in arguments
        selected = rows
        if "--target-pages" in arguments:
            selected = [rows[int(arguments[arguments.index("--target-pages") + 1]) - 1]]
        write_stub_text(tmp_path, arguments[-1], json.dumps({"pages": selected}))
        return subprocess.CompletedProcess(arguments, 0)

    return source, rows, calls, command


def test_raw_preview_and_full_screen_use_same_physical_candidates_and_recovery(tmp_path):
    from meowdiobooks.backend.documents import extract_full_document, extract_pdf_page

    source, _rows, commands, command = _screened_raw_fixture(tmp_path)
    cache = tmp_path / "cache"
    preview = extract_pdf_page(source, cache, 2, "liteparse", command_runner=command)
    raw = extract_full_document(source, cache, "liteparse", command_runner=command)
    assert preview["ocrCandidate"] is True
    assert [row["ocrCandidate"] for row in raw] == [False, True, False]
    calls = []

    def recognize(_source, _cache, number, method):
        calls.append((number, method))
        return ocr(number, "The interviewer describes a thoughtful student with room for growth.")

    recovered_preview = auto_recover_pdf_pages(source, cache, [preview], recognize, preview=True)
    recovered_full = auto_recover_pdf_pages(source, cache, raw, recognize)
    assert recovered_preview[0]["text"] == recovered_full[1]["text"]
    assert calls == [(2, "ocr"), (2, "ocr")]
    assert len([row for row in commands if row[1] == "is-complex"]) == 1


def test_old_raw_page_cache_gets_full_document_screen_before_automatic_preview(tmp_path):
    import json
    from meowdiobooks.backend.documents import _LITEPARSE_CACHE_KEY, extract_pdf_page

    source, rows, commands, command = _screened_raw_fixture(tmp_path)
    cache = tmp_path / "cache"
    saved = cache / "extraction" / _LITEPARSE_CACHE_KEY / "page-0002.json"
    saved.parent.mkdir(parents=True)
    saved.write_text(json.dumps({**rows[1], "method": "liteparse", "warnings": []}))
    result = extract_pdf_page(source, cache, 2, "liteparse", command_runner=command)
    assert result["cached"] is True and result["ocrCandidate"] is True
    assert [row[1] for row in commands] == ["is-complex"]


@pytest.mark.parametrize("bad", [None, {"page": 3, "text": "Words on wrong page."},
                                  {"page": True, "text": "Words with bool page."},
                                  {"page": 2, "text": None}, {"page": 2, "text": ["bad"]}])
def test_wrong_page_or_invalid_output_is_not_silently_accepted(tmp_path, bad):
    rows = [page(2, "", flagged=True)]
    with pytest.raises(ValueError):
        run(tmp_path, rows, {2: bad})


def test_technical_failure_does_not_return_partially_recovered_pages(tmp_path):
    rows = [page(2, "", flagged=True), page(3, "", flagged=True)]
    before = deepcopy(rows)
    with pytest.raises(RuntimeError, match="Recognizer failed"):
        run(tmp_path, rows, {2: ocr(2, "Useful newly recovered story text."),
                             3: RuntimeError("Recognizer failed")})
    assert rows == before


def test_cancellation_interrupts_automatic_recovery_without_mutating_raw_pages(tmp_path):
    class Cancelled(Exception):
        pass

    rows = [page(2, "", flagged=True), page(3, "", flagged=True)]
    before = deepcopy(rows)

    def cancel(*_args):
        raise Cancelled()

    with pytest.raises(Cancelled):
        run(tmp_path, rows, {2: ocr(2, "Useful newly recovered story text.")}, report=cancel)
    assert rows == before


@pytest.fixture
def automatic_workflow(tmp_path):
    from io import BytesIO
    from fastapi.testclient import TestClient
    from reportlab.pdfgen.canvas import Canvas
    from meowdiobooks.backend.app_v2 import create_app_v2
    from meowdiobooks.backend.documents import inspect_source
    from meowdiobooks.backend.chapter_semantic import chapter_review_plan, assemble_chapter_review

    class Processor:
        def __init__(self):
            self.raw = [page(1, "Alice opened her book to read the story.", candidate=False),
                        page(2, "Page 115 Publisher", candidate=True, flagged=True),
                        page(3, "", candidate=False)]
            self.recovered = '“What is the use of a book,” thought Alice, “without pictures or conversations?”'
            self.calls = []

        def inspect_source(self, source):
            return inspect_source(source)

        def pdf_metadata(self, _source):
            return {}

        def extract_full_document(self, _source, _cache, method, _report):
            self.calls.append(("full", method))
            assert method in {"liteparse", "native", "layout"}
            return [{**row, "method": method} for row in deepcopy(self.raw)]

        def extract_pdf_page(self, _source, _cache, number, method):
            self.calls.append((number, method))
            if method != "ocr":
                return {**deepcopy(self.raw[number - 1]), "method": method}
            if isinstance(self.recovered, Exception):
                raise self.recovered
            return ocr(number, self.recovered, ocrEngine="injected-paddle", ocrModelRevision="pinned")

        def render_pdf_page(self, _source, _cache, number):
            self.calls.append((number, "render"))
            return tmp_path / f"page-{number}.png"

    processor = Processor()

    def cleanup(_root, extracted, dialogue, *_args, **_kwargs):
        plan = chapter_review_plan(extracted, dialogue)
        batches = [{"targets": packet, "response": {"assessments": [
            {"boundaryId": row["boundaryId"], "role": "other", "reason": "Offline fixture."}
            for row in packet]}} for packet in plan["packets"]]
        return {"occurrences": [], "summary": {"inputWindows": 0},
                "chapterReview": assemble_chapter_review(plan, batches)}

    output = BytesIO()
    canvas = Canvas(output)
    for number in range(1, 4):
        canvas.drawString(72, 760, f"Physical page {number}")
        canvas.showPage()
    canvas.save()
    with TestClient(create_app_v2(tmp_path, file_processor=processor, cleanup_reviewer=cleanup)) as client:
        response = client.post("/api/books/import", files={
            "file": ("source.pdf", output.getvalue(), "application/pdf"),
        })
        assert response.status_code == 201, response.text
        book_id = response.json()["book"]["id"]
        yield client, book_id, tmp_path / "packages" / book_id, processor


def test_default_extraction_recovers_before_normal_speaker_detection_and_review(automatic_workflow, monkeypatch):
    from meowdiobooks.backend.artifacts import artifact_history, read_artifact
    from meowdiobooks.backend.dialogue_ai import resolve_dialogue
    from tests.backend.test_app_v2 import _accept, _process

    client, book_id, package, processor = automatic_workflow
    observed = []

    def attribute(_root, scan, strategy, _report, targets):
        observed.extend(row["source"] for row in scan["partition"] if row["page"] == 2)
        return resolve_dialogue(scan, strategy, lambda *_args: "Alice", targets)

    monkeypatch.setattr("meowdiobooks.backend.app_v2.run_dialogue_qwen", attribute)
    extracted = _process(client, book_id, "extract", {"method": "liteparse"})
    assert processor.calls == [("full", "liteparse"), (2, "ocr")]
    _accept(client, book_id, "extract", extracted["revision"])
    accepted = read_artifact(package, "extraction")
    assert accepted["method"] == "liteparse"
    assert accepted["pages"][0] == processor.raw[0]
    assert accepted["pages"][1]["ocrEngine"] == "injected-paddle"
    assert accepted["pages"][1]["text"] == processor.recovered
    assert accepted["pages"][2] == processor.raw[2]

    candidate = _process(client, book_id, "dialogue", {"strategy": "fill-gaps", "attributionRoute": "local"})
    _accept(client, book_id, "dialogue", candidate["revision"])
    dialogue = read_artifact(package, "dialogue")
    rows = [row for row in dialogue["spans"] if row["page"] == 2]
    assert "".join(observed) == processor.recovered
    assert [row["renderRole"] for row in rows] == ["dialogue", "narration", "dialogue"]
    assert [row.get("resolvedSpeakerLabel") for row in rows] == ["Alice", None, "Alice"]
    assert rows[1]["text"].strip() == "thought Alice,"
    _process(client, book_id, "review", {})
    reviewed = artifact_history(package, "review")[-1]
    assert reviewed["sourceReconstruction"]["status"] == "exact"
    assert not any(row["kind"] in {"empty-page", "missing-image-text"} for row in reviewed["warnings"])


def test_standard_preview_uses_the_same_automatic_provider_and_preserves_physical_page(automatic_workflow):
    client, book_id, _package, processor = automatic_workflow
    response = client.post(f"/api/books/{book_id}/extraction/preview", json={"page": 2, "method": "liteparse"})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["page"] == 2 and result["pageCount"] == 3
    assert result["text"] == processor.recovered and result["ocrEngine"] == "injected-paddle"
    assert processor.calls == [(2, "liteparse"), (2, "ocr"), (2, "render")]


@pytest.mark.parametrize("method", ["native", "layout"])
def test_other_native_methods_do_not_silently_trigger_standard_fallback(automatic_workflow, method):
    from tests.backend.test_app_v2 import _process

    client, book_id, _package, processor = automatic_workflow
    _process(client, book_id, "extract", {"method": method})
    assert processor.calls == [("full", method)]


def test_automatic_recognition_failure_preserves_the_accepted_extraction(automatic_workflow):
    from meowdiobooks.backend.artifacts import artifact_history, read_artifact
    from tests.backend.test_app_v2 import _accept, _process, _wait

    client, book_id, package, processor = automatic_workflow
    candidate = _process(client, book_id, "extract", {"method": "liteparse"})
    _accept(client, book_id, "extract", candidate["revision"])
    original = deepcopy(read_artifact(package, "extraction"))
    before = artifact_history(package, "extraction")
    processor.recovered = RuntimeError("Synthetic recognizer failure")
    queued = client.post(f"/api/books/{book_id}/stages/extract/process", json={"settings": {"method": "liteparse"}})
    assert queued.status_code == 202, queued.text
    assert _wait(client, queued.json()["id"])["status"] == "failed"
    assert read_artifact(package, "extraction") == original
    assert artifact_history(package, "extraction") == before
