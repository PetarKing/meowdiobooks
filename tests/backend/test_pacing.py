"""Synthetic source/routing and measured audio evidence for the shared pacing recipe."""

from types import SimpleNamespace

import numpy as np
import pytest
from scipy.io import wavfile

from meowdiobooks.backend.dialogue import scan_dialogue
from meowdiobooks.backend.pacing import (
    apply_edge_fades,
    boundary_before_seconds,
    prepare_speech_audio,
    timing_policy,
)
from meowdiobooks.backend.recording_script import build_recording_script
from meowdiobooks.backend.render_plan import compile_render_plan
from meowdiobooks.backend.tts_v2 import _assemble_chapter_wav, render_plan_audio


def _voice():
    return {"characterId": "narrator", "name": "Narrator", "voiceAccepted": True,
            "voiceRevision": "voice-1", "referenceAudio": "reference.wav",
            "referenceText": "Reference speech."}


def _plan(pages, *, heading=None, transform=None):
    scan = scan_dialogue(pages)
    dialogue = {**scan, "revision": "dialogue-1", "spans": scan["partition"]}
    if transform:
        transform(dialogue)
    cast = {"revision": "cast-1", "identities": [], "labelToCharacterId": {}, "narrator": _voice()}
    review = {"revision": "review-1", "chapters": [heading] if heading else []}
    script = build_recording_script(dialogue, review, cast, revision="script-1")
    return compile_render_plan(dialogue, cast, script, ["chapter-1"])


def _segments(plan):
    return plan["chapters"][0]["segments"]


@pytest.mark.parametrize("blank", ["\n\n", "\n\n\n\n", "\r\n \r\n\t\r\n"])
def test_confirmed_heading_subtitle_and_paragraph_have_one_boundary_each(blank):
    title = "Chapter One"
    source = f"{title}\nA Quiet Beginning{blank}First line wraps\nwithout a break.{blank}Next paragraph."
    plan = _plan([{"page": 1, "text": source}], heading={
        "id": "chapter-1", "title": title, "boundaryId": f"boundary:p1-b1:0-{len(title)}",
    })
    segments = _segments(plan)
    assert [row["boundaryBefore"] for row in segments] == [
        {"kind": "start", "seconds": 0.0},
        {"kind": "chapter-heading", "seconds": 1.2},
        {"kind": "paragraph", "seconds": 0.55},
    ]
    assert "A Quiet Beginning" in segments[0]["text"]
    assert "First line wraps\nwithout a break." in segments[1]["text"]
    assert "".join(row["text"] for row in segments) == source
    assert plan["timing"] == timing_policy()


def test_unconfirmed_short_body_prose_does_not_create_heading_pause():
    plan = _plan([{"page": 1, "text": "A quiet thought\n\nBody paragraph."}])
    assert [row["boundaryBefore"]["kind"] for row in _segments(plan)] == ["start", "paragraph"]


def test_block_or_page_boundary_alone_is_not_a_paragraph():
    plan = _plan([
        {"id": "left", "page": 1, "text": "She closed her "},
        {"id": "middle", "page": 1, "text": "eyes and "},
        {"id": "right", "page": 2, "text": "waited."},
    ])
    assert len(_segments(plan)) == 1
    assert _segments(plan)[0]["text"] == "She closed her eyes and waited."


def test_inline_quote_attribution_keeps_turn_gap_and_next_paragraph_gets_one_longer_gap():
    plan = _plan([{"page": 1, "text": '"Hello," she said.\n\n"Goodbye," he replied.'}])
    segments = _segments(plan)
    assert [row["boundaryBefore"]["seconds"] for row in segments] == [0, .24, .55, .24]
    assert [row["renderRole"] for row in segments] == ["dialogue", "narration", "dialogue", "narration"]
    assert segments[1]["text"].strip() == "she said."


def test_heading_and_blank_separator_split_across_source_fragments_are_preserved():
    def fragment(dialogue):
        span = dialogue["spans"][0]
        text = span["source"]
        cuts = [0, 5, len(text) - 1, len(text)]
        dialogue["spans"] = [
            {**span, "id": f"part-{i}", "sourceStart": left, "sourceEnd": right,
             "spokenStart": left, "spokenEnd": right, "source": text[left:right], "text": text[left:right]}
            for i, (left, right) in enumerate(zip(cuts, cuts[1:]))
        ] + dialogue["spans"][1:]
    plan = _plan([{"page": 1, "text": "Chapter One\n\nBody."}], heading={
        "id": "chapter-1", "title": "Chapter One", "boundaryId": "boundary:p1-b1:0-11",
    }, transform=fragment)
    assert [row["boundaryBefore"]["seconds"] for row in _segments(plan)] == [0, 1.2]
    assert "".join(row["text"] for row in _segments(plan)).split() == "Chapter One Body.".split()


def test_repaired_words_keep_source_paragraphs_without_losing_text():
    plan = _plan([{"id": "b1", "page": 1, "text": "The misprint.\n\nThe next paragraph."}],
                 transform=lambda d: d["spans"][0].update(text="The repair.\n\nThe next paragraph."))
    assert [row["boundaryBefore"]["seconds"] for row in _segments(plan)] == [0, .55]
    assert "".join(row["text"] for row in _segments(plan)) == "The repair.\n\nThe next paragraph."


@pytest.mark.parametrize("seconds", [-1, float("nan"), float("inf"), True, "0.5"])
def test_boundary_rejects_invalid_durations(seconds):
    with pytest.raises(ValueError):
        boundary_before_seconds({"boundaryBefore": {"kind": "paragraph", "seconds": seconds}})


def test_fades_match_approved_cosine_envelope_and_add_no_noise():
    original = np.full(1000, .2, dtype=np.float32)
    result = apply_edge_fades(original, 1000)
    assert np.allclose(result[:15], .2 * np.sin(np.linspace(0, np.pi / 2, 15)) ** 2)
    assert np.allclose(result[-40:], .2 * np.cos(np.linspace(0, np.pi / 2, 40)) ** 2)
    assert np.array_equal(result[15:-40], original[15:-40])
    assert np.array_equal(original, np.full(1000, .2, dtype=np.float32))
    assert not apply_edge_fades(np.zeros(1000, dtype=np.float32), 1000).any()
    assert result[0] == result[-1] == 0


@pytest.mark.parametrize("length", [0, 1, 2, 5, 20])
def test_short_fades_preserve_length_and_center_without_overlap(length):
    source = np.ones(length, dtype=np.float32)
    faded = apply_edge_fades(source, 24_000)
    assert len(faded) == length
    assert np.all((faded >= 0) & (faded <= source))
    if length % 2:
        assert faded[length // 2] == 1


def test_preparation_retains_supra_threshold_tail_and_interior_quiet():
    source = np.concatenate([np.zeros(100), np.ones(100) * .2, np.zeros(400),
                             np.ones(20) * .001, np.zeros(100)]).astype(np.float32)
    prepared, lead, tail = prepare_speech_audio(source, 1000, timing_policy())
    assert len(prepared) == 540  # 100 speech + 400 interior quiet + 20 burst + two 10ms margins
    assert not prepared[110:510].any()
    assert prepared[-20:-10].any()  # quiet but supra-threshold burst is retained
    assert lead >= .01 and tail >= .01
    with pytest.raises(ValueError, match="no samples"):
        prepare_speech_audio(np.zeros(200, dtype=np.float32), 1000, timing_policy())


def test_actual_boundary_quiet_matches_requested_target_and_has_no_noise(tmp_path):
    sample_rate = 1000
    source = np.concatenate([np.zeros(250), np.full(200, .2), np.zeros(300)]).astype(np.float32)
    audio, lead, tail = prepare_speech_audio(source, sample_rate, timing_policy())
    paths = [tmp_path / "first.wav", tmp_path / "second.wav"]
    for path in paths:
        wavfile.write(path, sample_rate, audio)
    for target in (.24, .55, 1.2):
        output = tmp_path / "chapter.wav"
        inserted = max(0, target - tail - lead)
        count = _assemble_chapter_wav(output, paths, sample_rate, boundary_gaps=[inserted])
        _, result = wavfile.read(output)
        active = np.flatnonzero(np.abs(result) > 16 / 32768)
        first_tail = active[active < len(audio)][-1]
        next_lead = active[active >= len(audio)][0]
        assert abs((next_lead - first_tail - 1) / sample_rate - target) <= 1 / sample_rate
        assert count == 2 * len(audio) + round(inserted * sample_rate)
        assert not result[len(audio):len(audio) + round(inserted * sample_rate)].any()


def test_renderer_folds_terminal_ellipsis_into_paragraph_gap_and_keeps_legacy_audio(tmp_path, monkeypatch):
    import meowdiobooks.backend.tts_v2 as tts
    sample_rate = 1000
    class Model:
        def __init__(self):
            self.sample_rate = sample_rate
        def generate(self, *_args, **_kwargs):
            yield SimpleNamespace(audio=np.concatenate([
                np.zeros(100), np.full(200, .2), np.zeros(100),
            ]))
    monkeypatch.setattr(tts, "_load_model", lambda *_: (Model(), lambda: None))
    package = tmp_path / "package"
    package.mkdir()
    (package / "reference.wav").write_bytes(b"accepted-reference")
    plan = _plan([{"page": 1, "text": "Wait...\n\nNext paragraph."}])
    result = render_plan_audio(tmp_path, package, "book", plan, "english", lambda *_: None)
    _, rendered = wavfile.read(result[0]["artifactPath"])
    active = np.flatnonzero(np.abs(rendered) > 16 / 32768)
    gaps = np.diff(active)
    assert (max(gaps) - 1) / sample_rate == pytest.approx(.55, abs=.001)
    # A legacy plan retains raw provider padding and its old appended ellipsis.
    legacy = {**plan}
    legacy.pop("timing")
    for row in _segments(legacy):
        row.pop("boundaryBefore")
    old = render_plan_audio(tmp_path, package, "book", legacy, "english", lambda *_: None)
    _, raw = wavfile.read(old[0]["artifactPath"])
    assert len(raw) == 400 + 250 + 240 + 400


def test_opening_standalone_title_run_is_one_timing_group_without_new_chapters():
    source = "    THE PLAY\n\n    SCENE 1\n\n    THE STUDENT ENTERS A VERY LARGE HALL AND LOOKS AROUND FOR HIS FRIENDS.\n\n"
    plan = _plan([{"page": 1, "text": source}])
    segments = _segments(plan)
    assert len(plan["chapters"]) == 1
    assert len(segments) == 2
    assert "THE PLAY" in segments[0]["text"] and "SCENE 1" in segments[0]["text"]
    assert segments[1]["boundaryBefore"] == {"kind": "chapter-heading", "seconds": 1.2}
    # A later standalone uppercase line does not restart the opening-title fallback.
    body = _plan([{"page": 1, "text": "The student arrived.\n\nLATER\n\nHe went home."}])
    assert all(row["boundaryBefore"]["kind"] != "chapter-heading" for row in _segments(body))


def test_source_indent_marks_paragraph_but_consistent_indented_wraps_do_not():
    source = "The journey took ten days.\n Going home was welcome.\nThe same paragraph wraps here.\n Another paragraph begins."
    plan = _plan([{"id": "source-block", "page": 1, "text": source}])
    assert [row["boundaryBefore"]["seconds"] for row in _segments(plan)] == [0, .55, .55]
    assert "".join(row["text"] for row in _segments(plan)) == source
    wrapped = _plan([{"id": "wrapped", "page": 1, "text": "    The first line ends.\n    The equally indented line continues.\n    The last line ends."}])
    assert len(_segments(wrapped)) == 1
    # Arbitrary line wraps without indentation, even at sentence endings, stay intact.
    plain = _plan([{"page": 1, "text": "One sentence.\nAnother sentence.\nAnd another."}])
    assert len(_segments(plain)) == 1


def test_omitted_separator_between_dense_dialogue_carries_one_paragraph_boundary():
    plan = _plan([{"page": 1, "text": '"First turn."\n\n\n"Second turn."\n\n"Third turn."'}])
    speakable = [row for row in _segments(plan) if any(c.isalnum() for c in row["text"])]
    assert [row["boundaryBefore"]["seconds"] for row in speakable] == [0, .55, .55]


def test_source_pacing_rejects_noncontiguous_ranges_in_direct_use():
    from meowdiobooks.backend.source_pacing import source_boundaries
    with pytest.raises(ValueError, match="contiguous"):
        source_boundaries([{"id": "a", "blockId": "b", "sourceStart": 1,
                            "sourceEnd": 5, "source": "word"}], {})


def test_multiple_confirmed_headings_in_one_source_block_keep_both_heading_gaps():
    from meowdiobooks.backend.source_pacing import source_boundaries
    text = "Chapter One\n\nFirst body.\n\nChapter Two\n\nSecond body."
    second = text.index("Chapter Two")
    spans = [{"id": "first", "blockId": "block", "sourceStart": 0,
              "sourceEnd": second, "source": text[:second], "chapterId": "first"},
             {"id": "second", "blockId": "block", "sourceStart": second,
              "sourceEnd": len(text), "source": text[second:], "chapterId": "second"}]
    cuts = source_boundaries(spans, {"chapters": [
        {"title": "Chapter One", "boundaryId": "boundary:block:0-11"},
        {"title": "Chapter Two", "boundaryId": f"boundary:block:{second}-{second + 11}"},
    ]})
    assert (13, "chapter-heading") in cuts["first"]
    assert (13, "chapter-heading") in cuts["second"]
