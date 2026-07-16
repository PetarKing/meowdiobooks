import json

import pytest

from meowdiobooks.backend.artifacts import (
    active_artifacts,
    artifact_history,
    read_artifact,
    write_artifact,
)


def test_writes_immutable_revision_and_one_active_pointer(tmp_path):
    path, artifact = write_artifact(tmp_path, "dialogue", {"revision": "d1", "spans": []})

    assert path.is_file()
    assert artifact["contract"] == "meowdiobooks.dialogue.v2"
    assert active_artifacts(tmp_path) == {"dialogue": str(path)}
    assert read_artifact(tmp_path, "dialogue")["revision"] == "d1"


def test_rejects_legacy_pointer_kinds(tmp_path):
    pointer = tmp_path / "artifacts" / "latest.json"
    pointer.parent.mkdir(parents=True)
    pointer.write_text(json.dumps({"analysis": "/legacy.json"}))

    with pytest.raises(RuntimeError, match="legacy artifact"):
        active_artifacts(tmp_path)


def test_revision_is_immutable_and_history_remains_inspectable(tmp_path):
    write_artifact(tmp_path, "review", {"revision": "r1", "warnings": []})
    write_artifact(tmp_path, "review", {"revision": "r2", "warnings": [{"id": "w1"}]})

    with pytest.raises(RuntimeError, match="Immutable review revision conflicts"):
        write_artifact(tmp_path, "review", {"revision": "r1", "warnings": [{"id": "changed"}]})

    assert [row["revision"] for row in artifact_history(tmp_path, "review")] == ["r1", "r2"]
