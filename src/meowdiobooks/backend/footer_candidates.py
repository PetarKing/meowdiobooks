"""Physical-page footer templates are candidates, never permission to omit text."""
from __future__ import annotations

import re
from collections import defaultdict

_URL = re.compile(r"(?:https?://|www\.)[^\s]+", re.IGNORECASE)
_FOLIO = re.compile(r"(?<!\d)\d{1,4}(?!\d)")


def _template(source):
    if len(source) > 180 or len(source.split()) > 18:
        return None
    urls = list(_URL.finditer(source))
    numbers = [m for m in _FOLIO.finditer(source)
               if not any(u.start() <= m.start() < u.end() for u in urls)]
    if len(numbers) != 1:
        return None
    number = numbers[0]
    # URL punctuation/digits are literal family evidence, not changing folios.
    label = source[:number.start()] + source[number.end():]
    plain = _URL.sub("", label)
    if ((not urls and sum(c.isalpha() for c in plain) < 3)
            or any(not (c.isalpha() or c.isspace() or c in "-–—&|") for c in plain)):
        return None
    key = " ".join((source[:number.start()] + " {folio} " + source[number.end():]).split())
    # Retain the existing case-insensitive label families, but URL paths remain
    # exact: /Volume7 and /volume7 can refer to different resources.
    parts, cursor = [], 0
    for url in _URL.finditer(key):
        parts.extend((key[cursor:url.start()].casefold(), url.group()))
        cursor = url.end()
    parts.append(key[cursor:].casefold())
    return "".join(parts), int(number.group()), bool(urls)


def physical_footer_templates(blocks):
    """Find repeated compact page tails, including label/folio/link permutations.

    Only one maximal decimal run outside URLs may change. Two-line targets stay
    within one block and must repeat as a complete template. A varying preceding
    prose line cannot become part of the family. Edits never span source blocks.
    """
    pages = defaultdict(list)
    for block in blocks:
        pages[int(block["page"])].extend(
            (block, m) for m in re.finditer(r"[^\n]+", str(block["text"])) if m.group().strip())
    families = defaultdict(list)
    for page, lines in pages.items():
        if not lines:
            continue
        block, last = lines[-1]
        text = str(block["text"])
        variants = [(last.start(), last.end())]
        if len(lines) > 1:
            previous_block, previous = lines[-2]
            prefix = previous.group().strip()
            if previous_block is block and len(prefix) <= 80 and len(prefix.split()) <= 8:
                variants.append((previous.start(), last.end()))
        for start, end in variants:
            template = _template(text[start:end])
            if template is None:
                continue
            key, number, has_url = template
            families[(key, number - page)].append({
                "block": block, "start": start, "end": end, "hasUrl": has_url,
                "lineCount": text[start:end].count("\n") + 1,
            })
    # Prefer a complete repeated two-line footer to its numbered last line. A
    # preceding story line that varies cannot hide a valid shorter footer.
    repeated = [(key, offset, rows) for (key, offset), rows in families.items()
                if len({int(r["block"]["page"]) for r in rows}) >= 3]
    longest = {}
    for _, _, rows in repeated:
        for row in rows:
            page = int(row["block"]["page"])
            longest[page] = max(longest.get(page, 0), row["end"] - row["start"])
    result = []
    for key, offset, rows in repeated:
        rows = [r for r in rows if r["end"] - r["start"] == longest[int(r["block"]["page"])]]
        if len(rows) >= 3:
            result.append((key, offset, rows))
    return result
