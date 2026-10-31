"""Generate the repository-owned README demo with the pinned local voice models."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from meowdiobooks.backend.audio import generate_cast_previews
from meowdiobooks.backend.tts_v2 import render_plan_audio


CAST = [
    {
        "id": "narrator",
        "name": "Narrator",
        "previewLine": "Rain worried the observatory windows.",
        "voiceDirection": "An intimate, restrained audiobook narrator; atmospheric, natural, clear.",
    },
    {
        "id": "lin",
        "name": "Lin",
        "previewLine": "Mara, tell me this is the key to the west stair.",
        "voiceDirection": "An alert adult voice with dry wit; quick under pressure, natural delivery.",
    },
    {
        "id": "mara",
        "name": "Mara Vey",
        "previewLine": "It was, before someone folded the building.",
        "voiceDirection": "A precise, low adult voice; composed, thoughtful, quietly authoritative.",
    },
]

LINES = [
    ("narrator", "Rain worried the observatory windows. Lin held the brass key to the emergency lamp."),
    ("lin", "Mara, tell me this is the key to the west stair."),
    ("mara", "It was, before someone folded the building."),
    ("narrator", "On its bow, an inscription read: Do not open after midnight."),
    ("lin", "That is an oddly specific thing not to mention."),
    ("mara", "You saw it."),
    ("narrator", "And now it has seen you."),
    ("lin", "Who said that?"),
    ("mara", "Not me. The room has been borrowing voices all evening."),
    ("joint", "Together, then."),
    ("narrator", "The key turned. Somewhere below them, an audience applauded."),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("docs/demo/meowdiobooks-demo.wav"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    package = root / "tmp" / "readme-demo"
    shutil.rmtree(package, ignore_errors=True)
    package.mkdir(parents=True)

    def report(progress: float, message: str | None) -> None:
        print(f"{progress:5.1f}% {message or ''}", flush=True)

    cast = generate_cast_previews(root, package, "readme-demo", CAST, report, "english")
    accepted = {}
    for character in cast:
        candidate = character["voiceCandidates"][-1]
        accepted[character["id"]] = {
            "effectiveCharacterId": character["id"],
            "effectiveSpeaker": character["name"],
            "voiceRevision": candidate["revision"],
            "referenceAudio": f"voices/{character['id']}/{candidate['revision']}.wav",
            "referenceText": candidate["referenceText"],
        }

    segments = []
    for index, (speaker, text) in enumerate(LINES, 1):
        speakers = ["lin", "mara"] if speaker == "joint" else [speaker]
        for member_index, member in enumerate(speakers):
            segments.append(
                {
                    "id": f"demo-{index}-{member_index}",
                    "sourceSpanIds": [f"demo-source-{index}"],
                    "text": text,
                    "delivery": {"mode": "joint", "groupId": f"joint-{index}"}
                    if speaker == "joint"
                    else {"mode": "sequential"},
                    **accepted[member],
                }
            )
    plan = {
        "contract": "meowdiobooks.render-plan.v2",
        "inputRevisions": {"demo": "the-last-door-v1"},
        "chapters": [{"chapterId": "the-last-door", "segments": segments, "omissions": []}],
    }
    [result] = render_plan_audio(root, package, "readme-demo", plan, "english", report)
    output = args.output if args.output.is_absolute() else root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(result["artifactPath"], output)
    print(f"Published {result['audioSeconds']:.2f}s demo to {output}")


if __name__ == "__main__":
    main()
