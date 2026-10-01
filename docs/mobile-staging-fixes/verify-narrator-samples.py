"""Compare empty AI scope with explicit Narrator routing on the public sample set.

Run with the repository Python environment; this invokes no model or provider.
"""
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from meowdiobooks.backend.documents import extract_full_document
from meowdiobooks.backend.dialogue import reconstruct_partition, scan_dialogue
from meowdiobooks.backend.dialogue_ai import resolve_dialogue


def no_provider(*_args):
    raise AssertionError("An empty scope must never invoke an AI provider")


results = []
for source in sorted((ROOT / "SampleBooks/public-domain-evaluation").glob("*.pdf")):
    with TemporaryDirectory(prefix="meow-mobile-sample-") as cache:
        pages = extract_full_document(source, Path(cache), "native")
        scan = scan_dialogue(pages)
        before = resolve_dialogue(scan, "fill-gaps", no_provider, [])
        after = resolve_dialogue(scan, "narrate", no_provider, [])
        original = {page["page"]: page["text"] for page in pages}
        assert reconstruct_partition(before) == original
        assert reconstruct_partition(after) == original

        def audible_spans(result):
            return [
                (span["id"], span.get("renderRole"), span.get("spokenText"),
                 span.get("sourceSpeakerLabel"), span.get("fallback"))
                for span in result["partition"]
            ]

        assert audible_spans(before) == audible_spans(after)
        explicit = [span for span in scan["partition"] if span.get("speakerStatus") == "explicit"]
        assert all(span in after["partition"] for span in explicit)
        results.append({
            "sample": source.name,
            "pdfSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "pages": len(pages),
            "sourceCharacters": sum(len(page["text"]) for page in pages),
            "dialogueSpans": sum(span.get("renderRole") == "dialogue" for span in scan["partition"]),
            "explicitSpansPreserved": len(explicit),
            "beforeStrategy": "fill-gaps with empty scope",
            "afterStrategy": "narrate with empty scope",
            "sourceReconstructionEqual": True,
            "audibleSpansEqual": True,
            "providerCalls": 0,
        })

output = ROOT / "docs/mobile-staging-fixes/evidence/narrator-sample-comparison.json"
output.write_text(json.dumps(results, indent=2) + "\n")
print(json.dumps(results, indent=2))
