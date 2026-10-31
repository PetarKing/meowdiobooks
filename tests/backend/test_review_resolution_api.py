"""Independent publication, privacy, chapter-preview, and legacy Review regressions."""

import json
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from meowdiobooks.backend import review_resolution
from meowdiobooks.backend.app_v2 import _dialogue_with_chapters, create_app_v2
from meowdiobooks.backend.artifacts import read_artifact, write_artifact
from meowdiobooks.backend.review import apply_review_render_policies
from test_app_v2 import _pdf
from test_boundary_review import review_workspace


def _install_review_candidate(client, tmp_path, monkeypatch):
    imported = client.post(
        "/api/books/import", files={"file": ("book.pdf", _pdf(), "application/pdf")}
    )
    assert imported.status_code == 201, imported.text
    book_id = imported.json()["book"]["id"]
    package = tmp_path / "packages" / book_id
    extraction, dialogue, candidate = review_workspace(monkeypatch)
    candidate["revision"] = "review-fixture"
    candidate["boundaryCandidates"] = [
        {
            "id": "heading",
            "blockId": "b1",
            "sourceStart": 0,
            "sourceEnd": 5,
            "source": "eyes.",
            "page": 2,
        }
    ]
    write_artifact(package, "extraction", extraction)
    write_artifact(package, "dialogue", dialogue)
    write_artifact(package, "review", candidate, publish=False)
    rows = [r for w in candidate["warnings"] for r in w["occurrences"]]
    choices = [
        {"occurrenceIds": [r["id"]], "action": "repair" if r.get("boundaryDecision") else "keep"}
        for r in rows
    ]
    return book_id, package, dialogue, candidate, choices


@pytest.mark.parametrize(
    "chapter_action,first_text,effective",
    [
        ("chapter-start", "She shut her", "keep"),
        ("not-a-boundary", "She shut her eyes", "repair"),
    ],
)
def test_preview_and_acceptance_share_selected_chapter_context(
    tmp_path, monkeypatch, chapter_action, first_text, effective
):
    with TestClient(create_app_v2(tmp_path)) as client:
        book_id, package, dialogue, candidate, choices = _install_review_candidate(
            client, tmp_path, monkeypatch
        )
        before = (package / "artifacts/latest.json").read_bytes()
        boundaries = [{"boundaryId": "heading", "action": chapter_action}]
        response = client.post(
            f"/api/books/{book_id}/review/transcript-preview",
            json={
                "revision": candidate["revision"],
                "page": 1,
                "policies": [],
                "occurrencePolicies": [
                    {"occurrenceId": c["occurrenceIds"][0], "action": c["action"]} for c in choices
                ],
                "boundaryDecisions": boundaries,
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["spans"][0]["text"] == first_text
        assert not (package / ".audit").exists()
        assert (package / "artifacts/latest.json").read_bytes() == before
        response = client.post(
            f"/api/books/{book_id}/stages/review/accept",
            json={
                "revision": candidate["revision"],
                "decisions": choices + boundaries,
            },
        )
        assert response.status_code == 200, response.text
        accepted = read_artifact(package, "review")
        assert all(d["action"] == effective for d in accepted["decisions"])
        _dialogue_with_chapters(dialogue, accepted)
        (audit_path,) = (package / ".audit/review-resolution").glob("*.json")
        audit = json.loads(audit_path.read_text())
        assert audit["reviewRevision"] == accepted["revision"]
        for route in [
            f"/api/books/{book_id}/snapshot",
            f"/api/books/{book_id}/stages/review/candidates/{accepted['revision']}",
        ]:
            exposed = client.get(route)
            assert exposed.status_code == 200, exposed.text
            assert "requestedAction" not in exposed.text
            assert "renderedDigest" not in exposed.text
            assert "effectiveDigest" not in exposed.text
            assert "incompatible-boundary-context" not in exposed.text
        assert (
            client.get(
                f"/api/books/{book_id}/.audit/review-resolution/{accepted['revision']}.json"
            ).status_code
            == 404
        )


def test_audit_io_failure_leaves_all_published_state_untouched(tmp_path, monkeypatch):
    with TestClient(create_app_v2(tmp_path), raise_server_exceptions=False) as client:
        book_id, package, dialogue, candidate, choices = _install_review_candidate(
            client, tmp_path, monkeypatch
        )
        boundaries = [{"boundaryId": "heading", "action": "not-a-boundary"}]
        request = {"revision": candidate["revision"], "decisions": choices + boundaries}
        good = client.post(f"/api/books/{book_id}/stages/review/accept", json=request)
        assert good.status_code == 200, good.text
        before = {p.relative_to(tmp_path): p.read_bytes() for p in tmp_path.rglob("*.json")}

        def fail(*_args, **_kwargs):
            raise OSError("synthetic disk-full while writing audit")

        monkeypatch.setattr(review_resolution, "write_json", fail)
        failed = client.post(f"/api/books/{book_id}/stages/review/accept", json=request)
        assert failed.status_code == 500
        assert {p.relative_to(tmp_path): p.read_bytes() for p in tmp_path.rglob("*.json")} == before
        assert "disk-full" not in failed.text


def test_legacy_and_versioned_receipts_remain_separate():
    dialogue = {
        "revision": "d1",
        "spans": [
            {
                "id": "s",
                "blockId": "b",
                "sourceStart": 0,
                "sourceEnd": 6,
                "source": "abcdef",
                "text": "abcdef",
                "renderRole": "narration",
            }
        ],
    }
    rows = [
        {
            "id": key,
            "blockId": "b",
            "sourceStart": start,
            "sourceEnd": end,
            "source": "abcdef"[start:end],
            "kind": "footnote",
            "availableActions": ["keep", "exclude", "narrate"],
        }
        for key, start, end in [("broad", 0, 6), ("narrow", 2, 4)]
    ]
    old = {
        "warningSnapshot": [{"occurrences": rows}],
        "decisions": [
            {"occurrenceId": "broad", "action": "exclude"},
            {"occurrenceId": "narrow", "action": "keep"},
        ],
    }
    before = deepcopy(old)
    legacy = apply_review_render_policies(dialogue, old)
    assert "".join(s.get("text", "") for s in legacy["spans"]) == ""
    new, _ = review_resolution.resolve_review_revision(dialogue, old)
    assert (
        "".join(s.get("text", "") for s in apply_review_render_policies(dialogue, new)["spans"])
        == "cd"
    )
    assert old == before
    assert (
        "".join(s.get("text", "") for s in apply_review_render_policies(dialogue, old)["spans"])
        == ""
    )
