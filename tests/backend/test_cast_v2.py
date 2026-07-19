import pytest

from meowdiobooks.backend.cast import (
    CastContractError,
    build_label_dossiers,
    build_relationship_summary,
    cast_progression_blockers,
    finalize_identity_mapping,
    label_comparison_key,
    stable_character_id,
    suggest_fuzzy_candidates,
    validate_identity_proposals,
)


def _turn(span_id, label, text, *, status="explicit", page=1, before="", after=""):
    return {
        "spanId": span_id,
        "sourceSpeakerLabel": label,
        "speakerStatus": status,
        "sourceText": text,
        "page": page,
        "contextBefore": before,
        "contextAfter": after,
    }


def test_dossiers_preserve_spellings_counts_first_appearance_and_context():
    turns = [
        _turn("s1", "Subaru", "Subaru: [Wait.]", after="He reached for Emilia."),
        _turn("s2", "Louis", "Louis: [No.]", page=2),
        _turn("s3", "Ｓｕｂａｒｕ", "Ｓｕｂａｒｕ: [Run.]", page=3),
        _turn("s4", "???", "???: [Stop.]", status="unresolved"),
        _turn("s5", "Subaru", "Subaru: [Go.]", page=5),
        _turn("s6", "Subaru", "Subaru: [Now.]", page=6),
        _turn("s7", "Subaru", "Subaru: [Please.]", page=7),
    ]

    dossiers = build_label_dossiers(turns)

    assert [row["label"] for row in dossiers] == ["Subaru", "Louis"]
    subaru = dossiers[0]
    assert subaru["occurrenceCount"] == 5
    assert subaru["sourceSpellings"] == ["Subaru", "Ｓｕｂａｒｕ"]
    assert subaru["firstAppearance"] == {"sourceOrder": 0, "spanId": "s1", "page": 1}
    assert 2 <= len(subaru["examples"]) <= 4
    assert subaru["examples"][0]["contextAfter"] == "He reached for Emilia."
    assert subaru["examples"][-1]["spanId"] == "s7"
    assert label_comparison_key("  Ｓｕｂａｒｕ  ") == "subaru"


def test_dossiers_clean_hidden_markers_and_fill_missing_context_from_adjacent_narration():
    dossiers = build_label_dossiers(
        [
            {
                "spanId": "n1",
                "renderRole": "narration",
                "sourceText": "The blue-haired boy stepped forward.",
                "page": 7,
            },
            {
                "spanId": "d1",
                "sourceSpeakerLabel": "???",
                "resolvedSpeakerLabel": "Cecilus",
                "speakerStatus": "ai",
                "sourceText": "???: I am Cecilus Segmunt.",
                "page": 7,
            },
            {
                "spanId": "n2",
                "renderRole": "narration",
                "sourceText": "Cecilus smiled as he drew his sword.",
                "page": 7,
            },
        ],
        min_examples=1,
        max_examples=1,
    )

    example = dossiers[0]["examples"][0]
    assert dossiers[0]["label"] == "Cecilus"
    assert example["sourceText"] == "I am Cecilus Segmunt."
    assert example["contextBefore"] == "The blue-haired boy stepped forward."
    assert example["contextAfter"] == "Cecilus smiled as he drew his sword."
    assert "???" not in " ".join(map(str, example.values()))


def test_fuzzy_candidates_are_conservative_and_never_merge():
    dossiers = [
        {"label": "Subaru", "occurrenceCount": 10, "firstAppearance": {"sourceOrder": 0}},
        {"label": "Natsuki Subaru", "occurrenceCount": 2, "firstAppearance": {"sourceOrder": 2}},
        {"label": "Subaro", "occurrenceCount": 1, "firstAppearance": {"sourceOrder": 3}},
        {"label": "Sub", "occurrenceCount": 1, "firstAppearance": {"sourceOrder": 4}},
        {"label": "Louis", "occurrenceCount": 8, "firstAppearance": {"sourceOrder": 1}},
        {
            "label": "Subaru & Emilia",
            "occurrenceCount": 1,
            "firstAppearance": {"sourceOrder": 5},
        },
    ]

    suggestions = suggest_fuzzy_candidates(dossiers)

    pairs = {(row["leftLabel"], row["rightLabel"]) for row in suggestions}
    assert ("Natsuki Subaru", "Subaru") in pairs
    assert ("Subaro", "Subaru") in pairs
    assert all(row["automaticMerge"] is False for row in suggestions)
    assert not any("Sub" in pair for pair in pairs)
    assert not any("Louis" in pair for pair in pairs)
    assert not any("Subaru & Emilia" in pair for pair in pairs)


def test_strict_proposal_validation_requires_complete_known_categories_and_flags_material_work():
    proposals = validate_identity_proposals(
        [
            {
                "label": "Subaru",
                "category": "character",
                "canonicalName": "Natsuki Subaru",
                "aliases": [],
                "competingLabels": [],
                "reason": "The contextual examples identify the full name.",
                "reviewRequired": False,
                "voiceProfile": "Determined young adult",
                "auditionLine": "I refuse to give up.",
            },
            {
                "label": "Everyone",
                "category": "group",
                "canonicalName": "Everyone",
                "aliases": [],
                "competingLabels": [],
                "reason": "Multiple characters speak under this collective label.",
            },
            {
                "label": "TL Note",
                "category": "editorial",
                "canonicalName": None,
                "aliases": [],
                "competingLabels": [],
                "reason": "The examples contain translator commentary.",
            },
            {
                "label": "???",
                "category": "unresolved-marker",
                "canonicalName": None,
                "aliases": [],
                "competingLabels": [],
                "reason": "The configured source marker withholds identity.",
            },
        ],
        ["Subaru", "Everyone", "TL Note", "???"],
    )

    assert all(row["reviewRequired"] for row in proposals)
    subaru_only = [row for row in proposals if row["label"] == "Subaru"]
    with pytest.raises(CastContractError, match="Missing identity proposals"):
        validate_identity_proposals(subaru_only, ["Subaru", "Everyone"])
    with pytest.raises(CastContractError, match="Unsupported identity category"):
        validate_identity_proposals(
            [
                {
                    "label": "Subaru",
                    "category": "narrator-ish",
                    "canonicalName": "Subaru",
                    "reason": "Nope",
                    "aliases": [],
                    "competingLabels": [],
                }
            ],
            ["Subaru"],
        )
    with pytest.raises(CastContractError, match="unknown aliases"):
        validate_identity_proposals(
            [
                {
                    "label": "Subaru",
                    "category": "character",
                    "canonicalName": "Subaru",
                    "reason": "Direct source label.",
                    "aliases": ["Invented alias"],
                    "competingLabels": [],
                }
            ],
            ["Subaru"],
        )

    cross_batch = validate_identity_proposals(
        [
            {
                "label": "Subaru-kun",
                "category": "character",
                "canonicalName": "Natsuki Subaru",
                "reason": "Context supports a possible relationship.",
                "aliases": ["Subaru"],
                "competingLabels": ["Subaru"],
            }
        ],
        ["Subaru-kun"],
        known_labels=["Subaru", "Subaru-kun"],
    )
    assert cross_batch[0]["reviewRequired"] is True


def test_relationship_summary_surfaces_cross_label_identity_conflicts():
    dossiers = [
        {"label": "Subaru", "occurrenceCount": 10, "firstAppearance": {"sourceOrder": 0}},
        {"label": "Subaru-kun", "occurrenceCount": 2, "firstAppearance": {"sourceOrder": 5}},
    ]
    first = {
        "label": "Subaru",
        "category": "character",
        "canonicalName": "Natsuki Subaru",
        "reviewRequired": True,
    }
    second = {
        "label": "Subaru-kun",
        "category": "character",
        "canonicalName": "Natsuki Subaru",
        "reviewRequired": True,
    }

    payload = build_relationship_summary([[first], [second]], dossiers)

    assert payload["globalLabelLedger"].count("\n") == 1
    assert payload["conflicts"] == [{"kind": "cross-label-group", "proposals": [first, second]}]


def test_flagged_identities_block_finalization_then_map_labels_to_stable_ids():
    proposals = [
        {
            "label": "Subaru",
            "category": "character",
            "canonicalName": "Natsuki Subaru",
            "reviewRequired": True,
            "voiceProfile": "Determined young adult",
            "auditionLine": "I refuse to give up.",
        },
        {
            "label": "Subaru-kun",
            "category": "character",
            "canonicalName": "Natsuki Subaru",
            "reviewRequired": True,
        },
        {
            "label": "TL Note",
            "category": "editorial",
            "canonicalName": None,
            "reviewRequired": True,
        },
    ]
    with pytest.raises(CastContractError, match="Resolve flagged identity"):
        finalize_identity_mapping(proposals)

    revision = finalize_identity_mapping(
        proposals,
        {
            "Subaru": {"category": "character", "canonicalName": "Natsuki Subaru"},
            "Subaru-kun": {"category": "character", "canonicalName": "Natsuki Subaru"},
            "TL Note": {"category": "editorial"},
        },
    )

    assert len(revision["identities"]) == 1
    identity = revision["identities"][0]
    assert identity["characterId"] == stable_character_id("Natsuki Subaru")
    assert identity["literalLabels"] == ["Subaru", "Subaru-kun"]
    assert revision["labelToCharacterId"]["TL Note"] is None
    assert cast_progression_blockers(revision) == ["Accept one audition for Natsuki Subaru"]
    identity["voiceAccepted"] = True
    assert cast_progression_blockers(revision) == []


def test_stable_ids_distinguish_group_from_character_and_unicode_is_stable():
    assert stable_character_id("Café") == stable_character_id("Café")
    assert stable_character_id("SUBARU") == stable_character_id("Subaru")
    assert stable_character_id("Everyone", "group") != stable_character_id("Everyone")


def test_layered_group_progression_requires_ready_existing_character_voices():
    cast = {
        "identities": [
            {"characterId": "alice", "name": "Alice", "category": "character", "voiceAccepted": True},
            {"characterId": "rabbit", "name": "Rabbit", "category": "character", "voiceAccepted": True},
            {
                "characterId": "alice-rabbit",
                "name": "Alice & Rabbit",
                "category": "group",
                "voiceAccepted": True,
                "voiceRoute": {"kind": "layered", "characterIds": ["alice", "rabbit"]},
            },
        ]
    }

    assert cast_progression_blockers(cast) == []
    cast["identities"][1]["voiceAccepted"] = False
    assert cast_progression_blockers(cast) == [
        "Accept one audition for Rabbit",
        "Complete the layered voice route for Alice & Rabbit",
    ]


def test_finalization_maps_every_source_spelling_and_reviewed_alias_to_one_identity():
    revision = finalize_identity_mapping(
        [
            {
                "label": "Subaru",
                "sourceSpellings": ["Subaru", "Ｓｕｂａｒｕ", "SUBARU"],
                "category": "character",
                "canonicalName": "Natsuki Subaru",
                "aliases": [],
                "reviewRequired": True,
            }
        ],
        {
            "Subaru": {
                "category": "character",
                "canonicalName": "Natsuki Subaru",
                "aliases": ["Barusu"],
            }
        },
    )

    character_id = stable_character_id("Natsuki Subaru")
    assert revision["labelToCharacterId"] == {
        "Subaru": character_id,
        "Ｓｕｂａｒｕ": character_id,
        "SUBARU": character_id,
        "Barusu": character_id,
    }
    assert revision["identities"][0]["literalLabels"] == [
        "Barusu",
        "SUBARU",
        "Subaru",
        "Ｓｕｂａｒｕ",
    ]
    assert revision["identityReviewDecisions"][0]["aliases"] == ["Barusu"]


def test_reviewed_canonical_assignments_drive_rename_attach_detach_and_reattach():
    proposals = [
        {
            "label": label,
            "sourceSpellings": [],
            "category": "character",
            "canonicalName": label,
            "aliases": [],
            "reviewRequired": True,
        }
        for label in ["Cecilus", "Cecilus Segmunt", "Emilia"]
    ]

    attached = finalize_identity_mapping(
        proposals,
        {
            "Cecilus": {"category": "character", "canonicalName": "Cecilus Segmunt"},
            "Cecilus Segmunt": {
                "category": "character",
                "canonicalName": "Cecilus Segmunt",
            },
            "Emilia": {"category": "character", "canonicalName": "Emilia"},
        },
    )
    assert (
        attached["labelToCharacterId"]["Cecilus"]
        == attached["labelToCharacterId"]["Cecilus Segmunt"]
    )

    detached = finalize_identity_mapping(
        proposals,
        {
            "Cecilus": {"category": "character", "canonicalName": "Cecilus"},
            "Cecilus Segmunt": {
                "category": "character",
                "canonicalName": "Cecilus Segmunt",
            },
            "Emilia": {"category": "character", "canonicalName": "Emilia"},
        },
    )
    assert (
        detached["labelToCharacterId"]["Cecilus"]
        != detached["labelToCharacterId"]["Cecilus Segmunt"]
    )

    reattached_and_renamed = finalize_identity_mapping(
        proposals,
        {
            "Cecilus": {"category": "character", "canonicalName": "Emilia Camp"},
            "Cecilus Segmunt": {
                "category": "character",
                "canonicalName": "Cecilus Segmunt",
            },
            "Emilia": {"category": "character", "canonicalName": "Emilia Camp"},
        },
    )
    emilia_id = stable_character_id("Emilia Camp")
    assert reattached_and_renamed["labelToCharacterId"]["Cecilus"] == emilia_id
    assert reattached_and_renamed["labelToCharacterId"]["Emilia"] == emilia_id


def test_review_can_explicitly_route_a_source_label_to_narrator():
    revision = finalize_identity_mapping(
        [
            {
                "label": "he",
                "sourceSpellings": [],
                "category": "character",
                "canonicalName": "he",
                "aliases": [],
                "reviewRequired": True,
            }
        ],
        {
            "he": {
                "category": "narrator",
                "canonicalName": "",
                "aliases": [],
            }
        },
    )

    assert revision["identities"] == []
    assert revision["labelToCharacterId"] == {"he": None}
    assert revision["identityReviewDecisions"] == [
        {
            "label": "he",
            "category": "narrator",
            "canonicalName": None,
            "aliases": [],
        }
    ]
