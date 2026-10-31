from types import SimpleNamespace

import pytest

from meowdiobooks.backend.resources import SleepInhibitor, require_free_disk


def test_disk_preflight_rejects_an_exhausted_volume(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "meowdiobooks.backend.resources.shutil.disk_usage",
        lambda _path: SimpleNamespace(free=100),
    )

    with pytest.raises(RuntimeError, match="Insufficient free disk"):
        require_free_disk(tmp_path, minimum_free_bytes=101)


def test_sleep_inhibitor_owns_and_releases_caffeinate(monkeypatch):
    calls = []

    class Process:
        def terminate(self):
            calls.append("terminate")

        def wait(self, timeout=None):
            calls.append(("wait", timeout))

    monkeypatch.setattr("meowdiobooks.backend.resources.sys.platform", "darwin")
    monkeypatch.setattr("meowdiobooks.backend.resources.Path.is_file", lambda _path: True)
    monkeypatch.setattr(
        "meowdiobooks.backend.resources.subprocess.Popen",
        lambda *args, **kwargs: calls.append((args, kwargs)) or Process(),
    )

    with SleepInhibitor():
        pass

    assert calls[-2:] == ["terminate", ("wait", 5)]
