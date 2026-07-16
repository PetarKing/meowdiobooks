from meowdiobooks.backend.documents import extract_full_document, representative_pages


def test_representative_pages_are_in_range_and_unique():
    pages = representative_pages(251)
    assert [row["page"] for row in pages] == [1, 50, 126, 201, 251]
    assert representative_pages(1) == [{"page": 1, "reason": "opening page"}]


def test_full_extraction_retains_per_page_method_and_detector_evidence(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "meowdiobooks.backend.documents.extract_full_liteparse",
        lambda *_args: [{"page": 1, "text": ""}],
    )

    pages = extract_full_document(tmp_path / "book.pdf", tmp_path / "cache", "liteparse")

    assert pages == [
        {
            "page": 1,
            "text": "",
            "warnings": [{"code": "empty", "label": "No text extracted"}],
            "method": "liteparse",
        }
    ]
