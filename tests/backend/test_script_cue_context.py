"""Independent regressions for complete model context around omission candidates."""
import pytest

from meowdiobooks.backend.dialogue import scan_dialogue
from meowdiobooks.backend.script_cues import MAX_CONTEXT_CHARACTERS, script_cue_candidates


def candidates_for(text):
    extraction = {"blocks": [{"id": "b", "page": 1, "text": text}]}
    dialogue = scan_dialogue(extraction["blocks"])
    dialogue["spans"] = dialogue["partition"]
    return script_cue_candidates(extraction, dialogue)


@pytest.mark.parametrize("cue", ["[whispering]", "(whispering)"])
def test_default_scan_supplies_literal_suffix_after_long_source_whitespace(cue):
    # A layout gap must not hide the phrase that makes the cue literal spoken words.
    suffix = " " * 220 + "is the password, exactly as written."
    text = "ALICE: " + cue + suffix
    rows = candidates_for(text)
    assert len(rows) == 1
    row = rows[0]
    assert row["contextAfter"] == suffix
    assert text[row["sourceStart"]:row["sourceEnd"]] == cue
    assert row["contextBefore"] == "ALICE: "


@pytest.mark.parametrize("cue", ["[whispering]", "(whispering)"])
def test_oversized_raw_turn_is_preserved_instead_of_classified_without_its_suffix(cue):
    text = "ALICE: " + cue + " " * MAX_CONTEXT_CHARACTERS + "is the password."
    assert candidates_for(text) == []
