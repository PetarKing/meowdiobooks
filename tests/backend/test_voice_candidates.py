from pathlib import Path

from meowdiobooks.backend.app_v2 import _generate_voice_candidates
from meowdiobooks.backend.voice_candidates import VoiceCandidatePolicy


def test_policy_selects_both_voices_for_a_two_voice_book():
    policy = VoiceCandidatePolicy()

    assert policy.selected_ids(
        [
            {"id": "narrator", "lineCount": 95},
            {"id": "alice", "lineCount": 5},
        ]
    ) == ("narrator", "alice")


def test_policy_uses_smallest_bounded_prefix_covering_eighty_percent():
    policy = VoiceCandidatePolicy(min_voices=2, max_voices=4)
    voices = [
        {"id": f"voice-{index}", "lineCount": count}
        for index, count in enumerate([35, 25, 15, 10, 5, 4, 3, 2, 1])
    ]

    assert policy.selected_ids(voices) == (
        "voice-0",
        "voice-1",
        "voice-2",
        "voice-3",
    )


def test_disabled_policy_generates_only_one_candidate_per_voice(tmp_path: Path):
    calls: list[list[str]] = []

    def auditioner(_root, _package, _book, rows, report, _language, _model):
        calls.append([str(row["id"]) for row in rows])
        report(100, "done")
        for row in rows:
            candidates = list(row.get("voiceCandidates", []))
            candidates.append({"revision": f"{row['id']}-{len(candidates) + 1}"})
            row["voiceCandidates"] = candidates
        return rows

    generated = _generate_voice_candidates(
        voice_auditioner=auditioner,
        repo_root=tmp_path,
        package=tmp_path,
        book_id="book",
        characters=[
            {"id": "narrator", "lineCount": 10},
            {"id": "alice", "lineCount": 5},
        ],
        report=lambda *_: None,
        language="english",
        model_id="voice",
        policy=VoiceCandidatePolicy(enabled=False),
    )

    assert calls == [["narrator", "alice"]]
    assert [len(row["voiceCandidates"]) for row in generated] == [1, 1]


def test_candidate_generation_rerolls_only_selected_high_volume_voices(tmp_path: Path):
    calls: list[list[str]] = []

    def auditioner(_root, _package, _book, rows, report, _language, _model):
        calls.append([str(row["id"]) for row in rows])
        report(100, "done")
        for row in rows:
            candidates = list(row.get("voiceCandidates", []))
            candidates.append({"revision": f"{row['id']}-{len(candidates) + 1}"})
            row["voiceCandidates"] = candidates
        return rows

    generated = _generate_voice_candidates(
        voice_auditioner=auditioner,
        repo_root=tmp_path,
        package=tmp_path,
        book_id="book",
        characters=[
            {"id": "narrator", "lineCount": 70},
            {"id": "alice", "lineCount": 20},
            {"id": "guard", "lineCount": 10},
        ],
        report=lambda *_: None,
        language="english",
        model_id="voice",
        policy=VoiceCandidatePolicy(),
    )

    assert calls == [["narrator", "alice", "guard"], ["narrator", "alice"]]
    assert [len(row["voiceCandidates"]) for row in generated] == [2, 2, 1]
