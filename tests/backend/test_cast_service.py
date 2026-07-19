from contextlib import contextmanager

import pytest

from meowdiobooks.backend.cast import CastContractError, build_label_dossiers
from meowdiobooks.backend.cast_service import (
    DISCOVERY_SYSTEM,
    MAX_VOICE_PROFILE_PROMPT_CHARACTERS,
    PAIR_SYSTEM,
    SYSTEM,
    VoiceEvidencePolicy,
    VOICE_PROFILE_SYSTEM,
    _combine_confirmed_relationships,
    _apply_pair_decisions,
    _complete_discovery_batch_with,
    _complete_pair_decision_with,
    _complete_voice_settings,
    _label_prompt,
    _union_identity_candidates,
    _proposal_from_decision,
    _surrounding_story_context,
    _voice_target,
    _voice_profile_prompt,
    compile_voice_direction,
    default_voice_settings,
    _validate_decision,
    propose_cast,
    propose_cast_with_completion,
    suggest_voice_settings,
    suggest_voice_settings_with_completion,
    validate_voice_settings,
)
from scripts.benchmark_cast_reconciliation import _benchmark_label_key


def test_ai_resolved_open_marker_builds_dossier_for_resolved_label():
    dossiers = build_label_dossiers(
        [
            {
                "id": "s1",
                "sourceSpeakerLabel": "???",
                "resolvedSpeakerLabel": "Louis",
                "speakerStatus": "ai",
                "source": "???: [Here.]",
                "page": 1,
            }
        ]
    )

    assert [row["label"] for row in dossiers] == ["Louis"]


def test_benchmark_expected_pair_keys_normalize_straight_and_curly_apostrophes():
    assert _benchmark_label_key("Flop O'Connell") == _benchmark_label_key("Flop O’Connell")


def test_cast_prompt_is_focused_and_uses_exact_labels():
    dossier = {
        "label": "Emilia",
        "examples": [{"sourceText": "Emilia: Please, just call me Emilia."}],
    }
    related = {
        "Emilia": dossier,
        "Lady Emilia": {
            "label": "Lady Emilia",
            "examples": [{"sourceText": "Lady Emilia: We should help them."}],
        },
    }

    prompt = _label_prompt(
        dossier,
        related,
        ["Lady Emilia"],
    )

    assert "one-person" in SYSTEM
    assert "sameIdentityAs" in SYSTEM
    assert "allowed references, not proof" in SYSTEM
    assert "TARGET LABEL\nEmilia" in prompt
    assert "- Lady Emilia" in prompt
    assert "Lady Emilia: We should help them." in prompt
    assert "Everyone" not in prompt
    assert "inferredFullName" not in SYSTEM
    assert "canonicalName" not in prompt
    assert "auditionLine" not in prompt
    assert "reviewRequired" not in prompt


def test_voice_profile_prompt_is_one_small_bounded_task():
    prompt = _voice_profile_prompt(
        {
            "name": "Emilia",
            "category": "character",
            "labels": ["Emilia", "Lady Emilia"],
            "evidence": ["Emilia: Please stay behind me."],
            "storyContext": ["[SURROUNDING NARRATION] Lady Emilia's high voice stayed calm."],
        }
    )

    assert "one finalized cast member" in VOICE_PROFILE_SYSTEM
    assert "use unspecified" in VOICE_PROFILE_SYSTEM.lower()
    assert "source language" in VOICE_PROFILE_SYSTEM.lower()
    assert "Name: Emilia" in prompt
    assert "Known source labels: Emilia, Lady Emilia" in prompt
    assert "REPRESENTATIVE TARGET SPEECH" in prompt
    assert "Emilia: Please stay behind me." in prompt
    assert "TARGET-SCOPED STORY CONTEXT" in prompt
    assert "Lady Emilia's high voice stayed calm." in prompt
    assert "sameIdentityAs" not in VOICE_PROFILE_SYSTEM


def test_voice_target_uses_one_first_representative_example_per_alias():
    target = _voice_target(
        {
            "characterId": "emilia",
            "name": "Emilia",
            "category": "character",
            "literalLabels": ["Lady Emilia", "Emilia"],
        },
        {
            "lady emilia": {
                "examples": [
                    {"sourceText": "Lady Emilia: First.", "blockId": "b1"},
                    {"sourceText": "Lady Emilia: Later.", "blockId": "b3"},
                ]
            },
            "emilia": {"examples": [{"sourceText": "Emilia: Here.", "blockId": "b2"}]},
        },
        [],
    )

    assert target["evidence"] == [
        "Lady Emilia: First.",
        "Emilia: Here.",
    ]


def test_expanded_voice_evidence_is_round_robin_and_frequency_prioritized():
    target = _voice_target(
        {
            "characterId": "emilia",
            "name": "Emilia",
            "category": "character",
            "literalLabels": ["Rare Emilia", "Emilia", "Lady Emilia"],
        },
        {
            "rare emilia": {
                "occurrenceCount": 1,
                "examples": [
                    {"sourceText": "Rare Emilia: One."},
                    {"sourceText": "Rare Emilia: Two."},
                ],
            },
            "emilia": {
                "occurrenceCount": 20,
                "examples": [
                    {"sourceText": "Emilia: One."},
                    {"sourceText": "Emilia: Two."},
                ],
            },
            "lady emilia": {
                "occurrenceCount": 8,
                "examples": [
                    {"sourceText": "Lady Emilia: One."},
                    {"sourceText": "Lady Emilia: Two."},
                ],
            },
        },
        [],
        evidence_policy=VoiceEvidencePolicy(
            max_examples=5,
            max_examples_per_label=2,
        ),
    )

    assert target["evidence"] == [
        "Emilia: One.",
        "Lady Emilia: One.",
        "Rare Emilia: One.",
        "Emilia: Two.",
        "Lady Emilia: Two.",
    ]


def test_expanded_voice_evidence_total_cap_prefers_frequent_labels():
    target = _voice_target(
        {
            "characterId": "emilia",
            "name": "Emilia",
            "literalLabels": ["Rare", "Frequent", "Middle"],
        },
        {
            "rare": {"occurrenceCount": 1, "examples": [{"sourceText": "Rare line."}]},
            "frequent": {
                "occurrenceCount": 30,
                "examples": [{"sourceText": "Frequent line."}],
            },
            "middle": {
                "occurrenceCount": 10,
                "examples": [{"sourceText": "Middle line."}],
            },
        },
        [],
        evidence_policy=VoiceEvidencePolicy(max_examples=2),
    )

    assert target["evidence"] == ["Frequent line.", "Middle line."]


@pytest.mark.parametrize(
    "policy",
    [
        {"max_examples": 0},
        {"max_examples": 2, "max_examples_per_label": 3},
        {"max_line_characters": 10},
        {"max_prompt_characters": 10},
    ],
)
def test_voice_evidence_policy_rejects_unsafe_limits(policy):
    with pytest.raises(CastContractError, match="Voice evidence"):
        VoiceEvidencePolicy(**policy)


def test_surrounding_voice_context_is_structural_unicode_safe_and_target_scoped():
    context = _surrounding_story_context(
        [{"sourceText": "エミリア: 行きましょう。", "blockId": "b2"}],
        ["エミリア"],
        [
            {
                "id": "s0",
                "blockId": "b0",
                "renderRole": "narration",
                "text": "Too far before.",
            },
            {
                "id": "s1",
                "blockId": "b1",
                "renderRole": "narration",
                "text": "少女は静かに息を整えた。",
            },
            {
                "id": "s2",
                "blockId": "b2",
                "renderRole": "dialogue",
                "sourceSpeakerLabel": "Guard",
                "source": "Guard: I have a deep voice.",
            },
            {
                "id": "s3",
                "blockId": "b2",
                "renderRole": "dialogue",
                "sourceSpeakerLabel": "エミリア",
                "source": "エミリア: 行きましょう。",
            },
            {
                "id": "s4",
                "blockId": "b3",
                "renderRole": "narration",
                "text": "彼女の高い声が廊下に響いた。",
            },
            {
                "id": "s5",
                "blockId": "b4",
                "renderRole": "narration",
                "text": "Too far after.",
            },
        ],
    )

    prompt = "\n".join(context)
    assert "少女は静かに息を整えた。" in prompt
    assert "[TARGET SPEECH: エミリア] エミリア: 行きましょう。" in prompt
    assert "彼女の高い声が廊下に響いた。" in prompt
    assert "I have a deep voice" not in prompt
    assert "Too far before" not in prompt
    assert "Too far after" not in prompt


def test_voice_suggestions_bound_long_context_and_still_call_once_per_target(monkeypatch):
    calls = []

    @contextmanager
    def fake_server(_repo):
        yield "http://qwen"

    def fake_complete(_base, _system, prompt, **_kwargs):
        calls.append(prompt)
        return {
            "presentation": "unspecified",
            "age": "unspecified",
            "tone": "neutral",
            "pitch": "unspecified",
            "pace": "natural",
            "energy": "balanced",
            "accent": "unspecified",
            "description": "Clear and natural.",
        }

    monkeypatch.setattr("meowdiobooks.backend.cast_service.qwen_server", fake_server)
    monkeypatch.setattr("meowdiobooks.backend.cast_service.complete_json", fake_complete)
    huge_line = "エミリア: " + "とても長い台詞" * 2_000
    profiles = suggest_voice_settings(
        "repo",
        [
            {
                "characterId": "emilia",
                "name": "Emilia",
                "category": "character",
                "literalLabels": ["エミリア"],
            }
        ],
        [
            {
                "label": "エミリア",
                "examples": [{"sourceText": huge_line, "blockId": "b2"}],
            }
        ],
        [
            {"id": "s1", "blockId": "b1", "renderRole": "narration", "text": "少女は息を整えた。"},
            {
                "id": "s2",
                "blockId": "b2",
                "renderRole": "dialogue",
                "sourceSpeakerLabel": "エミリア",
                "source": huge_line,
            },
            {
                "id": "s3",
                "blockId": "b3",
                "renderRole": "narration",
                "text": "彼女の高い声が響いた。",
            },
        ],
    )

    assert set(profiles) == {"narrator", "emilia"}
    assert len(calls) == 2
    assert all(len(prompt) <= MAX_VOICE_PROFILE_PROMPT_CHARACTERS for prompt in calls)
    character_prompt = next(prompt for prompt in calls if "Name: Emilia" in prompt)
    assert "少女は息を整えた。" in character_prompt
    assert "彼女の高い声が響いた。" in character_prompt
    assert "truncated to voice-profile prompt budget" in character_prompt


def test_voice_profile_retry_keeps_the_correction_inside_the_prompt_ceiling(monkeypatch):
    prompts = []

    def fake_complete(_base, _system, prompt, **_kwargs):
        prompts.append(prompt)
        if len(prompts) == 1:
            return {"presentation": "invalid"}
        return {
            "presentation": "unspecified",
            "age": "unspecified",
            "tone": "neutral",
            "pitch": "unspecified",
            "pace": "natural",
            "energy": "balanced",
            "accent": "unspecified",
            "description": "Clear and natural.",
        }

    monkeypatch.setattr("meowdiobooks.backend.cast_service.complete_json", fake_complete)
    result = _complete_voice_settings("http://qwen", "x" * MAX_VOICE_PROFILE_PROMPT_CHARACTERS)

    assert result["tone"] == "neutral"
    assert len(prompts) == 2
    assert all(len(prompt) <= MAX_VOICE_PROFILE_PROMPT_CHARACTERS for prompt in prompts)
    assert prompts[1].startswith("Please try once more.")


def test_voice_profile_retries_when_combined_direction_exceeds_provider_budget(monkeypatch):
    prompts = []

    def fake_complete(_base, _system, prompt, **_kwargs):
        prompts.append(prompt)
        return {
            **default_voice_settings(),
            "accent": "a" * 48 if len(prompts) == 1 else "unspecified",
            "description": "b" * 180 if len(prompts) == 1 else "Compact audible cues.",
        }

    monkeypatch.setattr("meowdiobooks.backend.cast_service.complete_json", fake_complete)
    result = _complete_voice_settings("http://qwen", "voice evidence")

    assert result["description"] == "Compact audible cues."
    assert len(prompts) == 2
    assert "Voice direction exceeds 250 characters" in prompts[1]
    assert "Keep every useful audible cue" in prompts[1]
    assert len(compile_voice_direction(result)) <= 250


def test_voice_profile_mechanically_compacts_only_free_text_after_failed_retry(monkeypatch):
    prompts = []
    raw = {
        "presentation": "masculine",
        "age": "older-adult",
        "tone": "gravelly",
        "pitch": "low",
        "pace": "measured",
        "energy": "restrained",
        "accent": "careful regional English",
        "description": ("Keep every audible performance cue " * 5).strip(),
    }

    def fake_complete(_base, _system, prompt, **_kwargs):
        prompts.append(prompt)
        return raw

    monkeypatch.setattr("meowdiobooks.backend.cast_service.complete_json", fake_complete)
    result = _complete_voice_settings("http://qwen", "voice evidence")

    assert len(prompts) == 2
    for field in ("presentation", "age", "tone", "pitch", "pace", "energy", "accent"):
        assert result[field] == raw[field]
    assert raw["description"].startswith(result["description"].rstrip("."))
    assert len(result["description"]) < len(raw["description"])
    assert len(compile_voice_direction(result)) <= 250


def test_voice_profile_mechanically_bounds_overlong_description_after_failed_retry(monkeypatch):
    raw = {
        **default_voice_settings(),
        "description": ("Preserve this audible cue " * 12).strip(),
    }

    monkeypatch.setattr(
        "meowdiobooks.backend.cast_service.complete_json",
        lambda _base, _system, _prompt, **_kwargs: raw,
    )
    result = _complete_voice_settings("http://qwen", "voice evidence")

    assert raw["description"].startswith(result["description"].rstrip("."))
    assert len(result["description"]) <= 180
    assert len(compile_voice_direction(result)) <= 250


def test_voice_settings_validate_fixed_handles_and_compile_one_direction():
    settings = validate_voice_settings(
        {
            "presentation": "feminine",
            "age": "young-adult",
            "tone": "warm",
            "pitch": "medium",
            "pace": "measured",
            "energy": "restrained",
            "accent": "unspecified",
            "description": "Soft-spoken but resolute.",
        }
    )

    direction = compile_voice_direction(settings)
    assert direction == (
        "Female young adult voice; warm, rounded timbre; medium pitch; measured pace; "
        "restrained energy; Soft-spoken but resolute."
    )


def test_voice_performance_note_is_optional():
    settings = validate_voice_settings(
        {
            **default_voice_settings(),
            "description": "",
        }
    )

    assert settings["description"] == ""
    assert compile_voice_direction(settings).endswith("balanced energy.")


def test_voice_direction_makes_accent_a_direct_audible_instruction():
    settings = {
        **default_voice_settings(),
        "accent": "Japanese",
        "description": "Calm and observant.",
    }

    direction = compile_voice_direction(settings, language="english")

    assert "Japanese accent in English" in direction


def test_voice_direction_preserves_subaru_traits_and_notes_within_provider_limit():
    settings = {
        "presentation": "masculine",
        "age": "child",
        "tone": "bright",
        "pitch": "low",
        "pace": "brisk",
        "energy": "animated",
        "accent": "unspecified",
        "description": (
            "Deliver the lines with a lively, startled edge and quick shifts into worried "
            "sarcasm. 13 yo guy from Japan."
        ),
    }

    direction = compile_voice_direction(settings)

    assert direction.startswith("Male child voice; bright, clear timbre; low pitch")
    assert "13 yo guy from Japan" in direction
    assert len(direction) <= 250


def test_voice_direction_rejects_overflow_instead_of_dropping_user_text():
    settings = {
        **default_voice_settings(),
        "accent": "a" * 48,
        "description": "b" * 180,
    }

    with pytest.raises(CastContractError, match="exceeds 250 characters"):
        compile_voice_direction(settings)


def test_decision_contract_accepts_multiple_exact_relationships():
    decision = _validate_decision(
        {
            "speakerType": "one-person",
            "sameIdentityAs": ["Lady Emilia", "Emilia-sama"],
            "possiblySameIdentityAs": ["The Silver-Haired Girl"],
        },
        "Emilia",
        ["Emilia", "Lady Emilia", "Emilia-sama", "The Silver-Haired Girl"],
    )

    assert decision["sameIdentityAs"] == ["Lady Emilia", "Emilia-sama"]
    assert decision["possiblySameIdentityAs"] == ["The Silver-Haired Girl"]


@pytest.mark.parametrize(
    ("patch", "error"),
    [
        ({"sameIdentityAs": ["Invented"]}, "unknown label"),
        ({"sameIdentityAs": ["Emilia"]}, "target label"),
        ({"sameIdentityAs": "Lady Emilia"}, "must be a list"),
        ({"speakerType": "editorial"}, "Unsupported speakerType"),
    ],
)
def test_decision_contract_rejects_ambiguous_or_invented_output(patch, error):
    raw = {
        "speakerType": "one-person",
        "sameIdentityAs": [],
        "possiblySameIdentityAs": [],
        **patch,
    }

    with pytest.raises(CastContractError, match=error):
        _validate_decision(raw, "Emilia", ["Emilia", "Lady Emilia"])


def test_confirmed_relationships_are_combined_in_code():
    proposals = _combine_confirmed_relationships(
        [
            {
                "label": "Emilia",
                "category": "character",
                "canonicalName": "Emilia",
                "aliases": ["Lady Emilia"],
                "reviewRequired": True,
            },
            {
                "label": "Lady Emilia",
                "category": "character",
                "canonicalName": "Lady Emilia",
                "aliases": ["Emilia"],
                "reviewRequired": False,
            },
        ]
    )

    assert {row["canonicalName"] for row in proposals} == {"Lady Emilia"}
    assert proposals[0]["aliases"] == ["Lady Emilia"]
    assert proposals[1]["aliases"] == ["Emilia"]
    assert all(row["reviewRequired"] for row in proposals)


def test_one_sided_identity_claim_stays_a_suggestion():
    proposals = _combine_confirmed_relationships(
        [
            {
                "label": "Gustav",
                "category": "character",
                "canonicalName": "Gustav",
                "aliases": ["Cecilus"],
                "competingLabels": [],
                "reviewRequired": True,
            },
            {
                "label": "Cecilus",
                "category": "character",
                "canonicalName": "Cecilus",
                "aliases": [],
                "competingLabels": [],
                "reviewRequired": False,
            },
        ]
    )

    assert [row["canonicalName"] for row in proposals] == ["Gustav", "Cecilus"]
    assert proposals[0]["aliases"] == []
    assert proposals[0]["competingLabels"] == ["Cecilus"]
    assert proposals[1]["aliases"] == []


def test_propose_cast_classifies_discovers_and_adjudicates_once_per_pair(monkeypatch):
    turns = [
        {
            "id": "s1",
            "sourceSpeakerLabel": "Subaru",
            "speakerStatus": "explicit",
            "source": "Subaru: Run!",
            "page": 1,
        },
        {
            "id": "s2",
            "sourceSpeakerLabel": "Subaro",
            "speakerStatus": "explicit",
            "source": "Subaro: Wait!",
            "page": 2,
        },
    ]
    calls = []
    progress = []

    @contextmanager
    def fake_server(_repo):
        yield "http://qwen"

    def fake_complete(_base, system, prompt, **_kwargs):
        calls.append((system, prompt))
        if system == DISCOVERY_SYSTEM:
            return {
                "classifications": [
                    {"label": "Subaru", "speakerType": "one-person"},
                    {"label": "Subaro", "speakerType": "one-person"},
                ],
                "candidatePairs": [
                    {
                        "leftLabel": "Subaru",
                        "rightLabel": "Subaro",
                        "reason": "Likely spelling variant.",
                    }
                ]
            }
        if system == PAIR_SYSTEM:
            return {"relationship": "same", "reason": "Both dossiers identify Subaru."}
        raise AssertionError("No standalone classification call is expected")

    monkeypatch.setattr("meowdiobooks.backend.cast_service.qwen_server", fake_server)
    monkeypatch.setattr("meowdiobooks.backend.cast_service.complete_json", fake_complete)

    result = propose_cast(
        "repo",
        turns,
        lambda value, message=None: progress.append((value, message)),
    )

    assert len(calls) == 2
    assert result["processing"] == {
        "labels": 2,
        "batches": 1,
        "classificationDiscoveryCalls": 1,
        "adjudicationCalls": 1,
        "modelCalls": 2,
        "reconciliationPasses": 1,
        "candidatePairs": 1,
        "modelNominations": 1,
        "candidateSourceMemberships": {
            "deterministic-lexical": 1,
            "global-discovery": 1,
        },
        "model": "Qwen 3.5 9B local",
    }
    assert {row["canonicalName"] for row in result["proposals"]} == {"Subaru"}
    assert progress[0] == (2, "Classifying and discovering 2 character labels with AI")
    assert all(row["reviewRequired"] for row in result["proposals"])


def test_provider_neutral_cast_completion_preserves_shared_merge_contract():
    turns = [
        {
            "id": "s1",
            "sourceSpeakerLabel": "Subaru",
            "speakerStatus": "explicit",
            "source": "Subaru: Run!",
            "page": 1,
        },
        {
            "id": "s2",
            "sourceSpeakerLabel": "Subaro",
            "speakerStatus": "explicit",
            "source": "Subaro: Wait!",
            "page": 2,
        },
    ]

    def complete(system, _prompt, _max_tokens):
        if system == DISCOVERY_SYSTEM:
            return {
                "classifications": [
                    {"label": "Subaru", "speakerType": "one-person"},
                    {"label": "Subaro", "speakerType": "one-person"},
                ],
                "candidatePairs": [
                    {
                        "leftLabel": "Subaru",
                        "rightLabel": "Subaro",
                        "reason": "Likely spelling variant.",
                    }
                ]
            }
        if system == PAIR_SYSTEM:
            return {"relationship": "same", "reason": "The names and evidence agree."}
        raise AssertionError("No standalone classification call is expected")

    result = propose_cast_with_completion(
        turns,
        complete,
        model_name="Test remote model",
        max_workers=2,
    )

    assert result["processing"]["model"] == "Test remote model"
    assert {row["canonicalName"] for row in result["proposals"]} == {"Subaru"}


def test_global_discovery_batches_include_the_complete_ledger_and_allow_cross_batch_pairs():
    turns = [
        {
            "id": f"s{index}",
            "sourceSpeakerLabel": f"Person {index}",
            "speakerStatus": "explicit",
            "source": f"Person {index}: Hello.",
            "page": index,
        }
        for index in range(25)
    ]
    discovery_prompts = []

    def complete(system, prompt, _max_tokens):
        if system == DISCOVERY_SYSTEM:
            discovery_prompts.append(prompt)
            owned = [
                line.removeprefix("LABEL: ")
                for line in prompt.splitlines()
                if line.startswith("LABEL: ")
            ]
            candidates = []
            if "LABEL: Person 24" in prompt:
                candidates.append(
                    {
                        "leftLabel": "Person 24",
                        "rightLabel": "Person 0",
                        "reason": "The final dossier explicitly resolves to the first label.",
                    }
                )
            return {
                "classifications": [
                    {"label": label, "speakerType": "one-person"} for label in owned
                ],
                "candidatePairs": candidates,
            }
        if system == PAIR_SYSTEM:
            return {"relationship": "possible", "reason": "Evidence remains ambiguous."}
        raise AssertionError("No standalone classification call is expected")

    result = propose_cast_with_completion(turns, complete, model_name="Test Luna")

    assert len(discovery_prompts) == 2
    assert all("Person 0\t1\tfirst:0" in prompt for prompt in discovery_prompts)
    assert all("Person 24\t1\tfirst:24" in prompt for prompt in discovery_prompts)
    assert result["processing"]["classificationDiscoveryCalls"] == 2
    by_label = {row["label"]: row for row in result["proposals"]}
    assert "Person 24" in by_label["Person 0"]["competingLabels"]
    assert "Person 0" in by_label["Person 24"]["competingLabels"]
    assert by_label["Person 0"]["reviewRequired"] is True
    assert by_label["Person 24"]["reviewRequired"] is True


def test_deterministic_union_finds_short_name_and_explicit_full_name_mentions():
    dossiers = [
        {
            "label": "Ceci",
            "examples": [
                {
                    "sourceText": "Ceci: I am Cecilus Segmunt.",
                    "contextBefore": "The blue-haired swordsman bowed.",
                }
            ],
        },
        {"label": "Cecilus", "examples": [{"sourceText": "Cecilus: Yes."}]},
        {
            "label": "Cecilus Segmunt",
            "examples": [{"sourceText": "Cecilus Segmunt: Indeed."}],
        },
    ]

    candidates = _union_identity_candidates(dossiers, [], [])
    pairs = {
        frozenset((row["leftLabel"], row["rightLabel"])): row for row in candidates
    }

    assert frozenset(("Ceci", "Cecilus")) in pairs
    assert frozenset(("Ceci", "Cecilus Segmunt")) in pairs
    full_name = pairs[frozenset(("Ceci", "Cecilus Segmunt"))]
    assert "deterministic-context" in full_name["sources"]


def test_deterministic_union_nominates_all_known_missed_short_full_name_pairs():
    known_pairs = (
        ("Ceci", "Cecilus"),
        ("Berstetz", "Berstetz Fondalfon"),
        ("Goz", "Goz Ralfon"),
        ("Frederica", "Frederica Baumann"),
        ("Gudda", "Gudda Dialmo"),
        ("Madelyn", "Madelyn Eschart"),
        ("Flop", "Flop O’Connell"),
    )
    dossiers = [
        {"label": label, "examples": []} for pair in known_pairs for label in pair
    ]

    candidates = _union_identity_candidates(dossiers, [], [])
    nominated = {
        frozenset((row["leftLabel"], row["rightLabel"])) for row in candidates
    }

    assert nominated == {frozenset(pair) for pair in known_pairs}


def test_deterministic_union_rejects_joint_names_and_plain_scene_cooccurrence():
    dossiers = [
        {
            "label": "Flop",
            "examples": [
                {
                    "sourceText": "Flop: We should leave.",
                    "contextAfter": (
                        "Katya turned to Flop while Rem stood beside Flop O'Connell."
                    ),
                }
            ],
        },
        {"label": "Flop O'Connell", "examples": []},
        {"label": "Flop & Rem", "examples": []},
        {"label": "Rem & Flop", "examples": []},
        {"label": "Katya", "examples": []},
        {"label": "Rem", "examples": []},
    ]

    candidates = _union_identity_candidates(dossiers, [], [])
    nominated = {
        frozenset((row["leftLabel"], row["rightLabel"])) for row in candidates
    }

    assert nominated == {frozenset(("Flop", "Flop O'Connell"))}


def test_deterministic_context_requires_explicit_self_id_or_descriptive_apposition():
    dossiers = [
        {
            "label": "Masked Speaker",
            "examples": [{"sourceText": "Masked Speaker: My name is Aldebaran."}],
        },
        {"label": "Aldebaran", "examples": []},
        {
            "label": "Blue-Haired Boy",
            "examples": [
                {"contextBefore": "The Blue-Haired Boy, Cecilus, bowed deeply."}
            ],
        },
        {"label": "Cecilus", "examples": []},
    ]

    candidates = _union_identity_candidates(dossiers, [], [])
    nominated = {
        frozenset((row["leftLabel"], row["rightLabel"])) for row in candidates
    }

    assert frozenset(("Masked Speaker", "Aldebaran")) in nominated
    assert frozenset(("Blue-Haired Boy", "Cecilus")) in nominated


def test_discovery_and_pair_contracts_reject_unknown_or_asymmetric_shapes():
    discovery_answers = iter(
        [
            {
                "classifications": [{"label": "Emilia", "speakerType": "one-person"}],
                "candidatePairs": [
                    {"leftLabel": "Unknown", "rightLabel": "Emilia", "reason": "No."}
                ]
            },
            {
                "classifications": [{"label": "Emilia", "speakerType": "one-person"}],
                "candidatePairs": [
                    {
                        "leftLabel": "Lady Emilia",
                        "rightLabel": "Emilia",
                        "reason": "Title variant.",
                    }
                ]
            },
        ]
    )
    discovered = _complete_discovery_batch_with(
        lambda *_args: next(discovery_answers),
        "prompt",
        ["Emilia"],
        ["Emilia", "Lady Emilia"],
    )
    assert discovered["candidatePairs"] == [
        {
            "leftLabel": "Emilia",
            "rightLabel": "Lady Emilia",
            "reason": "Title variant.",
            "source": "global-discovery",
        }
    ]

    pair_answers = iter(
        [
            {"leftRelationship": "same", "rightRelationship": "possible"},
            {"relationship": "same", "reason": "Both dossiers identify Emilia."},
        ]
    )
    assert _complete_pair_decision_with(lambda *_args: next(pair_answers), "prompt") == {
        "relationship": "same",
        "decisionReason": "Both dossiers identify Emilia.",
    }


def test_contradictory_pair_evidence_prevents_transitive_automatic_merge():
    proposals = [
        {
            "label": label,
            "category": "character",
            "canonicalName": label,
            "aliases": [],
            "competingLabels": [],
            "reviewRequired": False,
        }
        for label in ("A-name", "B-name", "C-name")
    ]
    decisions = [
        {"leftLabel": "A-name", "rightLabel": "B-name", "relationship": "same"},
        {"leftLabel": "B-name", "rightLabel": "C-name", "relationship": "same"},
        {"leftLabel": "A-name", "rightLabel": "C-name", "relationship": "different"},
    ]

    resolved = _apply_pair_decisions(proposals, decisions)

    assert {row["canonicalName"] for row in resolved} == {"A-name", "B-name", "C-name"}
    assert all(row["reviewRequired"] for row in resolved)
    assert decisions[0]["automaticMerge"] is False
    assert decisions[1]["automaticMerge"] is False


def test_provider_neutral_voice_completion_preserves_shared_validation():
    def complete(_system, _prompt, _max_tokens):
        return {
            "presentation": "unspecified",
            "age": "unspecified",
            "tone": "gentle",
            "pitch": "unspecified",
            "pace": "natural",
            "energy": "balanced",
            "accent": "unspecified",
            "description": "Quiet and precise.",
        }

    profiles = suggest_voice_settings_with_completion(
        [],
        [],
        [],
        complete,
        max_workers=2,
    )

    assert profiles["narrator"]["tone"] == "gentle"


def test_selective_voice_completion_does_not_reprofile_an_unchanged_narrator():
    prompts = []

    def complete(_system, prompt, _max_tokens):
        prompts.append(prompt)
        return {
            "presentation": "feminine",
            "age": "adult",
            "tone": "bright",
            "pitch": "medium",
            "pace": "natural",
            "energy": "balanced",
            "accent": "unspecified",
            "description": "Clear and direct.",
        }

    profiles = suggest_voice_settings_with_completion(
        [
            {
                "characterId": "character-alice",
                "name": "Alice",
                "category": "character",
                "literalLabels": ["Alice"],
            }
        ],
        [],
        [],
        complete,
        include_narrator=False,
    )

    assert set(profiles) == {"character-alice"}
    assert len(prompts) == 1
    assert "Narrator" not in prompts[0]


def test_global_discovery_can_nominate_any_known_label_and_retries_invented_labels(monkeypatch):
    turns = [
        {
            "id": "s1",
            "sourceSpeakerLabel": "Cecilus",
            "speakerStatus": "explicit",
            "source": "Cecilus: I am Cecilus Segmunt.",
            "page": 1,
        },
        {
            "id": "s2",
            "sourceSpeakerLabel": "Cecilus Segmunt",
            "speakerStatus": "explicit",
            "source": "Cecilus Segmunt: Indeed.",
            "page": 2,
        },
        {
            "id": "s3",
            "sourceSpeakerLabel": "Todd",
            "speakerStatus": "explicit",
            "source": "Todd: I am a soldier.",
            "page": 3,
        },
    ]
    prompts = []
    discovery_attempts = 0

    @contextmanager
    def fake_server(_repo):
        yield "http://qwen"

    def fake_complete(_base, system, prompt, **_kwargs):
        nonlocal discovery_attempts
        prompts.append(prompt)
        if system == DISCOVERY_SYSTEM:
            discovery_attempts += 1
            right = "Invented" if discovery_attempts == 1 else "Cecilus Segmunt"
            return {
                "classifications": [
                    {"label": "Cecilus", "speakerType": "one-person"},
                    {"label": "Cecilus Segmunt", "speakerType": "one-person"},
                    {"label": "Todd", "speakerType": "one-person"},
                ],
                "candidatePairs": [
                    {
                        "leftLabel": "Cecilus",
                        "rightLabel": right,
                        "reason": "The short label gives the full name.",
                    }
                ]
            }
        if system == PAIR_SYSTEM:
            return {"relationship": "same", "reason": "Explicit self-identification."}
        raise AssertionError("No standalone classification call is expected")

    monkeypatch.setattr("meowdiobooks.backend.cast_service.qwen_server", fake_server)
    monkeypatch.setattr("meowdiobooks.backend.cast_service.complete_json", fake_complete)

    result = propose_cast("repo", turns)

    by_label = {row["label"]: row for row in result["proposals"]}
    assert by_label["Cecilus"]["canonicalName"] == "Cecilus Segmunt"
    assert by_label["Cecilus Segmunt"]["canonicalName"] == "Cecilus Segmunt"
    assert by_label["Todd"]["canonicalName"] == "Todd"
    discovery_prompts = [prompt for prompt in prompts if "GLOBAL LABEL LEDGER" in prompt]
    assert discovery_attempts == 2
    assert all("Todd" in prompt for prompt in discovery_prompts)
    assert any("label outside the ledger" in prompt for prompt in discovery_prompts)


def test_decision_contract_rejects_removed_inferred_full_name_field():
    with pytest.raises(CastContractError, match="exactly the three required fields"):
        _validate_decision(
            {
                "speakerType": "one-person",
                "sameIdentityAs": [],
                "possiblySameIdentityAs": [],
                "inferredFullName": "Cecilus Segmunt",
            },
            "Todd",
            ["Todd"],
        )


def test_no_candidate_relationships_are_deterministically_empty():
    decision = _validate_decision(
        {
            "speakerType": "one-person",
            "sameIdentityAs": ["Todd"],
            "possiblySameIdentityAs": ["Cecilus"],
        },
        "Subaru",
        ["Subaru"],
    )

    assert decision == {
        "speakerType": "one-person",
        "sameIdentityAs": [],
        "possiblySameIdentityAs": [],
    }


def test_explicit_joint_label_cannot_silently_become_one_character():
    proposal = _proposal_from_decision(
        {"label": "Subaru & Cecilus", "sourceSpellings": ["Subaru & Cecilus"]},
        {
            "speakerType": "one-person",
            "sameIdentityAs": [],
            "possiblySameIdentityAs": [],
        },
    )

    assert proposal["category"] == "group"
    assert proposal["canonicalName"] == "Subaru & Cecilus"
    assert proposal["reviewRequired"] is True
