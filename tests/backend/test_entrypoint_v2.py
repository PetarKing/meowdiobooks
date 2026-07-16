from __future__ import annotations

import os
from argparse import Namespace

import pytest
from fastapi.testclient import TestClient

from meowdiobooks import cli
from meowdiobooks.backend.app import create_app
from meowdiobooks.backend.app_v2 import create_app_v2
from meowdiobooks.backend.models import Job, JobStatus
from meowdiobooks.backend.storage import JsonStore


def test_production_entrypoint_is_v2() -> None:
    assert create_app is create_app_v2


def test_cli_serves_v2_application(monkeypatch, tmp_path) -> None:
    observed: dict[str, object] = {}

    def fake_run(app, *, host: str, port: int) -> None:
        observed.update(app=app, host=host, port=port)

    monkeypatch.setattr("uvicorn.run", fake_run)

    result = cli._serve(Namespace(data=str(tmp_path), host="127.0.0.1", port=8123))

    assert result == 0
    assert observed["host"] == "127.0.0.1"
    assert observed["port"] == 8123
    assert observed["app"].title == "Meowdiobooks v2"
    paths = {route.path for route in observed["app"].routes}
    assert "/api/books/{book_id}/dialogue/preview" in paths
    assert "/api/books/{book_id}/stages/{stage}/process" in paths
    assert "/api/books/{book_id}/chapters/{chapter_id}/{revision}/audio" in paths


def test_serve_parser_exposes_explicit_frontend_rebuild() -> None:
    default = cli.parser().parse_args(["serve"])
    enabled = cli.parser().parse_args(["serve", "--rebuild-frontend"])

    assert default.rebuild_frontend is False
    assert enabled.rebuild_frontend is True


def test_frontend_rebuild_runs_locked_install_then_build(monkeypatch, tmp_path) -> None:
    frontend = tmp_path / "frontend"
    frontend.mkdir()
    (frontend / "package.json").write_text("{}")
    (frontend / "package-lock.json").write_text("{}")
    calls: list[tuple[tuple[str, ...], object, bool]] = []

    monkeypatch.setattr(cli, "checkout_root", lambda: tmp_path)
    monkeypatch.setattr(
        cli.subprocess,
        "run",
        lambda command, *, cwd, check: calls.append((command, cwd, check)),
    )

    cli._rebuild_frontend()

    assert calls == [
        (("npm", "ci"), frontend, True),
        (("npm", "run", "build"), frontend, True),
    ]


def test_frontend_rebuild_requires_a_source_checkout(monkeypatch) -> None:
    monkeypatch.setattr(cli, "checkout_root", lambda: None)

    with pytest.raises(OSError, match="available only from a source checkout"):
        cli._rebuild_frontend()


def test_frontend_rebuild_finishes_before_server_start(monkeypatch, tmp_path) -> None:
    events: list[str] = []

    monkeypatch.setattr(cli, "_rebuild_frontend", lambda: events.append("rebuild"))
    monkeypatch.setattr("uvicorn.run", lambda *_args, **_kwargs: events.append("serve"))

    result = cli._serve(
        Namespace(
            data=str(tmp_path),
            host="127.0.0.1",
            port=8123,
            rebuild_frontend=True,
        )
    )

    assert result == 0
    assert events == ["rebuild", "serve"]


def test_second_backend_is_rejected_before_running_job_recovery(monkeypatch, tmp_path) -> None:
    jobs = JsonStore(tmp_path / "jobs.json", Job)
    running = jobs.put(Job(kind="v2:generate", status=JobStatus.RUNNING))
    uvicorn_called = False

    def fake_run(*_args, **_kwargs) -> None:
        nonlocal uvicorn_called
        uvicorn_called = True

    monkeypatch.setattr("uvicorn.run", fake_run)

    with cli._single_instance_lock(tmp_path):
        with pytest.raises(OSError, match=r"already running.*PID"):
            cli._serve(Namespace(data=str(tmp_path), host="127.0.0.1", port=8123))

    assert uvicorn_called is False
    assert jobs.get(running.id).status == JobStatus.RUNNING


def test_instance_lock_is_released_for_a_later_restart(tmp_path) -> None:
    with cli._single_instance_lock(tmp_path):
        assert (tmp_path / "server.lock").read_text() == str(os.getpid())

    with cli._single_instance_lock(tmp_path):
        pass


def test_cli_exposes_read_only_doctor(monkeypatch) -> None:
    monkeypatch.setattr("meowdiobooks.diagnostics.print_doctor", lambda _root: 7)

    assert cli._doctor(Namespace()) == 7
    assert "doctor" in cli.parser().format_help()


def test_explicit_frontend_build_is_served_at_root(tmp_path) -> None:
    frontend = tmp_path / "dist"
    frontend.mkdir()
    (frontend / "index.html").write_text("<h1>Meowdiobooks v2</h1>")

    with TestClient(create_app(tmp_path / "data", frontend_dist=frontend)) as client:
        responses = [client.get(path) for path in ("/", "/library", "/player")]

    assert all(response.status_code == 200 for response in responses)
    assert all("Meowdiobooks v2" in response.text for response in responses)
