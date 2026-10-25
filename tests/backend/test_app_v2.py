import time
import json
from contextlib import contextmanager
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen.canvas import Canvas

from meowdiobooks.backend.app_v2 import (
    _commit_library_export,
    _expand_cast_label_mapping,
    create_app_v2,
)
from meowdiobooks.backend.storage import JsonStore
from meowdiobooks.backend.artifacts import read_artifact, write_artifact
from meowdiobooks.backend.dialogue_ai import resolve_dialogue
from meowdiobooks.backend.models import Job, LibraryExport
from meowdiobooks.backend.review import ReviewContractError


@pytest.fixture(autouse=True)
def offline_cleanup_provider(monkeypatch):
    """These lifecycle tests isolate provider behavior, tested in test_cleanup_remote."""
    monkeypatch.setattr(
        "meowdiobooks.backend.cleanup_remote.run_cleanup_review",
        lambda *args, **kwargs: {"occurrences": [], "summary": {"inputWindows": 0}},
    )


def _pdf(text: str = "Subaru: [Run!]") -> bytes:
    output = BytesIO()
    canvas = Canvas(output)
    canvas.drawString(72, 760, text)
    canvas.showPage()
    canvas.save()
    return output.getvalue()


def _metadata_pdf() -> bytes:
    output = BytesIO()
    canvas = Canvas(output)
    canvas.setTitle("A Cat Finds a Voice")
    canvas.setAuthor("Maou")
    canvas.drawString(72, 760, "Chapter 1")
    canvas.showPage()
    canvas.save()
    return output.getvalue()


def _wait(client: TestClient, job_id: str) -> dict:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        result = client.get(f"/api/jobs/{job_id}").json()
        if result["status"] in {"succeeded", "failed"}:
            return result
        time.sleep(0.01)
    raise AssertionError(f"Job {job_id} did not finish")


def _process(client: TestClient, book_id: str, stage: str, settings: dict) -> dict:
    queued = client.post(
        f"/api/books/{book_id}/stages/{stage}/process",
        json={"settings": settings},
    )
    assert queued.status_code == 202, queued.text
    finished = _wait(client, queued.json()["id"])
    assert finished["status"] == "succeeded", finished
    return finished["result"]


def _accept(client: TestClient, book_id: str, stage: str, revision: str, decisions=None):
    response = client.post(
        f"/api/books/{book_id}/stages/{stage}/accept",
        json={"revision": revision, "decisions": decisions or []},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_delete_book_removes_working_assets_but_preserves_library_export(tmp_path):
    data_dir = tmp_path / "state"
    deleting: list[str] = []
    export_path = tmp_path / "finished" / "Alice.m4b"
    export_path.parent.mkdir()
    export_path.write_bytes(b"finished-audiobook")
    app = create_app_v2(
        data_dir=data_dir,
        library_dir=export_path.parent,
        on_book_deleting=lambda book: deleting.append(book.id),
    )

    with TestClient(app) as client:
        imported = client.post(
            "/api/books/import", files={"file": ("alice.pdf", _pdf(), "application/pdf")}
        ).json()["book"]
        book_id = imported["id"]
        generated = data_dir / "packages" / book_id / "audio" / "chapter-1.wav"
        generated.parent.mkdir(parents=True)
        generated.write_bytes(b"working-audio")
        item = LibraryExport(
            book_id=book_id,
            title="Alice",
            author="Lewis Carroll",
            filename=export_path.name,
            file_path=str(export_path),
            chapter_count=1,
            size_bytes=export_path.stat().st_size,
        )
        (data_dir / "library.json").write_text(
            json.dumps({item.id: item.model_dump(mode="json")}), encoding="utf-8"
        )

        listed = client.get("/api/books").json()
        assert listed[0]["asset_size_bytes"] >= len(b"working-audio")
        response = client.delete(f"/api/books/{book_id}")

        assert response.status_code == 204
        assert deleting == [book_id]
        assert client.get("/api/books").json() == []
        assert not (data_dir / "packages" / book_id).exists()
        assert export_path.read_bytes() == b"finished-audiobook"
        assert client.get("/api/library").json()[0]["id"] == item.id


def test_object_backed_library_lists_without_a_local_export(tmp_path: Path):
    database = tmp_path / "database"
    library = JsonStore(database / "library.json", LibraryExport)
    item = LibraryExport(
        book_id="book-1",
        title="Durable audiobook",
        author="Maou",
        filename="Durable audiobook.m4b",
        file_path=str(tmp_path / "missing-local-copy.m4b"),
        chapter_count=1,
        chapter_titles=["Chapter 1"],
        size_bytes=1024,
    )
    library.put(item)

    app = create_app_v2(
        tmp_path / "workspace",
        store_factory=lambda name, model: JsonStore(database / f"{name}.json", model),
        library_export_available=lambda export: export.id == item.id,
    )

    with TestClient(app) as client:
        assert client.get("/api/library").json()[0]["id"] == item.id


def test_object_backed_library_evicts_only_after_hook_and_store_commit(tmp_path: Path):
    audio_source = tmp_path / "assembled.m4b"
    cover_source = tmp_path / "assembled.png"
    audio_source.write_bytes(b"audio")
    cover_source.write_bytes(b"cover")
    audio_destination = tmp_path / "library" / "book.m4b"
    cover_destination = tmp_path / "covers" / "book.png"
    audio_destination.parent.mkdir()
    cover_destination.parent.mkdir()
    library = JsonStore(tmp_path / "library.json", LibraryExport)
    item = LibraryExport(
        book_id="book-1",
        title="Durable audiobook",
        author="Maou",
        filename=audio_destination.name,
        file_path=str(audio_destination),
        cover_path=str(cover_destination),
        chapter_count=1,
        size_bytes=len(b"audio"),
    )
    events: list[str] = []

    def persist(_item: LibraryExport, audio: Path, cover: Path) -> None:
        assert audio.read_bytes() == b"audio"
        assert cover.read_bytes() == b"cover"
        assert library.get(item.id) is None
        events.append("durable")

    _commit_library_export(
        item,
        audio_source=audio_source,
        cover_source=cover_source,
        audio_destination=audio_destination,
        cover_destination=cover_destination,
        library=library,
        on_library_exported=persist,
        retain_local=False,
    )

    assert events == ["durable"]
    assert library.get(item.id) == item
    assert not audio_destination.exists()
    assert not cover_destination.exists()


def test_object_backed_library_keeps_no_entry_when_durable_hook_fails(tmp_path: Path):
    audio_source = tmp_path / "assembled.m4b"
    cover_source = tmp_path / "assembled.png"
    audio_source.write_bytes(b"audio")
    cover_source.write_bytes(b"cover")
    audio_destination = tmp_path / "library" / "book.m4b"
    cover_destination = tmp_path / "covers" / "book.png"
    audio_destination.parent.mkdir()
    cover_destination.parent.mkdir()
    library = JsonStore(tmp_path / "library.json", LibraryExport)
    item = LibraryExport(
        book_id="book-1",
        title="Failed audiobook",
        author="Maou",
        filename=audio_destination.name,
        file_path=str(audio_destination),
        chapter_count=1,
        size_bytes=len(b"audio"),
    )

    def fail(_item: LibraryExport, _audio: Path, _cover: Path) -> None:
        raise RuntimeError("S3 unavailable")

    with pytest.raises(RuntimeError, match="S3 unavailable"):
        _commit_library_export(
            item,
            audio_source=audio_source,
            cover_source=cover_source,
            audio_destination=audio_destination,
            cover_destination=cover_destination,
            library=library,
            on_library_exported=fail,
            retain_local=False,
        )

    assert library.get(item.id) is None
    assert not audio_destination.exists()
    assert not cover_destination.exists()


def test_delete_book_is_blocked_during_active_processing(tmp_path):
    deleting: list[str] = []
    app = create_app_v2(
        data_dir=tmp_path / "state",
        on_book_deleting=lambda book: deleting.append(book.id),
    )
    with TestClient(app) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("alice.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]
        app.state.jobs.put(Job(kind="v2:extract", payload={"book_id": book_id}))

        response = client.delete(f"/api/books/{book_id}")

        assert response.status_code == 409
        assert deleting == []
        assert client.get(f"/api/books/{book_id}").status_code == 200


def test_delete_book_aborts_before_local_state_when_durable_cleanup_fails(tmp_path):
    data_dir = tmp_path / "state"

    def fail_cleanup(_book):
        raise RuntimeError("private storage diagnostic")

    app = create_app_v2(data_dir=data_dir, on_book_deleting=fail_cleanup)
    with TestClient(app) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("alice.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]

        response = client.delete(f"/api/books/{book_id}")

        assert response.status_code == 500
        assert response.json() == {
            "detail": "Could not remove this book's stored working files."
        }
        assert "private storage diagnostic" not in response.text
        assert client.get(f"/api/books/{book_id}").status_code == 200
        assert (data_dir / "packages" / book_id).is_dir()


def test_composition_can_replace_the_default_job_resource_preflight(tmp_path):
    class HostedCapacityError(RuntimeError):
        public_message = "Hosted capacity is temporarily unavailable."

    checks = 0

    def reject_job() -> None:
        nonlocal checks
        checks += 1
        raise HostedCapacityError("private capacity diagnostic")

    app = create_app_v2(tmp_path, job_preflight=reject_job)
    with TestClient(app) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("alice.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]

        queued = client.post(
            f"/api/books/{book_id}/stages/extract/process",
            json={"settings": {"method": "native"}},
        )
        finished = _wait(client, queued.json()["id"])

        assert checks == 1
        assert finished["status"] == "failed"
        assert finished["error"] == HostedCapacityError.public_message
        assert "private capacity diagnostic" not in finished["error"]


def test_cast_mapping_does_not_restore_a_model_alias_detached_during_review():
    finalized = {"labelToCharacterId": {"Cecilus": "cec", "Cecilus Segmunt": "seg"}}
    proposal = {
        "dossiers": [
            {"label": "Cecilus", "sourceSpellings": ["CECILUS"]},
            {"label": "Cecilus Segmunt", "sourceSpellings": []},
        ],
        "proposals": [
            {"label": "Cecilus", "aliases": ["Cecilus Segmunt"]},
            {"label": "Cecilus Segmunt", "aliases": ["Cecilus"]},
        ],
    }

    _expand_cast_label_mapping(finalized, proposal)

    assert finalized["labelToCharacterId"] == {
        "Cecilus": "cec",
        "CECILUS": "cec",
        "Cecilus Segmunt": "seg",
    }


def test_v2_import_extract_dialogue_review_are_distinct_transactional_stages(tmp_path, monkeypatch):
    extracted_pages = [
        {
            "page": 1,
            "text": "Subaru: [Run!]\n\nAlice said, “Wait.”",
            "warnings": [],
        }
    ]
    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.extract_full_document",
        lambda _source, _cache, _method, report: (report(100, "done"), extracted_pages)[1],
    )
    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.run_dialogue_qwen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Qwen must not run")),
    )

    with TestClient(create_app_v2(tmp_path)) as client:
        imported = client.post(
            "/api/books/import",
            files={"file": ("book.pdf", _pdf(), "application/pdf")},
        )
        assert imported.status_code == 201
        book_id = imported.json()["book"]["id"]

        extraction = _process(client, book_id, "extract", {"method": "native"})
        # Processing creates a candidate. It is not active until the user accepts it.
        extraction_snapshot = client.get(f"/api/books/{book_id}/snapshot").json()
        assert extraction_snapshot["activeArtifacts"] == {}
        assert (
            extraction_snapshot["pendingCandidates"]["extraction"]["revision"]
            == extraction["revision"]
        )
        _accept(client, book_id, "extract", extraction["revision"])

        preview = client.post(
            f"/api/books/{book_id}/dialogue/preview",
            json={
                "enabledRegexIds": ["label-brackets", "unlabeled-curly-quotes"],
                "openSpeakerLabels": ["???", "UNKNOWN"],
                "customRegexes": [
                    {
                        "id": "custom-angle",
                        "pattern": r"<(?P<speaker>[^>]+)>\s*(?P<text>[^\n]+)",
                    }
                ],
            },
        )
        assert preview.status_code == 200, preview.text
        assert {row["id"] for row in preview.json()["successfulProfiles"]} == {
            "label-brackets",
            "unlabeled-curly-quotes",
        }
        assert preview.json()["summary"] == {
            "regexClaims": 2,
            "explicitTurns": 1,
            "openSpeakerTurns": 0,
            "unlabelledCandidates": 1,
            "conflicts": 0,
            "structuralIssues": 0,
            "continuedTurns": 0,
        }

        dialogue = _process(
            client,
            book_id,
            "dialogue",
            {
                "strategy": "narrate",
                "enabledRegexIds": ["label-brackets", "unlabeled-curly-quotes"],
            },
        )
        candidate_response = client.get(
            f"/api/books/{book_id}/stages/dialogue/candidates/{dialogue['revision']}"
        )
        assert candidate_response.status_code == 200
        assert candidate_response.json()["strategy"] == "narrate"
        assert candidate_response.json()["spans"]
        pending_snapshot = client.get(f"/api/books/{book_id}/snapshot").json()
        assert pending_snapshot["pendingCandidates"]["dialogue"] == {
            "revision": dialogue["revision"],
            "status": "candidate",
            "extractionRevision": extraction["revision"],
            "dialogueRevision": None,
            "summary": candidate_response.json()["resultSummary"],
        }
        _accept(client, book_id, "dialogue", dialogue["revision"])
        review = _process(client, book_id, "review", {})
        review_snapshot = client.get(f"/api/books/{book_id}/snapshot").json()
        assert review_snapshot["pendingCandidates"]["review"]["revision"] == review["revision"]
        assert (
            review_snapshot["pendingCandidates"]["review"]["extractionRevision"]
            == extraction["revision"]
        )
        assert (
            review_snapshot["pendingCandidates"]["review"]["dialogueRevision"]
            == dialogue["revision"]
        )
        _accept(client, book_id, "review", review["revision"])

        snapshot = client.get(f"/api/books/{book_id}/snapshot").json()
        assert set(snapshot["activeArtifacts"]) == {"extraction", "dialogue", "review"}
        assert snapshot["dialogue"]["strategy"] == "narrate"
        assert snapshot["dialogueWarnings"]["conflicts"] == []
        assert len(snapshot["dialogueWarnings"]["unresolved"]) == 1
        assert snapshot["dialogueWarnings"]["unresolved"][0]["fallback"] == "narrator"
        assert snapshot["pendingCandidates"] == {}
        assert snapshot["reviewWarnings"] == []
        assert len(snapshot["history"]["extraction"]) == 1
        assert snapshot["history"]["extraction"][0]["status"] == "accepted"
        # Candidate plus accepted receipt remain durably inspectable.
        assert len(snapshot["reviewInspection"]["history"]) == 2
        assert {row["status"] for row in snapshot["reviewInspection"]["history"]} == {
            "accepted",
            "candidate",
        }
        assert snapshot["reviewInspection"]["boundaryDecisions"] == []

        _, cast_candidate = write_artifact(
            tmp_path / "packages" / book_id,
            "cast",
            {
                "revision": "cast-review-1",
                "phase": "identity-review",
                "status": "needs-review",
                "dialogueRevision": dialogue["revision"],
                "reviewRevision": snapshot["activeArtifacts"]["review"],
                "dossiers": [],
                "proposals": [],
            },
            publish=False,
        )
        resumed = client.get(f"/api/books/{book_id}/snapshot").json()
        assert resumed["cast"] == cast_candidate
        assert resumed["pendingCandidates"]["cast"]["revision"] == "cast-review-1"


def test_dialogue_conflicts_block_processing_before_qwen_runs(tmp_path, monkeypatch):
    pages = [{"page": 1, "text": "<Alice>Hello</Alice>", "warnings": []}]
    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.extract_full_document",
        lambda _source, _cache, _method, _report: pages,
    )
    qwen_calls = []
    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.run_dialogue_qwen",
        lambda *_args, **_kwargs: qwen_calls.append(True),
    )

    with TestClient(create_app_v2(tmp_path)) as client:
        imported = client.post(
            "/api/books/import",
            files={"file": ("book.pdf", _pdf(), "application/pdf")},
        )
        book_id = imported.json()["book"]["id"]
        extraction = _process(client, book_id, "extract", {"method": "native"})
        _accept(client, book_id, "extract", extraction["revision"])

        queued = client.post(
            f"/api/books/{book_id}/stages/dialogue/process",
            json={
                "settings": {
                    "strategy": "fill-gaps",
                    "customRegexes": [
                        {
                            "id": "outer",
                            "pattern": r"<(?P<speaker>[^>]+)>(?P<text>.+)</[^>]+>",
                        },
                        {"id": "inner", "pattern": r"(?P<text>Hello</Alice>)"},
                    ],
                    "enabledRegexIds": ["outer", "inner"],
                }
            },
        )
        assert queued.status_code == 202
        finished = _wait(client, queued.json()["id"])

        assert finished["status"] == "failed"
        assert "overlapping regex claim" in finished["error"]
        assert qwen_calls == []


def test_targeted_dialogue_uses_qwen_only_for_selected_open_spans(tmp_path, monkeypatch):
    pages = [{"page": 1, "text": "Subaru: [Where?]\n\n???: [Behind you.]", "warnings": []}]
    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.extract_full_document",
        lambda _source, _cache, _method, _report: pages,
    )
    calls = []

    def fake_qwen(_repo, scan, strategy, report, attribution_targets):
        calls.append(strategy)

        def complete(_system, _prompt, owners):
            assert len(owners) == 1
            return "Subaru"

        report(100, "resolved")
        return resolve_dialogue(scan, strategy, complete, attribution_targets)

    monkeypatch.setattr("meowdiobooks.backend.app_v2.run_dialogue_qwen", fake_qwen)

    with TestClient(create_app_v2(tmp_path)) as client:
        imported = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()
        book_id = imported["book"]["id"]
        extraction = _process(client, book_id, "extract", {"method": "native"})
        _accept(client, book_id, "extract", extraction["revision"])
        dialogue = _process(
            client,
            book_id,
            "dialogue",
            {"strategy": "fill-gaps", "openSpeakerLabels": ["???"]},
        )

        assert calls == ["fill-gaps"]
        candidate = next(
            row
            for row in client.get(f"/api/books/{book_id}/snapshot").json()["history"]["dialogue"]
            if row["revision"] == dialogue["revision"]
        )
        assert candidate["summary"]["explicitTurns"] == 1
        assert candidate["summary"]["aiAttributed"] == 1
        full_candidate = client.get(
            f"/api/books/{book_id}/stages/dialogue/candidates/{dialogue['revision']}"
        ).json()
        target_id = full_candidate["aiWindows"][0]["ownerIds"][0]

        _accept(
            client,
            book_id,
            "dialogue",
            dialogue["revision"],
            [
                {
                    "spanId": target_id,
                    "action": "speaker",
                    "speakerLabel": "Emilia",
                    "provenance": "user",
                }
            ],
        )

        accepted = read_artifact(tmp_path / "packages" / book_id, "dialogue")
        corrected = next(row for row in accepted["spans"] if row.get("speakerStatus") == "user")
        assert accepted["revision"] != dialogue["revision"]
        assert accepted["correctedFromRevision"] == dialogue["revision"]
        assert corrected["resolvedSpeakerLabel"] == "Emilia"
        assert accepted["resultSummary"]["userCorrected"] == 1
        resumed = client.get(f"/api/books/{book_id}/snapshot").json()
        assert resumed["activeArtifacts"]["dialogue"] == accepted["revision"]
        assert "dialogue" not in resumed["pendingCandidates"]
        assert resumed["dialogue"]["userCorrections"] == accepted["userCorrections"]
        assert (
            next(row for row in resumed["dialogue"]["spans"] if row.get("speakerStatus") == "user")[
                "resolvedSpeakerLabel"
            ]
            == "Emilia"
        )


def test_accepting_new_extraction_invalidates_active_downstream_artifacts(tmp_path, monkeypatch):
    pages = [{"page": 1, "text": "Subaru: [Run!]", "warnings": []}]
    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.extract_full_document",
        lambda _source, _cache, _method, _report: pages,
    )
    with TestClient(create_app_v2(tmp_path)) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]
        first = _process(client, book_id, "extract", {"method": "native"})
        _accept(client, book_id, "extract", first["revision"])
        dialogue = _process(client, book_id, "dialogue", {"strategy": "narrate"})
        _accept(client, book_id, "dialogue", dialogue["revision"])
        assert "dialogue" in client.get(f"/api/books/{book_id}/snapshot").json()["activeArtifacts"]

        replacement = _process(client, book_id, "extract", {"method": "layout"})
        _accept(client, book_id, "extract", replacement["revision"])

        active = client.get(f"/api/books/{book_id}/snapshot").json()["activeArtifacts"]
        assert active == {"extraction": replacement["revision"]}
        stale = client.post(
            f"/api/books/{book_id}/stages/dialogue/accept",
            json={"revision": dialogue["revision"], "decisions": []},
        )
        assert stale.status_code == 409
        assert "superseded Extraction" in stale.json()["detail"]


def test_extraction_rejects_a_changed_imported_source_before_parsing(tmp_path, monkeypatch):
    called = False

    def fake_extract(*_args):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr("meowdiobooks.backend.app_v2.extract_full_document", fake_extract)
    with TestClient(create_app_v2(tmp_path)) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]
        source = next((tmp_path / "packages" / book_id / "source").glob("original.pdf"))
        source.write_bytes(source.read_bytes() + b"changed")

        queued = client.post(
            f"/api/books/{book_id}/stages/extract/process",
            json={"settings": {"method": "native"}},
        )
        failed = _wait(client, queued.json()["id"])

        assert failed["status"] == "failed"
        assert "integrity check failed" in failed["error"]
        assert called is False


def test_review_bulk_preview_is_local_and_model_repair_endpoint_is_absent(tmp_path, monkeypatch):
    pages = [
        {"page": 1, "text": "Running head\nAlice saw � smoke.", "warnings": []},
        {"page": 2, "text": "Running head\nThe rabbit ran.", "warnings": []},
    ]
    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.extract_full_document",
        lambda _source, _cache, _method, _report: pages,
    )

    with TestClient(create_app_v2(tmp_path)) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]
        extraction = _process(client, book_id, "extract", {"method": "native"})
        _accept(client, book_id, "extract", extraction["revision"])
        dialogue = _process(client, book_id, "dialogue", {"strategy": "narrate"})
        _accept(client, book_id, "dialogue", dialogue["revision"])
        review_result = _process(client, book_id, "review", {})
        review = client.get(
            f"/api/books/{book_id}/stages/review/candidates/{review_result['revision']}"
        ).json()
        repeated = next(row for row in review["warnings"] if row["kind"] == "repeated-matter")
        preview = client.post(
            f"/api/books/{book_id}/review/bulk-preview",
            json={
                "revision": review["revision"],
                "occurrenceId": repeated["occurrences"][0]["id"],
                "action": "exclude",
            },
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["affectedCount"] == 2
        assert preview.json()["published"] is False

        missing = client.post(
            f"/api/books/{book_id}/review/targeted-repair",
            json={"revision": review["revision"], "targetOccurrenceIds": ["anything"]},
        )
        assert missing.status_code in {404, 405}


def test_review_upstream_action_returns_explicit_rerun_contract_without_publish(
    tmp_path, monkeypatch
):
    pages = [{"page": 1, "text": "Alice saw � smoke.", "warnings": []}]
    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.extract_full_document",
        lambda _source, _cache, _method, _report: pages,
    )
    with TestClient(create_app_v2(tmp_path)) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]
        extraction = _process(client, book_id, "extract", {"method": "native"})
        _accept(client, book_id, "extract", extraction["revision"])
        dialogue = _process(client, book_id, "dialogue", {"strategy": "narrate"})
        _accept(client, book_id, "dialogue", dialogue["revision"])
        result = _process(client, book_id, "review", {})
        review = client.get(
            f"/api/books/{book_id}/stages/review/candidates/{result['revision']}"
        ).json()
        occurrences = [row for warning in review["warnings"] for row in warning["occurrences"]]
        repair = next(row for row in occurrences if "rerun-extraction" in row["availableActions"])
        decisions = [
            {
                "occurrenceIds": [row["id"]],
                "action": "rerun-extraction" if row["id"] == repair["id"] else "keep",
            }
            for row in occurrences
        ]

        response = client.post(
            f"/api/books/{book_id}/stages/review/accept",
            json={
                "revision": review["revision"],
                "decisions": decisions,
            },
        )

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["requiresNewUpstreamRevision"] is True
        assert detail["reviewPublished"] is False
        assert detail["actions"][0]["nextStage"] == "extract"
        assert (
            "review" not in client.get(f"/api/books/{book_id}/snapshot").json()["activeArtifacts"]
        )


def test_review_acceptance_preflights_downstream_dialogue_before_publish(tmp_path, monkeypatch):
    pages = [{"page": 1, "text": "Story text.", "warnings": []}]
    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.extract_full_document",
        lambda _source, _cache, _method, _report: pages,
    )
    with TestClient(create_app_v2(tmp_path)) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]
        extraction = _process(client, book_id, "extract", {"method": "native"})
        _accept(client, book_id, "extract", extraction["revision"])
        dialogue = _process(client, book_id, "dialogue", {"strategy": "narrate"})
        _accept(client, book_id, "dialogue", dialogue["revision"])
        review = _process(client, book_id, "review", {})
        monkeypatch.setattr(
            "meowdiobooks.backend.app_v2.apply_review_render_policies",
            lambda *_args: (_ for _ in ()).throw(
                ReviewContractError("Review render policy is not executable")
            ),
        )

        response = client.post(
            f"/api/books/{book_id}/stages/review/accept",
            json={"revision": review["revision"], "decisions": []},
        )

        assert response.status_code == 409
        assert response.json()["detail"] == "Review render policy is not executable"
        assert (
            "review" not in client.get(f"/api/books/{book_id}/snapshot").json()["activeArtifacts"]
        )


def test_duplicate_bytes_reopen_canonical_book_without_writing_a_second_source(tmp_path):
    raw = _pdf()
    with TestClient(create_app_v2(tmp_path)) as client:
        first = client.post(
            "/api/books/import", files={"file": ("first.pdf", raw, "application/pdf")}
        ).json()
        second = client.post(
            "/api/books/import", files={"file": ("renamed.pdf", raw, "application/pdf")}
        )

        assert second.status_code == 201
        assert second.json()["duplicate"] is True
        assert second.json()["book"]["id"] == first["book"]["id"]
        sources = list((tmp_path / "packages" / first["book"]["id"] / "source").iterdir())
        assert [row.name for row in sources] == ["original.pdf"]


def test_import_hook_observes_persisted_book_and_failed_hook_allows_retry(tmp_path):
    attempts = 0
    observed_book_ids: list[str] = []
    app = None
    raw = _pdf()

    def persist_import(book, _source):
        nonlocal attempts
        attempts += 1
        assert app is not None
        persisted = app.state.books.get(book.id)
        assert persisted is not None
        observed_book_ids.append(persisted.id)
        if attempts == 1:
            raise RuntimeError("Hosted persistence failed")

    app = create_app_v2(tmp_path, on_book_imported=persist_import)
    with TestClient(app, raise_server_exceptions=False) as client:
        first = client.post(
            "/api/books/import", files={"file": ("book.pdf", raw, "application/pdf")}
        )

        assert first.status_code == 500
        assert app.state.books.all() == []
        assert list((tmp_path / "packages").rglob("original.pdf")) == []

        second = client.post(
            "/api/books/import", files={"file": ("book.pdf", raw, "application/pdf")}
        )

        assert second.status_code == 201
        assert second.json()["duplicate"] is False
        assert attempts == 2
        assert observed_book_ids == [second.json()["book"]["id"]] * 2


def test_snapshot_exposes_installed_voice_model_languages(tmp_path):
    with TestClient(create_app_v2(tmp_path)) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]

        snapshot = client.get(f"/api/books/{book_id}/snapshot").json()

        assert snapshot["voiceModels"][0]["id"] == "qwen-voice-design-1.7b"
        assert snapshot["voiceModels"][0]["recipeVersion"] == "1"
        assert "english" in snapshot["voiceModels"][0]["supportedLanguages"]
        assert snapshot["voiceSelection"]["modelId"] == "qwen-voice-design-1.7b"


def test_snapshot_selects_configured_voice_default_instead_of_first_model(tmp_path):
    models = [
        {"id": "older", "label": "Older", "supportedLanguages": ["english"]},
        {"id": "preferred", "label": "Preferred", "supportedLanguages": ["english"]},
    ]
    with TestClient(
        create_app_v2(
            tmp_path,
            voice_models=lambda _root: models,
            default_voice_model="preferred",
        )
    ) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]

        snapshot = client.get(f"/api/books/{book_id}/snapshot").json()

        assert [row["id"] for row in snapshot["voiceModels"]] == ["older", "preferred"]
        assert snapshot["voiceSelection"]["modelId"] == "preferred"


def test_generated_chapter_can_open_in_the_default_mac_audio_app(tmp_path, monkeypatch):
    opened = []

    def fake_run(command, **options):
        opened.append((command, options))

    monkeypatch.setattr("meowdiobooks.backend.app_v2.subprocess.run", fake_run)
    with TestClient(create_app_v2(tmp_path)) as client:
        imported = client.post(
            "/api/books/import",
            files={"file": ("book.pdf", _metadata_pdf(), "application/pdf")},
        ).json()
        book_id = imported["book"]["id"]
        wav = tmp_path / "packages" / book_id / "audio" / "chapter-1" / "render-1" / "chapter.wav"
        wav.parent.mkdir(parents=True)
        wav.write_bytes(b"wav")

        response = client.post(f"/api/books/{book_id}/chapters/chapter-1/render-1/audio/open")

    assert response.status_code == 204
    assert opened == [(["open", str(wav)], {"check": True, "capture_output": True})]


@pytest.mark.parametrize("processor_mode", [
    "default", "host", "cover-value-error", "cover-runtime-error", "package-value-error",
])
def test_m4b_export_uses_current_v2_receipts_pdf_metadata_and_cover(
    tmp_path, monkeypatch, processor_mode,
):
    cover = tmp_path / "cover.png"
    cover.write_bytes(b"cover")
    captured = {}
    rendered_pages = []
    materialized_paths = []

    @contextmanager
    def materialize_audio(_book_id, chapter_id, revision, expected):
        materialized = tmp_path / "materialized" / chapter_id / revision / "chapter.wav"
        materialized.parent.mkdir(parents=True, exist_ok=True)
        materialized.write_bytes(expected.read_bytes())
        materialized_paths.append(materialized)
        try:
            yield materialized
        finally:
            materialized.unlink(missing_ok=True)

    def fake_package(chapters, output, **metadata):
        if processor_mode == "package-value-error":
            output.write_bytes(b"incomplete export")
            raise ValueError("Packaging rejected")
        captured["chapters"] = chapters
        captured["audio_bytes"] = [chapter.audio_path.read_bytes() for chapter in chapters]
        captured["metadata"] = metadata
        captured["cover_bytes"] = Path(metadata["cover"]).read_bytes()
        output.write_bytes(b"packaged-m4b")
        return output

    def fake_render_pdf_page(_source, _cache, page):
        rendered_pages.append(page)
        if processor_mode == "cover-value-error":
            raise ValueError("Cover rejected")
        if processor_mode == "cover-runtime-error":
            raise RuntimeError("Cover worker failed")
        return cover

    monkeypatch.setattr("meowdiobooks.backend.app_v2.render_pdf_page", fake_render_pdf_page)
    monkeypatch.setattr("meowdiobooks.backend.app_v2.package_audio_export", fake_package)
    processor = None
    if processor_mode != "default":
        from meowdiobooks.backend.documents import inspect_source, pdf_metadata

        processor = SimpleNamespace(
            inspect_source=inspect_source, pdf_metadata=pdf_metadata,
            render_pdf_page=fake_render_pdf_page, package_audio_export=fake_package,
        )

        def forbidden(*_args, **_kwargs):
            pytest.fail("Export escaped the configured processor")

        monkeypatch.setattr("meowdiobooks.backend.app_v2.render_pdf_page", forbidden)
        monkeypatch.setattr("meowdiobooks.backend.app_v2.package_audio_export", forbidden)
    with TestClient(create_app_v2(tmp_path, chapter_audio_source=materialize_audio,
                                file_processor=processor)) as client:
        imported = client.post(
            "/api/books/import",
            files={"file": ("fallback.pdf", _metadata_pdf(), "application/pdf")},
        ).json()
        book_id = imported["book"]["id"]
        assert imported["book"]["title"] == "A Cat Finds a Voice"
        assert imported["book"]["author"] == "Maou"
        package = tmp_path / "packages" / book_id
        write_artifact(
            package,
            "dialogue",
            {
                "revision": "dialogue-1",
                "spans": [{
                    "id": "s1", "chapterId": "legacy-chapter", "chapterTitle": "Legacy",
                    "blockId": "block-1", "sourceStart": 0, "sourceEnd": 6,
                    "source": "Hello.", "text": "Hello.", "renderRole": "narration",
                }],
            },
        )
        write_artifact(
            package,
            "review",
            {
                "revision": "review-1",
                "dialogueRevision": "dialogue-1",
                "spanChapterIds": {"s1": "opening-matter"},
                "chapters": [{"id": "opening-matter", "title": "Opening matter"}],
            },
        )
        cast_payload = {
            "language": "english", "voiceModel": "voice-model",
            "dialogueRevision": "dialogue-1", "reviewRevision": "review-1",
            "narrator": {
                "characterId": "narrator", "name": "Narrator", "category": "narrator",
                "voiceAccepted": True, "acceptedVoiceRevision": "narrator-voice-1",
                "referenceAudio": "voices/narrator.wav", "referenceText": "A reference line.",
            },
            "identities": [], "labelToCharacterId": {},
        }
        write_artifact(package, "cast", {**cast_payload, "revision": "cast-1"}, publish=False)
        write_artifact(package, "cast", {**cast_payload, "revision": "cast-2"})
        script_payload = {
            "status": "ready",
            "entries": [{
                "id": "entry-1", "kind": "source", "text": "Hello.",
                "chapterId": "opening-matter", "sourceSpanIds": ["s1"],
            }],
            "sourceCoverage": {"status": "exact", "sourceSpanIds": ["s1"]},
            "inputRevisions": {
                "dialogue": "dialogue-1",
                "review": "review-1",
                "cast": "cast-2",
            },
        }
        write_artifact(package, "script", {
            **script_payload, "revision": "script-1",
            "inputRevisions": {**script_payload["inputRevisions"], "cast": "cast-1"},
        }, publish=False)
        write_artifact(package, "script", {**script_payload, "revision": "script-2"})
        render = package / "audio" / "opening-matter" / "render-1"
        render.mkdir(parents=True)
        (render / "chapter.wav").write_bytes(b"wav")
        (render / "metadata.json").write_text(
            json.dumps(
                {
                    "bookId": book_id,
                    "chapterId": "opening-matter",
                    "revision": "render-1",
                    "inputRevisions": {
                        "dialogue": "dialogue-1",
                        "review": "review-1",
                        "cast": "cast-1",
                        "script": "script-1",
                    },
                }
            )
        )
        (render.parent / "latest.json").write_text(
            json.dumps({"revision": "render-1", "path": str(render)})
        )

        response = client.post(
            f"/api/books/{book_id}/exports/m4b",
            json={"chapters": [{"chapterId": "opening-matter", "revision": "render-1"}]},
        )

        if processor_mode not in {"default", "host"}:
            assert response.status_code == (409 if processor_mode == "cover-runtime-error" else 422)
            assert not list((tmp_path / "tmp").glob("m4b-*"))
            assert all(not path.exists() for path in materialized_paths)
            assert (render / "chapter.wav").read_bytes() == b"wav"
            assert client.get("/api/library").json() == []
            if processor_mode.startswith("cover-"):
                assert not materialized_paths
            else:
                assert materialized_paths
            return
        assert response.status_code == 200, response.text
        assert response.content == b"packaged-m4b"
        assert [chapter.title for chapter in captured["chapters"]] == ["Opening matter"]
        assert captured["audio_bytes"] == [b"wav"]
        assert materialized_paths and all(not path.exists() for path in materialized_paths)
        assert captured["metadata"] == {
            "title": "A Cat Finds a Voice",
            "author": "Maou",
            "description": None,
            "cover": cover,
            "preset": "m4b-high",
        }
        assert rendered_pages == [1]
        library_items = client.get("/api/library").json()
        assert len(library_items) == 1
        assert library_items[0]["title"] == "A Cat Finds a Voice"
        assert library_items[0]["description"] is None
        assert library_items[0]["chapterCount"] == 1
        assert library_items[0]["chapterTitles"] == ["Opening matter"]
        assert library_items[0]["chapterPositions"] == [1]
        assert Path(library_items[0]["location"]).is_file()
        cover_response = client.get(f"/api/library/{library_items[0]['id']}/cover")
        assert cover_response.status_code == 200
        assert cover_response.content == b"cover"
        assert (render / "chapter.wav").is_file()

        library_state_path = tmp_path / "library.json"
        library_state = json.loads(library_state_path.read_text(encoding="utf-8"))
        legacy_item = library_state[library_items[0]["id"]]
        legacy_item.pop("chapter_titles")
        legacy_item.pop("chapter_positions")
        library_state_path.write_text(json.dumps(library_state), encoding="utf-8")
        monkeypatch.setattr(
            "meowdiobooks.backend.app_v2.embedded_chapter_titles",
            lambda _path: ["Opening matter"],
        )
        legacy_payload = client.get("/api/library").json()[0]
        assert legacy_payload["chapterTitles"] == ["Opening matter"]
        assert legacy_payload["chapterPositions"] == [1]

        overridden = client.post(
            f"/api/books/{book_id}/exports/m4b",
            headers={"Accept": "application/json"},
            data={
                "chapters": json.dumps([{"chapterId": "opening-matter", "revision": "render-1"}]),
                "title": "A Custom Audiobook",
                "author": "A Different Author",
                "description": "  A moonlit performance.  ",
            },
            files={"cover": ("cover.png", b"custom-cover", "image/png")},
        )
        assert overridden.status_code == 201, overridden.text
        assert overridden.headers["content-type"].startswith("application/json")
        assert overridden.json()["filename"] == "A Custom Audiobook.m4b"
        assert overridden.json()["sizeBytes"] == len(b"packaged-m4b")
        assert captured["metadata"]["title"] == "A Custom Audiobook"
        assert captured["metadata"]["author"] == "A Different Author"
        assert captured["metadata"]["description"] == "A moonlit performance."
        assert overridden.json()["description"] == "A moonlit performance."
        assert captured["metadata"]["cover"].suffix == ".png"
        assert captured["cover_bytes"] == b"custom-cover"
        library_items = client.get("/api/library").json()
        assert len(library_items) == 2
        assert library_items[0]["filename"] == "A Custom Audiobook.m4b"
        assert library_items[0]["description"] == "A moonlit performance."

        opened = []

        def fake_open(command, **options):
            opened.append((command, options))

        monkeypatch.setattr("meowdiobooks.backend.app_v2.subprocess.run", fake_open)
        export_id = library_items[0]["id"]
        assert client.post(f"/api/library/{export_id}/open").status_code == 204
        assert client.post(f"/api/library/{export_id}/reveal").status_code == 204
        assert opened == [
            (["open", library_items[0]["location"]], {"check": True, "capture_output": True}),
            (["open", "-R", library_items[0]["location"]], {"check": True, "capture_output": True}),
        ]

        invalid_cover = client.post(
            f"/api/books/{book_id}/exports/m4b",
            data={
                "chapters": json.dumps([{"chapterId": "opening-matter", "revision": "render-1"}])
            },
            files={"cover": ("cover.txt", b"not-an-image", "text/plain")},
        )
        assert invalid_cover.status_code == 422
        assert invalid_cover.json()["detail"] == "Cover image must be a PNG, JPEG, or WebP file"

        invalid_page = client.post(
            f"/api/books/{book_id}/exports/m4b",
            data={
                "chapters": json.dumps([{"chapterId": "opening-matter", "revision": "render-1"}]),
                "coverPage": "2",
            },
        )
        assert invalid_page.status_code == 422
        assert invalid_page.json()["detail"] == "Cover page is outside this PDF"

        for preset, filename, media_type in (
            ("m4b-compact", "A Cat Finds a Voice - smaller.m4b", "audio/mp4"),
            ("mp3-chapters", "A Cat Finds a Voice - MP3 chapters.zip", "application/zip"),
        ):
            formatted = client.post(
                f"/api/books/{book_id}/exports/audio",
                headers={"Accept": "application/json"},
                json={
                    "chapters": [
                        {"chapterId": "opening-matter", "revision": "render-1"}
                    ],
                    "preset": preset,
                    "description": "Generated by Meowdiobooks",
                },
            )
            assert formatted.status_code == 201, formatted.text
            assert formatted.json()["filename"] == filename
            assert formatted.json()["preset"] == preset
            assert formatted.json()["mediaType"] == media_type
            assert captured["metadata"]["preset"] == preset
            assert captured["metadata"]["description"] == "Generated by Meowdiobooks"
            assert formatted.json()["description"] == "Generated by Meowdiobooks"

        blank_description = client.post(
            f"/api/books/{book_id}/exports/audio",
            headers={"Accept": "application/json"},
            json={
                "chapters": [{"chapterId": "opening-matter", "revision": "render-1"}],
                "description": "   ",
            },
        )
        assert blank_description.status_code == 201
        assert blank_description.json()["description"] == ""
        assert captured["metadata"]["description"] == ""

        oversized_description = client.post(
            f"/api/books/{book_id}/exports/audio",
            json={
                "chapters": [{"chapterId": "opening-matter", "revision": "render-1"}],
                "description": "x" * 2001,
            },
        )
        assert oversized_description.status_code == 422

        binary_zip = client.post(
            f"/api/books/{book_id}/exports/audio",
            json={
                "chapters": [{"chapterId": "opening-matter", "revision": "render-1"}],
                "preset": "mp3-chapters",
            },
        )
        assert binary_zip.status_code == 200
        assert binary_zip.content == b"packaged-m4b"
        assert binary_zip.headers["content-type"].startswith("application/zip")
        assert "MP3%20chapters" in binary_zip.headers["content-disposition"]
        assert binary_zip.headers["content-disposition"].endswith(".zip")

        unsupported_legacy_preset = client.post(
            f"/api/books/{book_id}/exports/m4b",
            json={
                "chapters": [{"chapterId": "opening-matter", "revision": "render-1"}],
                "preset": "m4b-compact",
            },
        )
        assert unsupported_legacy_preset.status_code == 422
        assert unsupported_legacy_preset.json()["detail"] == (
            "Use the audio export endpoint for non-default formats"
        )

        invalid_preset = client.post(
            f"/api/books/{book_id}/exports/audio",
            json={
                "chapters": [{"chapterId": "opening-matter", "revision": "render-1"}],
                "preset": "studio-master",
            },
        )
        assert invalid_preset.status_code == 422

        stale = client.post(
            f"/api/books/{book_id}/exports/m4b",
            json={"chapters": [{"chapterId": "opening-matter", "revision": "render-0"}]},
        )
        assert stale.status_code == 409

        write_artifact(
            package,
            "script",
            {
                **script_payload,
                "revision": "script-3",
                "entries": [{"id": "entry-1", "kind": "source", "text": "Changed."}],
            },
        )
        changed_inputs = client.post(
            f"/api/books/{book_id}/exports/m4b",
            json={"chapters": [{"chapterId": "opening-matter", "revision": "render-1"}]},
        )
        assert changed_inputs.status_code == 409

    persisted = json.loads(library_state_path.read_text(encoding="utf-8"))
    assert persisted[export_id]["description"] == "A moonlit performance."
    first_export_id = next(item_id for item_id in persisted if item_id != export_id)
    persisted[first_export_id].pop("description", None)
    library_state_path.write_text(json.dumps(persisted), encoding="utf-8")
    with TestClient(create_app_v2(tmp_path)) as reopened:
        by_id = {item["id"]: item for item in reopened.get("/api/library").json()}
        assert by_id[export_id]["description"] == "A moonlit performance."
        assert by_id[first_export_id]["description"] is None


def test_hosted_store_factory_replaces_only_mutable_collection_storage(tmp_path: Path):
    created: list[str] = []

    def store_factory(name, model):
        created.append(name)
        return JsonStore(tmp_path / "database" / f"{name}.json", model)

    app = create_app_v2(tmp_path / "workspace", store_factory=store_factory)

    assert created == ["books", "jobs", "library"]
    assert app.state.books.path == tmp_path / "database" / "books.json"
    assert app.state.jobs.path == tmp_path / "database" / "jobs.json"


def test_composition_admission_reaches_remote_dialogue_before_network(tmp_path, monkeypatch):
    class RequestDenied(OSError):
        public_message = "Remote processing is unavailable."

    pages = [{"page": 1, "text": 'Alice waited. "Who is there?"', "warnings": []}]
    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.extract_full_document",
        lambda _source, _cache, _method, _report: pages,
    )
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(
        "urllib.request.urlopen", lambda *_args, **_kwargs: pytest.fail("network used")
    )
    admitted = []

    def deny(config, metadata):
        admitted.append((config, metadata))
        raise RequestDenied("private admission diagnostic")

    with TestClient(create_app_v2(tmp_path, remote_request_admission=deny)) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]
        extraction = _process(client, book_id, "extract", {"method": "native"})
        _accept(client, book_id, "extract", extraction["revision"])
        queued = client.post(
            f"/api/books/{book_id}/stages/dialogue/process",
            json={"settings": {"strategy": "fill-gaps", "attributionRoute": "remote"}},
        )
        assert queued.status_code == 202, queued.text
        finished = _wait(client, queued.json()["id"])

    assert admitted
    assert all(metadata["maximumOutputTokens"] == 8_000 for _, metadata in admitted)
    assert all(metadata["attempt"] == 1 for _, metadata in admitted)
    assert finished["status"] == "failed"
    assert finished["error"] == RequestDenied.public_message


def test_removed_enrichment_api_is_rejected_and_snapshot_omits_it(tmp_path):
    with TestClient(create_app_v2(tmp_path)) as client:
        imported = client.post(
            "/api/books/import",
            files={"file": ("book.pdf", _pdf(), "application/pdf")},
        )
        assert imported.status_code == 201
        book_id = imported.json()["book"]["id"]
        base = f"/api/books/{book_id}/stages/enrich"
        assert client.post(f"{base}/process", json={"settings": {"skip": True}}).status_code == 422
        assert client.post(f"{base}/accept", json={"revision": "removed"}).status_code == 422
        assert client.get(f"{base}/candidates/removed").status_code == 422
        snapshot = client.get(f"/api/books/{book_id}/snapshot").json()
        assert "enrichment" not in snapshot
        assert "enrichment" not in snapshot["history"]


def test_snapshot_excludes_candidates_bound_to_other_inputs(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "meowdiobooks.backend.app_v2.extract_full_document",
        lambda *_args: [{"page": 1, "text": "Alice: [Wait.]", "warnings": []}],
    )
    with TestClient(create_app_v2(tmp_path)) as client:
        book_id = client.post(
            "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
        ).json()["book"]["id"]
        extraction = _process(client, book_id, "extract", {"method": "native"})
        package = tmp_path / "packages" / book_id
        write_artifact(
            package,
            "extraction",
            {"revision": "wrong-source", "sourceHash": "other"},
            publish=False,
        )
        pending = client.get(f"/api/books/{book_id}/snapshot").json()["pendingCandidates"]
        assert pending["extraction"]["revision"] == extraction["revision"]
        _accept(client, book_id, "extract", extraction["revision"])
        dialogue = _process(client, book_id, "dialogue", {"strategy": "narrate"})
        _accept(client, book_id, "dialogue", dialogue["revision"])
        review = _process(client, book_id, "review", {})
        for revision, extraction_revision, dialogue_revision in (
            ("wrong-extraction", "other", dialogue["revision"]),
            ("wrong-dialogue", extraction["revision"], "other"),
        ):
            write_artifact(
                package,
                "review",
                {
                    "revision": revision,
                    "extractionRevision": extraction_revision,
                    "dialogueRevision": dialogue_revision,
                },
                publish=False,
            )
        pending = client.get(f"/api/books/{book_id}/snapshot").json()["pendingCandidates"]
        assert pending["review"]["revision"] == review["revision"]
        _accept(client, book_id, "review", review["revision"])
        assert client.get(f"/api/books/{book_id}/snapshot").json()["pendingCandidates"] == {}


def test_cleanup_failure_retry_preview_acceptance_and_reopen(tmp_path, monkeypatch):
    source = "Ada: [A bro-\nken sign.]"
    monkeypatch.setattr("meowdiobooks.backend.app_v2.extract_full_document",
                        lambda *_args: [{"page": 1, "text": source, "warnings": []}])
    calls = []

    def reviewer(_root, extraction, dialogue, report, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise RuntimeError("Cleanup provider unavailable; retry review")
        block = extraction['blocks'][0]
        start = block['text'].index('bro-\nken')
        return {'occurrences': [{'blockId': block['id'], 'sourceStart': start,
                                'sourceEnd': start + 8, 'source': 'bro-\nken',
                                'replacement': 'broken', 'reason': 'Line wrap.'}],
                'summary': {'model': 'gpt-6-luna', 'inputWindows': 1, 'proposals': 1}}

    observer, admission = lambda *_: None, lambda *_: None
    app = create_app_v2(tmp_path, cleanup_reviewer=reviewer,
                        cleanup_usage_observer=observer, cleanup_request_admission=admission)
    with TestClient(app) as client:
        book_id = client.post('/api/books/import',
                              files={'file': ('book.pdf', _pdf(), 'application/pdf')}).json()['book']['id']
        extraction = _process(client, book_id, 'extract', {'method': 'native'})
        _accept(client, book_id, 'extract', extraction['revision'])
        dialogue = _process(client, book_id, 'dialogue', {'strategy': 'narrate'})
        _accept(client, book_id, 'dialogue', dialogue['revision'])
        queued = client.post(f'/api/books/{book_id}/stages/review/process', json={'settings': {}})
        failed = _wait(client, queued.json()['id'])
        assert failed['status'] == 'failed'
        snapshot = client.get(f'/api/books/{book_id}/snapshot').json()
        assert 'review' not in snapshot['activeArtifacts']
        assert 'review' not in snapshot['pendingCandidates']
        result = _process(client, book_id, 'review', {})
        candidate = client.get(f"/api/books/{book_id}/stages/review/candidates/{result['revision']}").json()
        ai = next(row for warning in candidate['warnings'] for row in warning['occurrences']
                  if row.get('proposalStatus'))
        assert ai['kind'] == 'suspicious-extraction'
        assert not any(w['kind'] == 'ai-cleanup' for w in candidate['warnings'])
        assert ai['replacement'] == 'broken'
        policies = [{'warningId': row['id'], 'action': 'keep'} for row in candidate['warnings']
                    if row.get('decisionScope') != 'occurrence']
        preview = client.post(f'/api/books/{book_id}/review/transcript-preview', json={
            'revision': result['revision'], 'page': 1, 'policies': policies,
            'occurrencePolicies': [{'occurrenceId': ai['id'], 'action': 'repair'}],
        })
        assert preview.status_code == 200, preview.text
        assert any(row['text'] == 'A broken sign.' for row in preview.json()['spans'])
        choices = [{'occurrenceIds': [row['id']],
                    'action': 'repair' if row.get('proposalStatus') == 'proposed' else 'keep'}
                   for warning in candidate['warnings'] for row in warning['occurrences']]
        _accept(client, book_id, 'review', result['revision'], choices)
        accepted = read_artifact(tmp_path / 'packages' / book_id, 'review')
        assert accepted['cleanupSummary']['model'] == 'gpt-6-luna'
        write_artifact(tmp_path / 'packages' / book_id, 'cast', {
            'revision': 'cast-cleanup', 'dialogueRevision': dialogue['revision'],
            'reviewRevision': accepted['revision'], 'identities': [], 'labelToCharacterId': {},
        })
        first_script = client.post(f'/api/books/{book_id}/recording-script/prepare')
        second_script = client.post(f'/api/books/{book_id}/recording-script/prepare')
        assert first_script.status_code == second_script.status_code == 200, first_script.text
        assert first_script.json()['revision'] == second_script.json()['revision']
        assert any(row['text'] == 'A broken sign.' for row in first_script.json()['entries'])
        assert read_artifact(tmp_path / 'packages' / book_id, 'extraction')['revision'] == extraction['revision']
        assert read_artifact(tmp_path / 'packages' / book_id, 'dialogue')['revision'] == dialogue['revision']
    with TestClient(create_app_v2(tmp_path, cleanup_reviewer=reviewer)) as reopened:
        snapshot = reopened.get(f'/api/books/{book_id}/snapshot').json()
        assert snapshot['activeArtifacts']['review'] == accepted['revision']
        assert 'review' not in snapshot['pendingCandidates']
    assert len(calls) == 2
    assert all(row['usage_observer'] is observer and row['request_admission'] is admission for row in calls)
