"""Provider-free release sample probe; no model or external request is made."""

import argparse
import hashlib
import json
import time
from pathlib import Path

from meowdiobooks.backend.chapters import detect_chapter_candidates
from meowdiobooks.backend.dialogue import (
    pages_to_dialogue_blocks,
    scan_dialogue,
    validate_dialogue_partition,
)
from meowdiobooks.backend.dialogue_ai import resolve_dialogue
from meowdiobooks.backend.documents import extract_full_document, inspect_source
from meowdiobooks.backend.review import build_review_workspace


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    results = []
    for source in sorted(args.samples.glob("*.pdf")):
        for method in ("native", "layout", "liteparse"):
            started = time.perf_counter()
            _, page_count = inspect_source(source)
            pages = extract_full_document(source, args.state / source.stem / method, method)
            assert len(pages) == page_count
            assert all(str(page["text"]).strip() for page in pages)
            blocks = pages_to_dialogue_blocks(pages)
            for page in pages:
                assert "".join(b["text"] for b in blocks if b["page"] == page["page"]) == page["text"]
            scan = scan_dialogue(blocks)
            dialogue = resolve_dialogue(scan, "narrate", lambda *_: "")
            validate_dialogue_partition(dialogue)
            extraction = {"revision": "sample-extraction", "blocks": blocks, "pages": pages}
            dialogue.update(revision="sample-dialogue", extractionRevision="sample-extraction")
            review = build_review_workspace(extraction, dialogue)
            assert review["sourceReconstruction"]["status"] == "exact"
            assert review["recovery"] is None
            text = "\n".join(page["text"] for page in pages)
            result = {
                "sample": source.name,
                "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "method": method,
                "pages": page_count,
                "characters": len(text),
                "textSha256": hashlib.sha256(text.encode()).hexdigest(),
                "blocks": len(blocks),
                "scanSummary": scan.get("summary"),
                "dialogueSummary": dialogue.get("resultSummary"),
                "reviewSummary": review["summary"],
                "sourceReconstruction": review["sourceReconstruction"],
                "boundaries": detect_chapter_candidates(blocks),
                "warnings": [warning["kind"] for warning in review["warnings"]],
                "elapsedSeconds": round(time.perf_counter() - started, 3),
            }
            results.append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
    args.output.write_text(json.dumps({"revision": args.revision, "results": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
