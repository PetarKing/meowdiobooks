import json

import pytest

from scripts.dialogue_attribution_experiment import (
    MAX_MULTI_PROMPT_CHARACTERS,
    _bounded_multi_groups,
    _multi_prompt,
    _parse_multi,
    experiment_dossier,
    merge_gold_parts,
    score_variant,
    select_density_windows,
)


def test_experiment_dossier_can_expand_unlabelled_context_without_changing_target():
    partition = [
        {
            "id": f"s{index}",
            "page": 1,
            "source": text,
            "text": text,
            "renderRole": role,
            "speakerStatus": "unlabelled" if role == "dialogue" else "not-applicable",
        }
        for index, (text, role) in enumerate(
            [
                ("Alice entered.", "narration"),
                ("The room was silent.", "narration"),
                ('"Who are you?"', "dialogue"),
                ("The Rabbit answered.", "narration"),
                ("Alice waited.", "narration"),
            ],
            1,
        )
    ]

    narrow = experiment_dossier(partition, "s3", 1, 700)
    wider = experiment_dossier(partition, "s3", 3, 900)

    assert narrow["before"] == "The room was silent."
    assert "Alice entered." in wider["before"]
    assert narrow["target"] == wider["target"] == '"Who are you?"'


def test_density_selection_returns_five_non_overlapping_windows(monkeypatch):
    pages = [{"page": page, "text": "x" * 100} for page in range(1, 21)]

    monkeypatch.setattr(
        "scripts.dialogue_attribution_experiment._window_density",
        lambda _pages, start: {
            "start": start,
            "end": start + 1,
            "targets": 3 + start,
            "characters": 200,
            "density": float(start),
        },
    )

    selected = select_density_windows(pages)

    assert len(selected) == 5
    selected_pages = [page for row in selected for page in (row["start"], row["end"])]
    assert len(set(selected_pages)) == 10


def test_multi_parser_requires_one_valid_answer_per_target():
    assert _parse_multi('{"answers":["Alice","?","/"]}', 3) == ["Alice", "?", "/"]


def test_counted_multi_prompt_demonstrates_the_exact_required_array_length():
    prompt = _multi_prompt([{"target": "One"}, {"target": "Two"}, {"target": "Three"}], counted=True)

    assert "Return exactly 3 answers" in prompt
    assert '{"answers":["name or ? or /","name or ? or /","name or ? or /"]}' in prompt


def test_multi_groups_keep_at_most_three_targets_under_hard_prompt_cap():
    partition = [
        {
            "id": f"s{index}",
            "page": 1,
            "source": text,
            "text": text,
            "renderRole": role,
            "speakerStatus": "unlabelled" if role == "dialogue" else "not-applicable",
        }
        for index, (text, role) in enumerate(
            [
                ("Context " + "x" * 850, "narration"),
                ('"First."', "dialogue"),
                ("Bridge " + "y" * 850, "narration"),
                ('"Second."', "dialogue"),
                ("Bridge " + "z" * 850, "narration"),
                ('"Third."', "dialogue"),
                ("Tail " + "q" * 850, "narration"),
            ],
            1,
        )
    ]

    groups = _bounded_multi_groups(
        partition,
        ["s2", "s4", "s6"],
        {"units": 3, "characters": 900},
    )

    assert [owner for owners, _, _ in groups for owner in owners] == ["s2", "s4", "s6"]
    assert all(len(owners) <= 3 for owners, _, _ in groups)
    assert all(len(prompt) <= MAX_MULTI_PROMPT_CHARACTERS for _, _, prompt in groups)


def test_merge_gold_parts_preserves_frozen_evidence_and_requires_complete_coverage(tmp_path):
    output = tmp_path / "experiment"
    output.mkdir()
    template = {
        "sampleId": "book:s1",
        "bookId": "book",
        "windowId": "window-1",
        "page": 2,
        "target": '"Hello"',
        "reviewBefore": "Before",
        "reviewAfter": "After",
        "classification": None,
        "canonicalSpeaker": None,
        "acceptedAliases": [],
        "speakerInferable": None,
        "evidence": None,
        "confidence": None,
    }
    (output / "gold.jsonl").write_text(json.dumps(template) + "\n")
    part = tmp_path / "part.jsonl"
    part.write_text(
        json.dumps(
            {
                "sampleId": "book:s1",
                "classification": "dialogue",
                "canonicalSpeaker": "Alice",
                "acceptedAliases": ["Alice"],
                "speakerInferable": True,
                "evidence": "Alice said it.",
                "confidence": "high",
            }
        )
        + "\n"
    )

    merged = merge_gold_parts(output, [part])

    assert merged[0]["reviewBefore"] == "Before"
    assert merged[0]["canonicalSpeaker"] == "Alice"


def test_merge_gold_parts_rejects_incomplete_coverage(tmp_path):
    output = tmp_path / "experiment"
    output.mkdir()
    (output / "gold.jsonl").write_text(
        json.dumps({"sampleId": "book:s1"}) + "\n" + json.dumps({"sampleId": "book:s2"}) + "\n"
    )
    part = tmp_path / "part.jsonl"
    part.write_text(
        json.dumps(
            {
                "sampleId": "book:s1",
                "classification": "prose",
                "canonicalSpeaker": None,
                "acceptedAliases": [],
                "speakerInferable": False,
                "evidence": "Not spoken aloud.",
                "confidence": "high",
            }
        )
        + "\n"
    )

    with pytest.raises(ValueError, match="missing 1 samples"):
        merge_gold_parts(output, [part])


def test_scoring_separates_named_speakers_unresolved_dialogue_and_parse_failures(tmp_path):
    output = tmp_path / "experiment"
    (output / "runs").mkdir(parents=True)
    gold = [
        {
            "sampleId": "book:prose",
            "bookId": "book",
            "classification": "prose",
            "speakerInferable": False,
            "canonicalSpeaker": None,
            "acceptedAliases": [],
        },
        {
            "sampleId": "book:named",
            "bookId": "book",
            "classification": "dialogue",
            "speakerInferable": True,
            "canonicalSpeaker": "Alice",
            "acceptedAliases": [],
        },
        {
            "sampleId": "book:unknown",
            "bookId": "book",
            "classification": "dialogue",
            "speakerInferable": False,
            "canonicalSpeaker": None,
            "acceptedAliases": [],
        },
        {
            "sampleId": "book:invalid",
            "bookId": "book",
            "classification": "prose",
            "speakerInferable": False,
            "canonicalSpeaker": None,
            "acceptedAliases": [],
        },
    ]
    results = [
        {"sampleId": "book:prose", "prediction": "/", "callId": "1"},
        {"sampleId": "book:named", "prediction": "Alice", "callId": "2"},
        {"sampleId": "book:unknown", "prediction": "?", "callId": "3"},
        {
            "sampleId": "book:invalid",
            "prediction": None,
            "parseError": "bad output",
            "callId": "4",
        },
    ]
    for result in results:
        result.update({"latencyMs": 1, "usage": {}, "validatorAccepted": True})
    (output / "gold.jsonl").write_text("".join(json.dumps(row) + "\n" for row in gold))
    (output / "runs" / "v0-control.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in results)
    )

    scored = score_variant(output, "v0-control")

    assert scored["overall"]["classificationAccuracy"] == 0.75
    assert scored["overall"]["speakerAccuracy"] == 1.0
    assert scored["overall"]["unresolvedAccuracy"] == 1.0
    assert scored["overall"]["fullyUsableRate"] == 0.75
