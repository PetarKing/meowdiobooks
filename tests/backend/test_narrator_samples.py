"""Public-domain source checks with synthetic voice metadata and no model calls."""

from pathlib import Path

import pytest
from pypdf import PdfReader

from meowdiobooks.backend.cast_runtime import cast_voice_targets
from meowdiobooks.backend.dialogue import scan_dialogue
from meowdiobooks.backend.documents import extract_pdf_page
from meowdiobooks.backend.recording_script import build_recording_script
from meowdiobooks.backend.render_plan import compile_render_plan
from meowdiobooks.backend.review import apply_review_render_policies


def _voice(character_id):
    return {
        "characterId": character_id, "name": character_id,
        "category": "narrator" if character_id == "narrator" else "character",
        "voiceAccepted": True, "acceptedVoiceRevision": f"synthetic-{character_id}",
        "referenceAudio": f"synthetic/{character_id}.wav", "referenceText": "Reference.",
    }


@pytest.mark.parametrize("sample", [
    "01-alice-explicit-dialogue.pdf",
    "02-pride-inferred-multispeaker.pdf",
    "03-ah-q-traditional-chinese-dialogue.pdf",
])
def test_reviewed_public_domain_dialogue_needs_no_unused_narrator(tmp_path, sample):
    source = Path(__file__).resolve().parents[2] / "SampleBooks/public-domain-evaluation" / sample
    pages = [
        extract_pdf_page(source, tmp_path, page, "native")
        for page in range(1, len(PdfReader(source).pages) + 1)
    ]
    spans = scan_dialogue(pages)["partition"]
    # Deliberate manual attribution isolates casting from model inference quality.
    occurrences = []
    for span in spans:
        if span["renderRole"] == "dialogue":
            span.update(sourceSpeakerLabel="Reader", resolvedSpeakerLabel="Reader", speakerStatus="user")
        else:
            occurrences.append({
                "id": f"omit:{span['id']}", "blockId": span["blockId"],
                "sourceStart": span["sourceStart"], "sourceEnd": span["sourceEnd"],
            })
    dialogue = {"revision": "dialogue-sample", "spans": spans}
    review = {
        "revision": "review-sample", "dialogueRevision": dialogue["revision"],
        "warningSnapshot": [{"occurrences": occurrences}],
        "decisions": [{"occurrenceId": row["id"], "action": "exclude"} for row in occurrences],
    }
    finalized = {"identities": [_voice("reader")], "labelToCharacterId": {"Reader": "reader"}}
    assert any(row["characterId"] == "narrator" for row in cast_voice_targets(finalized, {}, dialogue, {}))
    assert [row["characterId"] for row in cast_voice_targets(finalized, {}, dialogue, review)] == ["reader"]

    rendered = apply_review_render_policies(dialogue, review)
    cast = {**finalized, "revision": "cast-sample", "narrator": None}
    script = build_recording_script(rendered, review, cast, revision="script-sample")
    plan = compile_render_plan(rendered, cast, script, ["chapter-1"])
    assert plan == compile_render_plan(rendered, {**cast, "narrator": _voice("narrator")}, script, ["chapter-1"])
    segments = plan["chapters"][0]["segments"]
    spoken = [row for row in spans if row["renderRole"] == "dialogue"]
    assert spoken and len(segments) == len(spoken)
    assert [row["text"] for row in segments] == [row["text"] for row in spoken]
    assert all(row["effectiveCharacterId"] == "reader" for row in segments)
    assert script["sourceCoverage"]["sourceSpanIds"] == [row["id"] for row in rendered["spans"]]
    assert plan["summary"]["omissions"] == len(occurrences)
