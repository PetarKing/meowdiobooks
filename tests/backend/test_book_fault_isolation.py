"""One malformed book must not make healthy books disappear or destroy raw state."""

import json
import os
from pathlib import Path
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from meowdiobooks.backend.app_v2 import _directory_size, create_app_v2
from meowdiobooks.backend.models import Book, Job
from meowdiobooks.backend.storage import JsonStore


def _records():
    healthy = Book(id="healthy", title="A healthy book")
    stale = Book(id="stale", title="PRIVATE TITLE").model_dump(mode="json")
    stale["accepted_stage_revisions"] = [
        {"stage": "enrich", "revision": 1, "data": {"text": "PRIVATE TEXT"}}
    ]
    return healthy, stale


def _seed(path):
    healthy, stale = _records()
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = {healthy.id: healthy.model_dump(mode="json"), "stale": stale, "corrupt": ["bad"]}
    path.write_text(json.dumps(raw))
    return healthy, raw


def test_books_filter_individual_validation_failures_without_leaking_input(tmp_path, caplog):
    path = tmp_path / "books.json"
    healthy, raw = _seed(path)
    store = JsonStore(path, Book)

    assert store.all() == [healthy]
    assert store.get(healthy.id) == healthy
    assert store.get("stale") is None
    assert store.get("corrupt") is None
    assert "Skipping invalid stored book record" in caplog.text
    assert "PRIVATE" not in caplog.text
    assert "enrich" not in caplog.text
    assert json.loads(path.read_text()) == raw


@pytest.mark.parametrize("operation", ["put", "put_many", "update", "delete", "delete_where"])
def test_healthy_mutations_preserve_skipped_raw_records(tmp_path, operation):
    path = tmp_path / "books.json"
    healthy, raw = _seed(path)
    store = JsonStore(path, Book)
    if operation == "put":
        store.put(healthy.model_copy(update={"title": "Changed"}))
    elif operation == "put_many":
        store.put_many([healthy.model_copy(update={"title": "Changed"})])
    elif operation == "update":
        store.update(healthy.id, lambda book: book.model_copy(update={"title": "Changed"}))
    elif operation == "delete":
        assert store.delete(healthy.id) == healthy
    else:
        assert store.delete_where(lambda _book: True) == [healthy]
    persisted = json.loads(path.read_text())
    assert persisted["stale"] == raw["stale"]
    assert persisted["corrupt"] == raw["corrupt"]
    assert store.update("stale", lambda _book: pytest.fail("invalid input reached callback")) is None
    assert store.delete("stale") is None
    assert json.loads(path.read_text()) == persisted


def test_nonbook_collections_are_still_strict(tmp_path):
    path = tmp_path / "jobs.json"
    raw = {"broken": {"status": "invalid"}}
    path.write_text(json.dumps(raw))
    store = JsonStore(path, Job)
    with pytest.raises(ValidationError):
        store.all()
    with pytest.raises(ValidationError):
        store.put(Job(kind="new-job"))
    assert json.loads(path.read_text()) == raw


@pytest.mark.parametrize("raw", ["{invalid-json", "[]"])
def test_storewide_corruption_is_not_an_empty_success(tmp_path, raw):
    path = tmp_path / "books.json"
    path.write_text(raw)
    with pytest.raises(RuntimeError):
        JsonStore(path, Book).all()


def test_api_list_and_direct_access_survive_other_malformed_books(tmp_path):
    healthy, _raw = _seed(tmp_path / "books.json")
    with TestClient(create_app_v2(data_dir=tmp_path)) as client:
        response = client.get("/api/books")
        assert response.status_code == 200
        assert [book["id"] for book in response.json()] == [healthy.id]
        assert client.get(f"/api/books/{healthy.id}").status_code == 200
        assert client.get("/api/books/stale").status_code == 404


def test_api_list_skips_only_book_with_workspace_failure(tmp_path, monkeypatch, caplog):
    app = create_app_v2(data_dir=tmp_path)
    app.state.books.put_many([Book(id="inaccessible", title="Hidden"), Book(id="good", title="Shown")])

    def size(path):
        if path.name == "inaccessible":
            raise PermissionError("PRIVATE PATH")
        return 123

    monkeypatch.setattr("meowdiobooks.backend.app_v2._directory_size", size)
    with TestClient(app) as client:
        response = client.get("/api/books")
    assert response.status_code == 200
    assert [(book["id"], book["asset_size_bytes"]) for book in response.json()] == [("good", 123)]
    assert "Skipping book with inaccessible workspace" in caplog.text
    assert "PRIVATE PATH" not in caplog.text
    assert len(app.state.books.all()) == 2


def test_api_store_failure_still_reports_unavailable(tmp_path, monkeypatch):
    app = create_app_v2(data_dir=tmp_path)

    def fail():
        raise OSError("Store unavailable")

    monkeypatch.setattr(app.state.books, "all", fail)
    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.get("/api/books").status_code == 500


def test_directory_size_keeps_missing_workspace_but_reports_unreadable_files(tmp_path, monkeypatch):
    assert _directory_size(tmp_path / "missing") == 0
    (tmp_path / "source.pdf").write_bytes(b"source")
    original = os.stat

    def fail_source(path, **kwargs):
        if Path(path).name == "source.pdf":
            raise PermissionError("private path")
        return original(path, **kwargs)

    monkeypatch.setattr("meowdiobooks.backend.app_v2.os.stat", fail_source)
    with pytest.raises(PermissionError):
        _directory_size(tmp_path)


def test_api_list_handles_mixed_naive_and_aware_book_timestamps(tmp_path):
    app = create_app_v2(data_dir=tmp_path)
    app.state.books.put_many([
        Book(id="naive", title="Older record", updated_at=datetime(2020, 1, 1)),
        Book(id="aware", title="New record"),
    ])
    with TestClient(app) as client:
        response = client.get("/api/books")
    assert response.status_code == 200
    assert [book["id"] for book in response.json()] == ["aware", "naive"]
