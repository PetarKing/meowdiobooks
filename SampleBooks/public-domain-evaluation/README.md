# Public-domain evaluation set

These three short PDFs are intended for repeatable Meowdiobooks release checks. Each passage is
approximately five minutes of finished speech. Run the same accepted source through the fully local
dialogue route and the optional remote dialogue route; do not change upstream extraction or review
decisions between comparison runs.

| PDF | Intended challenge | Primary comparison |
|---|---|---|
| `01-alice-explicit-dialogue.pdf` | Mostly explicit Alice/Caterpillar attribution, plus an embedded recitation | Easy English baseline |
| `02-pride-inferred-multispeaker.pdf` | Rapid exchanges among Darcy, Caroline Bingley, Charles Bingley, and Elizabeth; several turns lack nearby names | Harder English inference |
| `03-ah-q-traditional-chinese-dialogue.pdf` | Traditional Chinese punctuation, narration, inner speech, and changing interlocutors | Chinese extraction and attribution smoke test |

## Sources and rights

- *Alice's Adventures in Wonderland*, Lewis Carroll, Project Gutenberg ebook 11:
  <https://www.gutenberg.org/ebooks/11>
- *Pride and Prejudice*, Jane Austen, Project Gutenberg ebook 1342:
  <https://www.gutenberg.org/ebooks/1342>
- *阿Ｑ正傳*, 魯迅, Project Gutenberg ebook 25332:
  <https://www.gutenberg.org/ebooks/25332>

Project Gutenberg marks each source text as public domain in the United States. Carroll died in
1898, Austen in 1817, and Lu Xun in 1936, so the underlying works have also passed a life-plus-70
copyright term. Copyright status can still vary by jurisdiction and edition; verify it for the
jurisdiction where evaluation artifacts will be published.

These PDFs contain newly typeset excerpts, not Project Gutenberg branding or illustrations.

## Evaluation grid

For each PDF, retain a five-minute excerpt from the same chapter and record:

| Route | Correct spoken-dialogue classification | Correct speaker | False characters | Unresolved turns | Manual corrections | Listening defects |
|---|---:|---:|---:|---:|---:|---:|
| Fully local |  |  |  |  |  |  |
| Optional remote dialogue |  |  |  |  |  |  |

Also record the Meowdiobooks revision, model identifiers, processing time, peak memory if available,
and exact accepted Review/Cast revisions. Compare like for like; voice quality is not part of the
local-versus-remote dialogue score.
