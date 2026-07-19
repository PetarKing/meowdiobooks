import pytest

from meowdiobooks.backend.dialogue import (
    DialogueContractError,
    dialogue_progression_blockers,
    pages_to_dialogue_blocks,
    reconstruct_partition,
    scan_dialogue,
)


def test_builtin_profiles_find_labelled_and_multilingual_formats():
    pages = [
        {
            "page": 7,
            "text": (
                "Subaru: [Wait here.]\n\n"
                "Alice: “Come inside.”\n\n"
                'Rabbit: "I am late."\n\n'
                "Cecilus — Together now!\n\n"
                "EMILIA\nDo not be afraid.\n\n"
                "She whispered, “Run.” Then «Vite!» and 「行こう」."
            ),
        }
    ]

    result = scan_dialogue(
        pages,
        enabled_profile_ids={
            profile_id
            for profile_id in (
                "label-brackets",
                "label-curly-quotes",
                "label-straight-quotes",
                "label-dash",
                "screenplay",
                "unlabeled-curly-quotes",
                "unlabeled-straight-quotes",
                "unlabeled-guillemets",
                "unlabeled-cjk-quotes",
            )
        },
    )
    counts = {row["id"]: row["matchCount"] for row in result["profiles"]}

    assert counts["label-brackets"] == 1
    assert counts["label-curly-quotes"] == 1
    assert counts["label-straight-quotes"] == 1
    assert counts["label-dash"] == 1
    assert counts["screenplay"] == 1
    assert counts["unlabeled-curly-quotes"] == 2
    assert counts["unlabeled-guillemets"] == 1
    assert counts["unlabeled-cjk-quotes"] == 1
    assert result["summary"] == {
        "regexClaims": 8,
        "explicitTurns": 5,
        "openSpeakerTurns": 0,
        "unlabelledCandidates": 3,
        "conflicts": 0,
        "structuralIssues": 0,
        "continuedTurns": 0,
    }
    curly_example = next(
        row for row in result["profiles"] if row["id"] == "unlabeled-curly-quotes"
    )["examples"][0]
    assert curly_example["contextBefore"]
    assert curly_example["contextAfter"]
    assert reconstruct_partition(result)[7] == pages[0]["text"]


def test_regex_evidence_includes_complete_line_and_nearest_nonempty_lines():
    source = "Before context.\n\nAlice: [A short match.] trailing text\n\nAfter context."
    result = scan_dialogue(
        [{"page": 1, "text": source}], enabled_profile_ids=["label-brackets"]
    )
    example = next(row for row in result["profiles"] if row["id"] == "label-brackets")[
        "examples"
    ][0]

    assert example["contextBefore"].startswith("Before context.")
    assert example["contextBefore"].endswith("\n\n")
    assert example["source"] == "Alice: [A short match.]"
    assert example["contextAfter"].startswith(" trailing text")
    assert example["contextAfter"].rstrip().endswith("After context.")


def test_builtin_label_recipes_reject_prose_and_screenplay_is_opt_in():
    source = (
        "not to be listening, so she went on again:\n“Twenty-four hours,” she said.\n\n"
        "livery came running out of the wood— (she continued)\n\n"
        "Arc 7, Chapter 40 – “Natchuki Subawu”\n\n"
        "Subaru: [————]\n\n"
        "PIG AND PEPPER\nnow and then a great crash, as if a dish had broken."
    )

    result = scan_dialogue([{"page": 1, "text": source}])
    profiles = {row["id"]: row for row in result["profiles"]}

    assert profiles["label-curly-quotes"]["matchCount"] == 0
    assert profiles["label-dash"]["matchCount"] == 0
    assert profiles["screenplay"]["matchCount"] == 1
    assert profiles["screenplay"]["enabled"] is False
    assert profiles["screenplay"]["builtIn"] is True
    assert profiles["screenplay"]["pattern"]
    assert result["summary"]["explicitTurns"] == 1
    assert result["summary"]["conflicts"] == 0


def test_uppercase_speaker_colon_lines_are_detected_without_claiming_stage_directions():
    source = (
        "THE PLAY\n"
        "SMITH: Miss Caroline, I'm here.\n"
        "me after school.\n"
        "LIGHTS TURN OFF LOUDLY.\n"
        "SMITH: (shocked) I can't see a thing.\n"
        "THE SOUND OF IPHONE BUTTONS.\n"
        "SMITH: (footsteps) I'll check the dressing rooms.\n"
        "SMITH: Ms Caroline, are you here?\n"
        "LITTLE PEEVES: She's not here.\n"
        "SMITH: Who are you?\n"
        "LITTLE PEEVES: I am Peeves.\n"
        "SMITH: Do you know where Miss Caroline is?\n"
        "LITTLE PEEVES: Yes.\n"
        "SMITH: Where is your voice coming from?\n"
        "LITTLE PEEVES: I don't know anymore.\n"
        "SMITH: What do you mean?\n"
        "LITTLE PEEVES: Like the one behind you.\n"
        "SMITH: What?\n"
        "SMITH: Get up!\n"
        "LITTLE PEEVES: She's dead.\n"
        "SMITH: I'm out.\n"
        "SMITH RUNS AWAY."
    )

    result = scan_dialogue([{"page": 1, "text": source}])
    profiles = {row["id"]: row for row in result["profiles"]}

    assert profiles["label-colon-line"]["matchCount"] == 17
    assert result["summary"]["explicitTurns"] == 17
    assert result["summary"]["conflicts"] == 0
    assert {row["sourceSpeakerLabel"] for row in result["acceptedMatches"]} == {
        "SMITH",
        "LITTLE PEEVES",
    }
    narration = "".join(
        row["text"] for row in result["partition"] if row["renderRole"] == "narration"
    )
    assert "LIGHTS TURN OFF LOUDLY." in narration
    assert "SMITH RUNS AWAY." in narration
    assert reconstruct_partition(result)[1] == source


def test_speaker_colon_rule_does_not_overlap_existing_delimited_label_rules():
    source = (
        "SMITH: [Bracketed.]\n\n"
        "SMITH: “Curly quoted.”\n\n"
        'SMITH: "Straight quoted."\n\n'
        "SMITH: He repeated “embedded words” calmly."
    )

    result = scan_dialogue([{"page": 1, "text": source}])
    profiles = {row["id"]: row for row in result["profiles"]}

    assert profiles["label-colon-line"]["matchCount"] == 1
    assert profiles["label-brackets"]["matchCount"] == 1
    assert profiles["label-curly-quotes"]["matchCount"] == 1
    assert profiles["label-straight-quotes"]["matchCount"] == 1
    assert result["summary"]["explicitTurns"] == 4
    assert result["summary"]["conflicts"] == 0
    assert reconstruct_partition(result)[1] == source


def test_equivalent_custom_speaker_colon_rule_coalesces_without_a_conflict():
    source = "SMITH: Run now."
    custom = [
        {
            "id": "custom-speaker-colon",
            "pattern": r"^(?P<speaker>[A-Z][A-Z ]+):\s*(?P<text>[^\n]+)",
        }
    ]

    result = scan_dialogue([{"page": 1, "text": source}], custom_profiles=custom)

    assert result["summary"]["conflicts"] == 0
    assert len(result["acceptedMatches"]) == 1
    assert result["acceptedMatches"][0]["matchedProfileIds"] == [
        "custom-speaker-colon",
        "label-colon-line",
    ]
    assert reconstruct_partition(result)[1] == source


def test_different_custom_speaker_colon_claim_uses_explicit_conflict_review():
    source = "SMITH: Run now."
    custom = [
        {
            "id": "custom-partial-speaker-colon",
            "pattern": r"^(?P<speaker>[A-Z][A-Z ]+):\s*(?P<text>Run)",
        }
    ]

    result = scan_dialogue([{"page": 1, "text": source}], custom_profiles=custom)

    assert result["summary"]["conflicts"] == 1
    assert result["acceptedMatches"] == []
    assert result["conflicts"][0]["profileIds"] == [
        "custom-partial-speaker-colon",
        "label-colon-line",
    ]
    assert dialogue_progression_blockers(result) == [
        "Resolve 1 overlapping regex claim(s) before acceptance"
    ]
    assert reconstruct_partition(result)[1] == source


def test_pages_become_stable_page_relative_blocks_without_losing_separators():
    pages = [{"page": 3, "text": "First.\n\nSecond.\n\nThird."}]

    blocks = pages_to_dialogue_blocks(pages)

    assert [row["id"] for row in blocks] == ["p3-b1", "p3-b2", "p3-b3"]
    assert [row["pageStart"] for row in blocks] == [0, 8, 17]
    assert "".join(row["text"] for row in blocks) == pages[0]["text"]


def test_open_speaker_literals_and_patterns_are_configurable_not_cast_names():
    pages = [
        {
            "page": 1,
            "text": "???: [First.]\n\nUnidentified Voice: [Second.]\n\nGuard: [Third.]",
        }
    ]

    result = scan_dialogue(
        pages,
        open_speaker_literals=("???",),
        open_speaker_patterns=(r"Unidentified\s+Voice",),
    )

    matches = {row["sourceSpeakerLabel"]: row for row in result["acceptedMatches"]}
    assert matches["???"]["speakerStatus"] == "unresolved"
    assert matches["Unidentified Voice"]["speakerStatus"] == "unresolved"
    assert matches["Guard"]["speakerStatus"] == "explicit"
    assert result["summary"]["openSpeakerTurns"] == 2


def test_ordered_custom_regexes_support_toggles_and_examples():
    pages = [{"page": 1, "text": "<Alice> Hello.\n\n(Bob) Goodbye."}]
    custom = [
        {
            "id": "angle-label",
            "label": "Angle label",
            "pattern": r"<(?P<speaker>[^>]+)>\s*(?P<text>[^\n]+)",
        },
        {
            "id": "paren-label",
            "pattern": r"\((?P<speaker>[^)]+)\)\s*(?P<text>[^\n]+)",
        },
    ]

    all_enabled = scan_dialogue(pages, custom_profiles=custom)
    paren_disabled = scan_dialogue(
        pages,
        custom_profiles=custom,
        enabled_profile_ids={
            "label-brackets",
            "label-curly-quotes",
            "label-straight-quotes",
            "label-dash",
            "screenplay",
            "unlabeled-curly-quotes",
            "unlabeled-straight-quotes",
            "unlabeled-guillemets",
            "unlabeled-cjk-quotes",
            "angle-label",
        },
    )

    stats = {row["id"]: row for row in all_enabled["profiles"]}
    disabled_stats = {row["id"]: row for row in paren_disabled["profiles"]}
    assert stats["angle-label"]["matchCount"] == 1
    assert stats["angle-label"]["examples"][0]["sourceSpeakerLabel"] == "Alice"
    assert disabled_stats["paren-label"]["enabled"] is False
    # Disabled profiles retain their potential count/examples so the UI can keep
    # showing the toggle and its consequence.
    assert disabled_stats["paren-label"]["matchCount"] == 1
    assert {row["sourceSpeakerLabel"] for row in paren_disabled["acceptedMatches"]} == {"Alice"}


def test_custom_regex_flags_are_validated_and_applied():
    profile = {
        "id": "multiline-dotall",
        "pattern": r"\ABEGIN\[(?P<text>.+)\]END\Z",
        "flags": "ms",
    }

    result = scan_dialogue(
        [{"page": 1, "text": "BEGIN[first\nsecond]END"}],
        custom_profiles=[profile],
    )
    custom = next(row for row in result["profiles"] if row["id"] == profile["id"])

    assert custom["matchCount"] == 1
    assert custom["flags"] == "ms"
    assert result["acceptedMatches"][0]["text"] == "first\nsecond"

    with pytest.raises(DialogueContractError, match="Unsupported regex flags"):
        scan_dialogue(
            [{"page": 1, "text": "BEGIN[first]END"}],
            custom_profiles=[{**profile, "flags": "mi"}],
        )


@pytest.mark.parametrize(
    "profile,error",
    [
        ({"id": "broken", "pattern": "("}, "invalid"),
        ({"id": "missing-text", "pattern": r"(?P<speaker>.+)"}, "named 'text'"),
        ({"id": "empty", "pattern": r"(?P<text>.*?)"}, "empty match"),
    ],
)
def test_custom_regex_validation_is_transactional(profile, error):
    with pytest.raises(DialogueContractError, match=error):
        scan_dialogue([{"page": 1, "text": "Alice"}], custom_profiles=[profile])


def test_overlapping_source_claims_are_visible_and_not_silently_partitioned_as_dialogue():
    pages = [{"page": 1, "text": "<Alice>Hello</Alice>"}]
    custom = [
        {
            "id": "outer",
            "pattern": r"<(?P<speaker>[^>]+)>(?P<text>.+)</[^>]+>",
        },
        {
            "id": "inner",
            "pattern": r"(?P<text>Hello</Alice>)",
        },
    ]

    result = scan_dialogue(pages, custom_profiles=custom)

    assert result["summary"]["conflicts"] == 1
    assert result["acceptedMatches"] == []
    assert result["partition"][0]["renderRole"] == "narration"
    assert reconstruct_partition(result)[1] == pages[0]["text"]
    assert dialogue_progression_blockers(result) == [
        "Resolve 1 overlapping regex claim(s) before acceptance"
    ]


def test_conflict_resolution_selects_one_regex_only_at_overlapping_occurrences():
    pages = [{"page": 1, "text": "<Alice>Hello</Alice>\n\n<Bob>Goodbye</Bob>"}]
    custom = [
        {
            "id": "labelled",
            "pattern": r"<(?P<speaker>[^>]+)>(?P<text>.+?)</[^>]+>",
        },
        {
            "id": "partial",
            "pattern": r"(?P<text>Hello</Alice>)",
        },
    ]

    preview = scan_dialogue(pages, custom_profiles=custom)
    result = scan_dialogue(
        pages,
        custom_profiles=custom,
        conflict_resolutions=[
            {"profileIds": ["labelled", "partial"], "winnerProfileId": "labelled"}
        ],
    )

    assert preview["summary"]["conflicts"] == 1
    assert preview["summary"]["regexClaims"] == 3
    assert result["summary"]["conflicts"] == 0
    assert result["conflicts"] == []
    assert result["resolvedConflicts"][0]["winnerProfileId"] == "labelled"
    assert [row["sourceSpeakerLabel"] for row in result["acceptedMatches"]] == ["Alice", "Bob"]
    assert reconstruct_partition(result)[1] == pages[0]["text"]


def test_overlap_can_be_resolved_to_narration_without_disabling_either_rule():
    pages = [{"page": 1, "text": "<Alice>Hello</Alice>"}]
    custom = [
        {
            "id": "outer",
            "pattern": r"<(?P<speaker>[^>]+)>(?P<text>.+)</[^>]+>",
        },
        {"id": "inner", "pattern": r"(?P<text>Hello</Alice>)"},
    ]

    result = scan_dialogue(
        pages,
        custom_profiles=custom,
        conflict_resolutions=[
            {"profileIds": ["inner", "outer"], "winnerProfileId": "narration"}
        ],
    )

    assert result["conflicts"] == []
    assert result["resolvedConflicts"][0]["winnerProfileId"] == "narration"
    assert result["acceptedMatches"] == []
    assert result["partition"][0]["renderRole"] == "narration"
    assert reconstruct_partition(result)[1] == pages[0]["text"]


def test_labelled_quote_and_unlabelled_quote_profiles_coalesce_without_false_conflict():
    result = scan_dialogue([{"page": 1, "text": "Alice: “Hello.”"}])

    assert result["summary"]["conflicts"] == 0
    assert len(result["acceptedMatches"]) == 1
    assert result["acceptedMatches"][0]["matchedProfileIds"] == [
        "label-curly-quotes",
        "unlabeled-curly-quotes",
    ]
    assert result["acceptedMatches"][0]["sourceSpeakerLabel"] == "Alice"


def test_nested_straight_quote_inside_explicit_bracket_turn_is_not_a_conflict():
    source = (
        'Subaru: [Declared rules include "Do not defy the guards" and '
        '"Do not flee without permission".]'
    )

    result = scan_dialogue([{"page": 1, "text": source}])

    assert result["summary"]["conflicts"] == 0
    assert len(result["acceptedMatches"]) == 1
    assert result["acceptedMatches"][0]["profileId"] == "label-brackets"
    assert result["acceptedMatches"][0]["sourceSpeakerLabel"] == "Subaru"
    assert result["acceptedMatches"][0]["text"] == source.removeprefix("Subaru: [").removesuffix("]")
    assert reconstruct_partition(result)[1] == source


def test_nested_curly_quote_stays_with_the_explicit_character_turn():
    source = (
        "Mara: [Well? But, I remember Lin said to me, “I’m not "
        "going to talk to you.”]"
    )

    result = scan_dialogue([{"page": 86, "text": source}])

    assert result["summary"]["conflicts"] == 0
    assert result["summary"]["structuralIssues"] == 0
    assert len(result["acceptedMatches"]) == 1
    assert result["acceptedMatches"][0]["profileId"] == "label-brackets"
    assert result["acceptedMatches"][0]["sourceSpeakerLabel"] == "Mara"
    assert "“I’m not going to talk to you.”" in result["acceptedMatches"][0]["text"]
    assert reconstruct_partition(result)[86] == source


def test_unlabelled_straight_quote_does_not_open_on_a_malformed_closing_quote():
    source = (
        'Vey: [--What do we do for those outside to attack us?"]\n'
        "Lin: [Eh...]\n"
        "Vey: [Answer. The conditions are...]\n"
        '"I do not understand it, even if you ask me", he thought.'
    )

    result = scan_dialogue([{"page": 1, "text": source}])
    straight = next(
        row for row in result["profiles"] if row["id"] == "unlabeled-straight-quotes"
    )

    assert straight["matchCount"] == 1
    assert straight["examples"][0]["text"] == "I do not understand it, even if you ask me"
    assert "Subaru" not in straight["examples"][0]["text"]
    assert result["summary"]["conflicts"] == 0


def test_interrupted_labelled_turn_requires_a_source_exact_user_choice():
    source = (
        'Abel: [--What do we do for those outside to attack us?"\n'
        "Subaru: [Eh…]"
    )

    preview = scan_dialogue([{"page": 93, "text": source}])

    assert preview["acceptedMatches"] == []
    assert preview["summary"]["structuralIssues"] == 1
    issue = preview["structuralIssues"][0]
    assert issue["kind"] == "interrupted-turn"
    assert issue["outerSpeakerLabel"] == "Abel"
    assert issue["innerSpeakerLabels"] == ["Subaru"]
    assert [row["sourceSpeakerLabel"] for row in issue["interpretations"]["split"]] == [
        "Abel",
        "Subaru",
    ]
    assert dialogue_progression_blockers(preview) == [
        "Resolve 1 interrupted dialogue turn(s) before acceptance"
    ]
    assert reconstruct_partition(preview)[93] == source

    split = scan_dialogue(
        [{"page": 93, "text": source}],
        structural_resolutions=[{"issueId": issue["id"], "action": "split"}],
    )
    assert split["structuralIssues"] == []
    assert split["resolvedStructuralIssues"][0]["selectedAction"] == "split"
    assert [row["sourceSpeakerLabel"] for row in split["acceptedMatches"]] == [
        "Abel",
        "Subaru",
    ]
    assert reconstruct_partition(split)[93] == source

    kept = scan_dialogue(
        [{"page": 93, "text": source}],
        structural_resolutions=[{"issueId": issue["id"], "action": "keep-together"}],
    )
    assert [row["sourceSpeakerLabel"] for row in kept["acceptedMatches"]] == ["Abel"]
    assert reconstruct_partition(kept)[93] == source

    narrated = scan_dialogue(
        [{"page": 93, "text": source}],
        structural_resolutions=[{"issueId": issue["id"], "action": "narration"}],
    )
    assert narrated["acceptedMatches"] == []
    assert narrated["partition"][0]["renderRole"] == "narration"
    assert reconstruct_partition(narrated)[93] == source


def test_labelled_bracket_turn_continues_across_a_page_without_user_guesswork():
    pages = [
        {"page": 1, "text": "Gustav: [A gladiator should use their life for\n"},
        {"page": 2, "text": "the Island's shows, not needless death.]\nNarration."},
    ]

    result = scan_dialogue(pages)

    assert result["summary"]["continuedTurns"] == 1
    assert result["summary"]["structuralIssues"] == 0
    fragments = [row for row in result["acceptedMatches"] if row.get("turnGroupId")]
    assert len(fragments) == 2
    assert {row["sourceSpeakerLabel"] for row in fragments} == {"Gustav"}
    assert {row["fragmentCount"] for row in fragments} == {2}
    assert reconstruct_partition(result) == {
        1: pages[0]["text"],
        2: pages[1]["text"],
    }


def test_unlabelled_straight_turn_crosses_a_page_without_speaking_the_page_number():
    pages = [
        {
            "page": 23,
            "text": (
                '"Well, this is incredible," repeated Hallward, rather bitterly,-\n'
                '"incredible to me. I saw\n\n5'
            ),
        },
        {
            "page": 24,
            "text": 'Dorian Gray for the first time. I grew afraid and left."\n\n6',
        },
    ]

    result = scan_dialogue(pages)

    assert result["summary"]["continuedTurns"] == 1
    straight = next(
        row for row in result["profiles"] if row["id"] == "unlabeled-straight-quotes"
    )
    assert straight["matchCount"] == 2
    continued = next(row for row in straight["examples"] if row.get("sourceFragments"))
    assert [row["blockId"] for row in continued["sourceFragments"]] == [
        "p23-b1",
        "p24-b1",
    ]
    assert "incredible to me" in continued["text"]
    assert "Dorian Gray for the first time" in continued["text"]
    assert "\n5" not in continued["text"]
    page_number = next(row for row in result["partition"] if row["blockId"] == "p23-b2")
    assert page_number["source"].strip() == "5"
    assert page_number["renderRole"] == "narration"
    assert reconstruct_partition(result) == {
        23: pages[0]["text"],
        24: pages[1]["text"],
    }


def test_complete_custom_regex_match_nested_inside_itself_uses_same_review_contract():
    source = "Alice: <First line.\nBob: <Second line.>>"
    custom = [
        {
            "id": "custom-angle-turn",
            "label": "Angle turn",
            "pattern": r"^(?P<speaker>[A-Z][a-z]+): <(?P<text>[\s\S]*?)>",
        }
    ]

    preview = scan_dialogue([{"page": 1, "text": source}], custom_profiles=custom)

    assert preview["summary"]["structuralIssues"] == 1
    issue = preview["structuralIssues"][0]
    assert issue["profileId"] == "custom-angle-turn"
    assert issue["outerSpeakerLabel"] == "Alice"
    assert issue["innerSpeakerLabels"] == ["Bob"]

    split = scan_dialogue(
        [{"page": 1, "text": source}],
        custom_profiles=custom,
        structural_resolutions=[{"issueId": issue["id"], "action": "split"}],
    )
    assert [row["sourceSpeakerLabel"] for row in split["acceptedMatches"]] == [
        "Alice",
        "Bob",
    ]
    assert [row["text"] for row in split["acceptedMatches"]] == [
        "First line.\n",
        "Second line.",
    ]
    assert reconstruct_partition(split)[1] == source


def test_unlabelled_straight_quote_preserves_pdf_line_wrapping():
    source = 'Alice said, "First extracted line,\nsecond extracted line."'

    result = scan_dialogue([{"page": 1, "text": source}])
    straight = next(
        row for row in result["profiles"] if row["id"] == "unlabeled-straight-quotes"
    )

    assert straight["matchCount"] == 1
    assert straight["examples"][0]["text"] == (
        "First extracted line,\nsecond extracted line."
    )


def test_unlabelled_straight_quote_can_follow_an_ascii_dialogue_dash():
    source = '--"Do not disobey this order."'

    result = scan_dialogue([{"page": 1, "text": source}])
    straight = next(
        row for row in result["profiles"] if row["id"] == "unlabeled-straight-quotes"
    )

    assert straight["matchCount"] == 1
    assert straight["examples"][0]["text"] == "Do not disobey this order."


def test_mixed_paragraph_is_split_for_explicit_dialogue_but_intact_for_narrator_fallback():
    source = "Alice opened the door. “Come inside,” the voice said. She hesitated."
    pages = [{"page": 1, "text": source}]

    normal = scan_dialogue(pages)
    fallback = scan_dialogue(pages, narrator_intact_paragraphs=True)

    assert [row["renderRole"] for row in normal["partition"]] == [
        "narration",
        "dialogue",
        "narration",
    ]
    assert len(fallback["partition"]) == 1
    assert fallback["partition"][0]["renderRole"] == "narration"
    assert fallback["partition"][0]["text"] == source
    assert reconstruct_partition(normal)[1] == source
    assert reconstruct_partition(fallback)[1] == source


def test_multiline_prose_quotation_is_one_source_anchored_candidate():
    source = "Alice waited. “First line,\nsecond line,” said the Footman."

    result = scan_dialogue([{"page": 1, "text": source}])

    dialogue = next(row for row in result["partition"] if row["renderRole"] == "dialogue")
    assert dialogue["text"] == "First line,\nsecond line,"
    assert dialogue["source"] == "“First line,\nsecond line,”"
    assert reconstruct_partition(result)[1] == source


def test_every_source_interval_appears_once_in_partition():
    pages = [
        {"page": 1, "text": "Before.\n\nSubaru: [Run!]\n\nAfter."},
        {"page": 2, "text": ""},
    ]

    result = scan_dialogue(pages)

    assert reconstruct_partition(result) == {1: pages[0]["text"], 2: ""}
    for block in result["blocks"]:
        spans = [row for row in result["partition"] if row["blockId"] == block["id"]]
        assert spans[0]["sourceStart"] == 0
        assert spans[-1]["sourceEnd"] == len(block["text"])
        assert all(
            left["sourceEnd"] == right["sourceStart"] for left, right in zip(spans, spans[1:])
        )


def test_stable_visible_span_ids_are_derived_from_source_boundaries():
    pages = [{"page": 9, "text": "Subaru: [Run!]"}]

    first = scan_dialogue(pages)
    second = scan_dialogue(pages)

    assert first["acceptedMatches"][0]["spanId"] == "span:p9-b1:9-13"
    assert first["acceptedMatches"][0]["spanId"] == second["acceptedMatches"][0]["spanId"]
