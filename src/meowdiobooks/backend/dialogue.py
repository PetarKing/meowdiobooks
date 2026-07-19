"""Pure contracts for deterministic dialogue discovery and AI result validation.

The module deliberately has no model, storage, or web dependencies.  It turns an
accepted extraction into source-anchored candidates and an exact narration/dialogue
partition.  Later phases may enrich or reconcile identities, but must not reparse the
source.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

DIALOGUE_SCAN_VERSION = 8


class DialogueContractError(ValueError):
    """Raised when a regex or attribution result cannot be published safely."""


@dataclass(frozen=True)
class RegexProfile:
    """An ordered source matcher with a required ``text`` capture."""

    id: str
    label: str
    pattern: str
    priority: int
    enabled: bool = True
    flags: int = re.MULTILINE
    custom: bool = False
    start_pattern: str | None = None
    opener: str | None = None
    closer: str | None = None
    cross_boundary: bool = False


BUILTIN_PROFILES: tuple[RegexProfile, ...] = (
    RegexProfile(
        "label-brackets",
        "Label + square brackets",
        r"^(?P<speaker>[^\n:\[\]]{1,80}?)\s*:\s*\[(?P<text>[\s\S]*?)\]",
        10,
        start_pattern=r"^(?P<speaker>[^\n:\[\]]{1,80}?)\s*:\s*\[",
        opener="[",
        closer="]",
        cross_boundary=True,
    ),
    RegexProfile(
        "label-curly-quotes",
        "Label + curly quotes",
        r"^(?P<speaker>[^\n:“”]{1,80}?)\s*:\s*“(?P<text>[\s\S]*?)”",
        20,
        start_pattern=r"^(?P<speaker>[^\n:“”]{1,80}?)\s*:\s*“",
        opener="“",
        closer="”",
        cross_boundary=True,
    ),
    RegexProfile(
        "label-straight-quotes",
        "Label + straight quotes",
        r'^(?P<speaker>[^\n:"]{1,80}?)\s*:\s*"(?P<text>[\s\S]*?)"',
        21,
        start_pattern=r'^(?P<speaker>[^\n:"]{1,80}?)\s*:\s*"',
        opener='"',
        closer='"',
    ),
    RegexProfile(
        "label-dash",
        "Label + dash",
        r"^(?P<speaker>[^\n,:;\[\]—–]{1,50}?\S)\s+[—–]\s+(?P<text>[^\n]+)",
        30,
    ),
    RegexProfile(
        "label-colon-line",
        "Uppercase label + colon line",
        r"^[ \t]*(?P<speaker>[A-Z][A-Z0-9 .'’\-]{1,50})\s*:\s*"
        r"(?![\[“\"])(?P<text>\S[^\n]*"
        r"(?:\n(?![ \t]*(?:\n|[A-Z][A-Z0-9 .'’\-]{1,50}\s*:))[^\n]+)*)",
        31,
    ),
    RegexProfile(
        "screenplay",
        "Screenplay speaker line",
        r"^(?P<speaker>[A-Z][A-Z0-9 .'’\-]{1,50})\s*\n(?!\s*\n)(?P<text>[^\n]+(?:\n(?!\s*\n|[A-Z][A-Z0-9 .'’\-]{1,50}\s*$)[^\n]+)*)",
        40,
        enabled=False,
    ),
    RegexProfile(
        "unlabeled-curly-quotes",
        "Unlabelled curly quotation",
        r"“(?P<text>[^”]+)”",
        100,
    ),
    RegexProfile(
        "unlabeled-straight-quotes",
        "Unlabelled straight quotation",
        r'(?:^|(?<=[\s(\[{—–\-…]))"(?P<text>[^"]+)"',
        101,
    ),
    RegexProfile(
        "unlabeled-guillemets",
        "Unlabelled guillemet quotation",
        r"«(?P<text>[^»]+)»",
        102,
    ),
    RegexProfile(
        "unlabeled-cjk-quotes",
        "Unlabelled CJK quotation",
        r"[「『](?P<text>[^」』]+)[」』]",
        103,
    ),
)


def pages_to_dialogue_blocks(pages: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Split page text into stable paragraph blocks without losing one source character."""

    blocks: list[dict[str, Any]] = []
    seen_pages: set[int] = set()
    for page_index, page in enumerate(pages, 1):
        page_number = int(page.get("page", page_index))
        if page_number in seen_pages:
            raise DialogueContractError(f"Duplicate extraction page: {page_number}")
        seen_pages.add(page_number)
        source = str(page.get("text", ""))
        if not source:
            blocks.append(
                {
                    "id": f"p{page_number}-b1",
                    "page": page_number,
                    "pageStart": 0,
                    "text": "",
                }
            )
            continue

        # The blank-line separator belongs to its preceding paragraph.  This makes
        # ``''.join(block.text)`` byte-for-byte identical to the accepted page text.
        cursor = 0
        for block_index, match in enumerate(re.finditer(r"[\s\S]+?(?:\n[ \t]*\n|\Z)", source), 1):
            if match.start() != cursor:  # defensive: the pattern must be exhaustive
                raise DialogueContractError(f"Page {page_number} was not partitioned")
            blocks.append(
                {
                    "id": f"p{page_number}-b{block_index}",
                    "page": page_number,
                    "pageStart": match.start(),
                    "text": match.group(0),
                }
            )
            cursor = match.end()
        if cursor != len(source):
            raise DialogueContractError(f"Page {page_number} was not fully partitioned")
    return blocks


def _normalise_blocks(source: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    if source and "page" in source[0] and "id" not in source[0]:
        return pages_to_dialogue_blocks(source)

    blocks: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(source, 1):
        block_id = str(raw.get("id") or f"block-{index}")
        if block_id in seen:
            raise DialogueContractError(f"Duplicate source block ID: {block_id}")
        seen.add(block_id)
        blocks.append(
            {
                "id": block_id,
                "page": int(raw.get("page", index)),
                "pageStart": int(raw.get("pageStart", 0)),
                "text": str(raw.get("text", "")),
            }
        )
    return blocks


def _custom_profile(raw: Mapping[str, Any], order: int) -> RegexProfile:
    profile_id = str(raw.get("id", "")).strip()
    pattern = str(raw.get("pattern", ""))
    if not profile_id:
        raise DialogueContractError("A custom regex needs a stable ID")
    if not pattern:
        raise DialogueContractError(f"Custom regex {profile_id!r} is empty")
    raw_flags = raw.get("flags")
    # ``dotAll`` was accepted by the pure scanner before flags became part of the
    # typed API contract. Keep direct callers compatible while all HTTP/UI traffic
    # uses the explicit ``flags`` field.
    flag_names = (
        str(raw_flags)
        if raw_flags is not None
        else "ms"
        if raw.get("dotAll")
        else "m"
    )
    unsupported = sorted(set(flag_names) - {"m", "s"})
    if unsupported:
        raise DialogueContractError(
            f"Unsupported regex flags for {profile_id!r}: {''.join(unsupported)}"
        )
    flags = 0
    if "m" in flag_names:
        flags |= re.MULTILINE
    if "s" in flag_names:
        flags |= re.DOTALL
    return RegexProfile(
        id=profile_id,
        label=str(raw.get("label") or profile_id),
        pattern=pattern,
        priority=int(raw.get("priority", 1000 + order)),
        enabled=bool(raw.get("enabled", True)),
        flags=flags,
        custom=True,
    )


def _compile(profile: RegexProfile) -> re.Pattern[str]:
    try:
        compiled = re.compile(profile.pattern, profile.flags)
    except re.error as exc:
        raise DialogueContractError(f"Regex {profile.id!r} is invalid: {exc}") from exc
    if "text" not in compiled.groupindex:
        raise DialogueContractError(f"Regex {profile.id!r} requires a named 'text' capture")
    return compiled


def _is_open_speaker(
    speaker: str | None,
    literals: frozenset[str],
    patterns: Sequence[re.Pattern[str]],
) -> bool:
    if speaker is None:
        return False
    normalised = " ".join(speaker.split()).casefold()
    return normalised in literals or any(pattern.fullmatch(speaker.strip()) for pattern in patterns)


def _raw_scan(
    blocks: Sequence[dict[str, Any]],
    profiles: Sequence[RegexProfile],
    open_speaker_literals: Iterable[str],
    open_speaker_patterns: Iterable[str],
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    literals = frozenset(" ".join(value.split()).casefold() for value in open_speaker_literals)
    try:
        open_patterns = tuple(re.compile(value, re.IGNORECASE) for value in open_speaker_patterns)
    except re.error as exc:
        raise DialogueContractError(f"Open-speaker regex is invalid: {exc}") from exc

    by_profile: dict[str, list[dict[str, Any]]] = {profile.id: [] for profile in profiles}
    candidates: list[dict[str, Any]] = []
    for profile in sorted(profiles, key=lambda item: (item.priority, item.id)):
        compiled = _compile(profile)
        for block in blocks:
            source = block["text"]
            for match in compiled.finditer(source):
                text_start, text_end = match.span("text")
                if match.start() == match.end() or text_start == text_end:
                    raise DialogueContractError(
                        f"Regex {profile.id!r} produced an empty match in {block['id']}"
                    )
                speaker = match.groupdict().get("speaker")
                speaker = " ".join(speaker.split()) if speaker is not None else None
                if speaker is not None and not _plausible_builtin_label(profile, speaker):
                    continue
                candidate = {
                    "matchId": f"match:{profile.id}:{block['id']}:{match.start()}-{match.end()}",
                    "spanId": f"span:{block['id']}:{text_start}-{text_end}",
                    "blockId": block["id"],
                    "page": block["page"],
                    "pageStart": block["pageStart"] + match.start(),
                    "pageEnd": block["pageStart"] + match.end(),
                    "sourceStart": match.start(),
                    "sourceEnd": match.end(),
                    "spokenStart": text_start,
                    "spokenEnd": text_end,
                    "source": match.group(0),
                    "text": match.group("text"),
                    "sourceSpeakerLabel": speaker,
                    "speakerStatus": (
                        "unlabelled"
                        if speaker is None
                        else "unresolved"
                        if _is_open_speaker(speaker, literals, open_patterns)
                        else "explicit"
                    ),
                    "profileId": profile.id,
                    "profilePriority": profile.priority,
                    "origin": f"regex:{profile.id}",
                }
                by_profile[profile.id].append(candidate)
                if profile.enabled:
                    candidates.append(candidate)
        cross_boundary = [
            *_cross_boundary_quote_candidates(blocks, profile),
            *_cross_boundary_label_candidates(blocks, profile, literals, open_patterns),
        ]
        by_profile[profile.id].extend(cross_boundary)
        if profile.enabled:
            candidates.extend(cross_boundary)
    return candidates, by_profile


_CROSS_BOUNDARY_QUOTES = {
    "unlabeled-curly-quotes": ("“", "”"),
    "unlabeled-straight-quotes": ('"', '"'),
    "unlabeled-guillemets": ("«", "»"),
    "unlabeled-cjk-quotes": ("「", "」"),
}

_PAGE_NUMBER_BLOCK = re.compile(r"\s*(?:\d{1,4}|[ivxlcdm]{1,10})\s*", re.IGNORECASE)


def _looks_like_straight_quote_opener(source: str, position: int) -> bool:
    if position == 0:
        return True
    previous = source[position - 1]
    return previous.isspace() or previous in "([{—–-…"


def _cross_boundary_opener(source: str, opener: str, closer: str) -> int:
    if opener != closer:
        opener_index = source.rfind(opener)
        if opener_index < 0 or closer in source[opener_index + len(opener) :]:
            return -1
        # A dangling closer from an earlier page must not poison a later quotation.
        # Only a more recent unmatched opener makes this carry ambiguous.
        previous_opener = source.rfind(opener, 0, opener_index)
        previous_closer = source.rfind(closer, 0, opener_index)
        return -1 if previous_opener > previous_closer else opener_index

    # Straight quotes are symmetric. Carry only a final quote that has the same
    # lexical shape as the built-in opening rule; a trailing closing quote is not
    # allowed to start a cross-page turn.
    opener_index = source.rfind(opener)
    if opener_index < 0 or not _looks_like_straight_quote_opener(source, opener_index):
        return -1
    return opener_index


def _is_page_number_edge_block(
    blocks: Sequence[Mapping[str, Any]], index: int
) -> bool:
    block = blocks[index]
    if not _PAGE_NUMBER_BLOCK.fullmatch(str(block.get("text", ""))):
        return False
    page = int(block.get("page", 0))
    return index + 1 == len(blocks) or int(blocks[index + 1].get("page", page)) > page


def _cross_boundary_quote_candidates(
    blocks: Sequence[Mapping[str, Any]], profile: RegexProfile
) -> list[dict[str, Any]]:
    """Represent one quotation crossing block/page boundaries as linked fragments.

    Straight quotes are carried only when the final quote in a block has clear
    opener-shaped context and the next quote is closer-shaped. Page-number-shaped
    edge blocks remain narration between the linked spoken fragments.
    """

    pair = _CROSS_BOUNDARY_QUOTES.get(profile.id)
    if pair is None:
        return []
    opener, closer = pair
    result: list[dict[str, Any]] = []
    consumed_through = -1
    for start_index, block in enumerate(blocks):
        if start_index <= consumed_through:
            continue
        source = str(block["text"])
        opener_index = _cross_boundary_opener(source, opener, closer)
        if opener_index < 0:
            continue
        closing_index = None
        total_characters = len(source) - opener_index
        for end_index in range(start_index + 1, min(len(blocks), start_index + 9)):
            next_source = str(blocks[end_index]["text"])
            total_characters += len(next_source)
            if total_characters > 6_000:
                break
            position = next_source.find(closer)
            if opener == closer and position >= 0 and _looks_like_straight_quote_opener(
                next_source, position
            ):
                break
            if opener != closer and opener in next_source:
                break
            if position >= 0:
                closing_index = (end_index, position)
                break
        if closing_index is None:
            continue
        end_index, closer_index = closing_index
        group_id = (
            f"turn:{profile.id}:{block['id']}:{opener_index}-"
            f"{blocks[end_index]['id']}:{closer_index + len(closer)}"
        )
        fragments = []
        fragment_indices = [
            index
            for index in range(start_index, end_index + 1)
            if index in {start_index, end_index}
            or not _is_page_number_edge_block(blocks, index)
        ]
        for fragment_number, fragment_index in enumerate(fragment_indices, 1):
            fragment_block = blocks[fragment_index]
            fragment_source = str(fragment_block["text"])
            source_start = opener_index if fragment_index == start_index else 0
            source_end = (
                closer_index + len(closer)
                if fragment_index == end_index
                else len(fragment_source)
            )
            spoken_start = source_start + len(opener) if fragment_index == start_index else 0
            spoken_end = closer_index if fragment_index == end_index else len(fragment_source)
            fragments.append(
                {
                    "matchId": (
                        f"match:{profile.id}:{fragment_block['id']}:{source_start}-{source_end}:"
                        f"fragment-{fragment_number}"
                    ),
                    "spanId": f"span:{fragment_block['id']}:{spoken_start}-{spoken_end}",
                    "turnGroupId": group_id,
                    "fragmentIndex": fragment_number,
                    "fragmentCount": len(fragment_indices),
                    "blockId": fragment_block["id"],
                    "page": fragment_block["page"],
                    "pageStart": fragment_block["pageStart"] + source_start,
                    "pageEnd": fragment_block["pageStart"] + source_end,
                    "sourceStart": source_start,
                    "sourceEnd": source_end,
                    "spokenStart": spoken_start,
                    "spokenEnd": spoken_end,
                    "source": fragment_source[source_start:source_end],
                    "text": fragment_source[spoken_start:spoken_end],
                    "sourceSpeakerLabel": None,
                    "speakerStatus": "unlabelled",
                    "profileId": profile.id,
                    "profilePriority": profile.priority,
                    "origin": f"regex:{profile.id}:cross-boundary",
                }
            )
        result.extend(fragments)
        consumed_through = end_index
    return result


def _cross_boundary_label_candidates(
    blocks: Sequence[Mapping[str, Any]],
    profile: RegexProfile,
    open_speaker_literals: frozenset[str],
    open_speaker_patterns: Sequence[re.Pattern[str]],
) -> list[dict[str, Any]]:
    """Link an explicit delimited turn that cleanly continues into a later block.

    This is deliberately limited to profiles with distinct opening and closing
    delimiters.  A second labelled start before the closer is ambiguous and is left
    for structural-issue review instead of being joined here.
    """

    if (
        not profile.cross_boundary
        or not profile.start_pattern
        or not profile.opener
        or not profile.closer
        or profile.opener == profile.closer
    ):
        return []
    start_pattern = re.compile(profile.start_pattern, profile.flags)
    result: list[dict[str, Any]] = []
    consumed_through = -1
    for start_index, block in enumerate(blocks):
        if start_index <= consumed_through:
            continue
        source = str(block["text"])
        starts = list(start_pattern.finditer(source))
        for start_match_index, start_match in enumerate(starts):
            speaker = " ".join(start_match.group("speaker").split())
            if not _plausible_builtin_label(profile, speaker):
                continue
            closer_index = source.find(profile.closer, start_match.end())
            next_start = (
                starts[start_match_index + 1].start()
                if start_match_index + 1 < len(starts)
                else None
            )
            if closer_index >= 0 or next_start is not None:
                continue

            closing: tuple[int, int] | None = None
            total_characters = len(source) - start_match.start()
            ambiguous = False
            for end_index in range(start_index + 1, min(len(blocks), start_index + 9)):
                next_source = str(blocks[end_index]["text"])
                total_characters += len(next_source)
                if total_characters > 6_000:
                    break
                next_closer = next_source.find(profile.closer)
                next_label = start_pattern.search(next_source)
                if next_label is not None and (
                    next_closer < 0 or next_label.start() < next_closer
                ):
                    ambiguous = True
                    break
                if next_closer >= 0:
                    closing = (end_index, next_closer)
                    break
            if ambiguous or closing is None:
                continue

            end_index, closer_index = closing
            group_id = (
                f"turn:{profile.id}:{block['id']}:{start_match.start()}-"
                f"{blocks[end_index]['id']}:{closer_index + len(profile.closer)}"
            )
            speaker_status = (
                "unresolved"
                if _is_open_speaker(
                    speaker, open_speaker_literals, open_speaker_patterns
                )
                else "explicit"
            )
            for fragment_index in range(start_index, end_index + 1):
                fragment_block = blocks[fragment_index]
                fragment_source = str(fragment_block["text"])
                source_start = start_match.start() if fragment_index == start_index else 0
                source_end = (
                    closer_index + len(profile.closer)
                    if fragment_index == end_index
                    else len(fragment_source)
                )
                spoken_start = start_match.end() if fragment_index == start_index else 0
                spoken_end = closer_index if fragment_index == end_index else len(fragment_source)
                result.append(
                    {
                        "matchId": (
                            f"match:{profile.id}:{fragment_block['id']}:"
                            f"{source_start}-{source_end}:fragment-"
                            f"{fragment_index - start_index + 1}"
                        ),
                        "spanId": f"span:{fragment_block['id']}:{spoken_start}-{spoken_end}",
                        "turnGroupId": group_id,
                        "fragmentIndex": fragment_index - start_index + 1,
                        "fragmentCount": end_index - start_index + 1,
                        "blockId": fragment_block["id"],
                        "page": fragment_block["page"],
                        "pageStart": fragment_block["pageStart"] + source_start,
                        "pageEnd": fragment_block["pageStart"] + source_end,
                        "sourceStart": source_start,
                        "sourceEnd": source_end,
                        "spokenStart": spoken_start,
                        "spokenEnd": spoken_end,
                        "source": fragment_source[source_start:source_end],
                        "text": fragment_source[spoken_start:spoken_end],
                        "sourceSpeakerLabel": speaker,
                        "speakerStatus": speaker_status,
                        "profileId": profile.id,
                        "profilePriority": profile.priority,
                        "origin": f"regex:{profile.id}:cross-boundary",
                    }
                )
            consumed_through = end_index
            break
    return result


_STRUCTURAL_ACTIONS = {"split", "keep-together", "narration"}


def _resolve_structural_issues(
    candidates: Sequence[dict[str, Any]],
    profiles: Sequence[RegexProfile],
    blocks: Sequence[Mapping[str, Any]],
    structural_resolutions: Sequence[Mapping[str, Any]],
    open_speaker_literals: Iterable[str],
    open_speaker_patterns: Iterable[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Detect a concrete same-rule match beginning inside an outer match.

    Bundled labelled profiles expose a conservative start grammar, so an
    interrupted inner turn can be found even when it never reaches its own closer.
    Arbitrary custom regexes are opaque: for those we only report a complete inner
    match actually produced by that same compiled regex.  We do not attempt to
    prove theoretical regex-language intersection.
    """

    profile_index = {profile.id: profile for profile in profiles}
    block_index = {str(block["id"]): block for block in blocks}
    resolution_index = {
        str(row.get("issueId", "")): str(row.get("action", ""))
        for row in structural_resolutions
    }
    literals = frozenset(
        " ".join(value.split()).casefold() for value in open_speaker_literals
    )
    try:
        open_patterns = tuple(
            re.compile(value, re.IGNORECASE) for value in open_speaker_patterns
        )
    except re.error as exc:
        raise DialogueContractError(f"Open-speaker regex is invalid: {exc}") from exc

    output: list[dict[str, Any]] = []
    open_issues: list[dict[str, Any]] = []
    resolved_issues: list[dict[str, Any]] = []
    for candidate in candidates:
        profile = profile_index[candidate["profileId"]]
        if candidate.get("turnGroupId"):
            output.append(candidate)
            continue
        block = block_index[str(candidate["blockId"])]
        source = str(block["text"])
        nested_starts = _nested_same_rule_starts(candidate, profile, source)
        if not nested_starts:
            output.append(candidate)
            continue

        issue_id = (
            f"issue:interrupted-turn:{profile.id}:{candidate['blockId']}:"
            f"{candidate['sourceStart']}-{candidate['sourceEnd']}"
        )
        split_candidates = _split_interrupted_candidate(
            candidate, nested_starts, profile, block, literals, open_patterns
        )
        issue = {
            "id": issue_id,
            "kind": "interrupted-turn",
            "profileId": profile.id,
            "blockId": candidate["blockId"],
            "page": candidate["page"],
            "sourceStart": candidate["sourceStart"],
            "sourceEnd": candidate["sourceEnd"],
            "source": candidate["source"],
            "outerSpeakerLabel": candidate["sourceSpeakerLabel"],
            "innerSpeakerLabels": [
                " ".join(match.group("speaker").split())
                if match.groupdict().get("speaker") is not None
                else "unlabelled"
                for match in nested_starts
            ],
            "availableActions": sorted(_STRUCTURAL_ACTIONS),
            "interpretations": {
                "keep-together": [_structural_claim(candidate)],
                "split": [_structural_claim(row) for row in split_candidates],
                "narration": [],
            },
        }
        issue = _match_evidence_with_context([issue], blocks)[0]
        action = resolution_index.get(issue_id, "")
        if action and action not in _STRUCTURAL_ACTIONS:
            raise DialogueContractError(
                f"Unsupported structural issue action {action!r} for {issue_id}"
            )
        if action == "keep-together":
            output.append(candidate)
        elif action == "split":
            output.extend(split_candidates)
        elif action == "narration":
            pass
        if action:
            resolved_issues.append({**issue, "selectedAction": action})
        else:
            open_issues.append(issue)
    return output, open_issues, resolved_issues


def _nested_same_rule_starts(
    candidate: Mapping[str, Any], profile: RegexProfile, source: str
) -> list[re.Match[str]]:
    start = max(int(candidate["sourceStart"]) + 1, int(candidate["spokenStart"]))
    end = int(candidate["sourceEnd"])
    if start >= end:
        return []
    if profile.start_pattern:
        pattern = re.compile(profile.start_pattern, profile.flags)
    elif profile.custom:
        pattern = _compile(profile)
    else:
        return []

    result: list[re.Match[str]] = []
    for match in pattern.finditer(source, start, end):
        speaker = match.groupdict().get("speaker")
        if speaker is not None and not _plausible_builtin_label(
            profile, " ".join(speaker.split())
        ):
            continue
        result.append(match)
        if len(result) == 8:
            break
    return result


def _split_interrupted_candidate(
    candidate: Mapping[str, Any],
    nested_starts: Sequence[re.Match[str]],
    profile: RegexProfile,
    block: Mapping[str, Any],
    open_speaker_literals: frozenset[str],
    open_speaker_patterns: Sequence[re.Pattern[str]],
) -> list[dict[str, Any]]:
    starts = [int(candidate["sourceStart"]), *(match.start() for match in nested_starts)]
    spoken_starts = [
        int(candidate["spokenStart"]),
        *(
            match.end() if profile.start_pattern else match.start("text")
            for match in nested_starts
        ),
    ]
    speakers: list[str | None] = [
        None
        if candidate.get("sourceSpeakerLabel") is None
        else str(candidate["sourceSpeakerLabel"]),
        *(
            " ".join(match.group("speaker").split())
            if match.groupdict().get("speaker") is not None
            else None
            for match in nested_starts
        ),
    ]
    source = str(block["text"])
    result: list[dict[str, Any]] = []
    for index, source_start in enumerate(starts):
        source_end = starts[index + 1] if index + 1 < len(starts) else int(candidate["sourceEnd"])
        spoken_end = (
            starts[index + 1] if index + 1 < len(starts) else int(candidate["spokenEnd"])
        )
        speaker = speakers[index]
        row = dict(candidate)
        row.update(
            {
                "matchId": f"{candidate['matchId']}:split-{index + 1}",
                "spanId": f"span:{candidate['blockId']}:{spoken_starts[index]}-{spoken_end}",
                "pageStart": int(block["pageStart"]) + source_start,
                "pageEnd": int(block["pageStart"]) + source_end,
                "sourceStart": source_start,
                "sourceEnd": source_end,
                "spokenStart": spoken_starts[index],
                "spokenEnd": spoken_end,
                "source": source[source_start:source_end],
                "text": source[spoken_starts[index]:spoken_end],
                "sourceSpeakerLabel": speaker,
                "speakerStatus": (
                    "unlabelled"
                    if speaker is None
                    else "unresolved"
                    if _is_open_speaker(
                        speaker, open_speaker_literals, open_speaker_patterns
                    )
                    else "explicit"
                ),
                "origin": f"regex:{profile.id}:user-split",
            }
        )
        result.append(row)
    return result


def _structural_claim(candidate: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "matchId": candidate["matchId"],
        "profileId": candidate["profileId"],
        "page": candidate["page"],
        "source": candidate["source"],
        "text": candidate["text"],
        "sourceSpeakerLabel": candidate["sourceSpeakerLabel"],
    }


def _plausible_builtin_label(profile: RegexProfile, speaker: str) -> bool:
    """Keep bundled label recipes conservative; custom recipes remain user-owned."""
    if profile.custom:
        return True
    value = normalize = " ".join(speaker.split())
    if not normalize or len(normalize) > 80 or any(mark in value for mark in "[]{}():,;"):
        return False
    if set(value) <= {"?", "!", ".", "-", "_"}:
        return "?" in value
    connectors = {"and", "of", "the", "de", "del", "van", "von", "&"}
    words = re.findall(r"[^\W\d_]+(?:[-'’][^\W\d_]+)*|&", value, re.UNICODE)
    if not words or len(words) > 8:
        return False
    for word in words:
        if word.casefold() in connectors:
            continue
        cased = [character for character in word if character.lower() != character.upper()]
        if cased and not cased[0].isupper():
            return False
    return True


def _coalesce(candidates: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse a quote-only match under an otherwise identical labelled match."""

    grouped: dict[tuple[str, int, int], list[dict[str, Any]]] = {}
    for candidate in candidates:
        key = (candidate["blockId"], candidate["spokenStart"], candidate["spokenEnd"])
        grouped.setdefault(key, []).append(candidate)

    result: list[dict[str, Any]] = []
    for group in grouped.values():
        labels = {
            item["sourceSpeakerLabel"] for item in group if item["sourceSpeakerLabel"] is not None
        }
        if len(labels) <= 1:
            chosen = min(
                group,
                key=lambda item: (
                    item["sourceSpeakerLabel"] is None,
                    item["profilePriority"],
                    item["profileId"],
                ),
            ).copy()
            chosen["matchedProfileIds"] = sorted({item["profileId"] for item in group})
            chosen["matchIds"] = sorted(item["matchId"] for item in group)
            result.append(chosen)
        else:
            for item in group:
                item = item.copy()
                item["matchedProfileIds"] = [item["profileId"]]
                item["matchIds"] = [item["matchId"]]
                result.append(item)
    return result


def _overlaps(left: Mapping[str, Any], right: Mapping[str, Any]) -> bool:
    return left["blockId"] == right["blockId"] and max(
        left["sourceStart"], right["sourceStart"]
    ) < min(left["sourceEnd"], right["sourceEnd"])


def _nested_unlabelled_claim(
    left: Mapping[str, Any], right: Mapping[str, Any]
) -> Mapping[str, Any] | None:
    """Return an unlabelled quote already owned by a containing explicit turn."""

    explicit_profiles = {
        "label-brackets",
        "label-curly-quotes",
        "label-straight-quotes",
        "label-dash",
        "label-colon-line",
        "screenplay",
    }
    for outer, inner in ((left, right), (right, left)):
        if (
            outer["profileId"] in explicit_profiles
            and str(inner["profileId"]).startswith("unlabeled-")
            and outer["speakerStatus"] == "explicit"
            and inner["speakerStatus"] == "unlabelled"
            and outer["sourceStart"] <= inner["sourceStart"]
            and outer["sourceEnd"] >= inner["sourceEnd"]
        ):
            return inner
    return None


def _resolve_conflicts(
    candidates: Sequence[dict[str, Any]],
    conflict_resolutions: Sequence[Mapping[str, Any]] = (),
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    resolutions = {
        tuple(sorted(str(profile_id) for profile_id in row.get("profileIds", []))): str(
            row.get("winnerProfileId", "")
        )
        for row in conflict_resolutions
        if len(row.get("profileIds", [])) == 2
    }
    conflicted: set[str] = set()
    conflicts: list[dict[str, Any]] = []
    resolved_conflicts: list[dict[str, Any]] = []
    ordered = sorted(
        candidates,
        key=lambda item: (item["blockId"], item["sourceStart"], item["sourceEnd"]),
    )
    for index, left in enumerate(ordered):
        for right in ordered[index + 1 :]:
            if right["blockId"] != left["blockId"]:
                if right["blockId"] > left["blockId"]:
                    break
                continue
            if right["sourceStart"] >= left["sourceEnd"]:
                break
            if _overlaps(left, right):
                nested = _nested_unlabelled_claim(left, right)
                if nested is not None:
                    conflicted.add(str(nested["matchId"]))
                    continue
                profile_ids = tuple(sorted((left["profileId"], right["profileId"])))
                winner_profile_id = resolutions.get(profile_ids)
                conflict = {
                    "id": f"conflict:{left['matchId']}:{right['matchId']}",
                    "groupId": f"profiles:{profile_ids[0]}:{profile_ids[1]}",
                    "blockId": left["blockId"],
                    "page": left["page"],
                    "matchIds": [left["matchId"], right["matchId"]],
                    "profileIds": list(profile_ids),
                    "sourceStart": max(left["sourceStart"], right["sourceStart"]),
                    "sourceEnd": min(left["sourceEnd"], right["sourceEnd"]),
                    "claims": [
                        {
                            key: claim.get(key)
                            for key in (
                                "matchId",
                                "profileId",
                                "blockId",
                                "page",
                                "sourceStart",
                                "sourceEnd",
                                "source",
                                "text",
                                "sourceSpeakerLabel",
                                "contextBefore",
                                "contextAfter",
                            )
                        }
                        for claim in (left, right)
                    ],
                }
                if winner_profile_id in profile_ids:
                    loser = right if left["profileId"] == winner_profile_id else left
                    conflicted.add(loser["matchId"])
                    resolved_conflicts.append(
                        {**conflict, "winnerProfileId": winner_profile_id}
                    )
                elif winner_profile_id == "narration":
                    conflicted.update((left["matchId"], right["matchId"]))
                    resolved_conflicts.append(
                        {**conflict, "winnerProfileId": "narration"}
                    )
                else:
                    conflicted.update((left["matchId"], right["matchId"]))
                    conflicts.append(conflict)
    accepted = [item for item in ordered if item["matchId"] not in conflicted]
    return accepted, conflicts, resolved_conflicts


def _partition(
    blocks: Sequence[dict[str, Any]],
    accepted: Sequence[dict[str, Any]],
    narrator_intact_paragraphs: bool,
) -> list[dict[str, Any]]:
    by_block: dict[str, list[dict[str, Any]]] = {}
    for candidate in accepted:
        by_block.setdefault(candidate["blockId"], []).append(candidate)

    partition: list[dict[str, Any]] = []
    for block in blocks:
        matches = sorted(by_block.get(block["id"], []), key=lambda item: item["sourceStart"])
        if narrator_intact_paragraphs and any(
            item["speakerStatus"] != "explicit" for item in matches
        ):
            matches = []
        cursor = 0
        part = 0
        for match in matches:
            if match["sourceStart"] > cursor:
                part += 1
                partition.append(_narration_span(block, cursor, match["sourceStart"], part))
            part += 1
            dialogue_span = {
                    "id": match["spanId"],
                    "blockId": block["id"],
                    "page": block["page"],
                    "sourceStart": match["sourceStart"],
                    "sourceEnd": match["sourceEnd"],
                    "spokenStart": match["spokenStart"],
                    "spokenEnd": match["spokenEnd"],
                    "source": block["text"][match["sourceStart"] : match["sourceEnd"]],
                    "text": match["text"],
                    "renderRole": "dialogue",
                    "sourceSpeakerLabel": match["sourceSpeakerLabel"],
                    "speakerStatus": match["speakerStatus"],
                    "origin": match["origin"],
                    "fallback": "narrator" if match["speakerStatus"] != "explicit" else None,
                }
            for field in ("turnGroupId", "fragmentIndex", "fragmentCount"):
                if field in match:
                    dialogue_span[field] = match[field]
            partition.append(dialogue_span)
            cursor = match["sourceEnd"]
        if cursor < len(block["text"]) or not matches:
            part += 1
            partition.append(_narration_span(block, cursor, len(block["text"]), part))
    return partition


def _narration_span(block: Mapping[str, Any], start: int, end: int, part: int) -> dict[str, Any]:
    return {
        "id": f"span:{block['id']}:n{part}:{start}-{end}",
        "blockId": block["id"],
        "page": block["page"],
        "sourceStart": start,
        "sourceEnd": end,
        "spokenStart": start,
        "spokenEnd": end,
        "source": block["text"][start:end],
        "text": block["text"][start:end],
        "renderRole": "narration",
        "sourceSpeakerLabel": None,
        "speakerStatus": "not-applicable",
        "origin": "source-partition",
        "fallback": None,
    }


def scan_dialogue(
    source: Sequence[Mapping[str, Any]],
    *,
    custom_profiles: Sequence[Mapping[str, Any]] = (),
    enabled_profile_ids: Iterable[str] | None = None,
    open_speaker_literals: Iterable[str] = ("???",),
    open_speaker_patterns: Iterable[str] = (),
    narrator_intact_paragraphs: bool = False,
    conflict_resolutions: Sequence[Mapping[str, Any]] = (),
    structural_resolutions: Sequence[Mapping[str, Any]] = (),
    example_limit: int = 3,
) -> dict[str, Any]:
    """Scan pages or blocks and return preview evidence plus an exact partition.

    ``source`` accepts current extraction pages (``page`` + ``text``) or already
    anchored blocks (``id`` + ``text``).  Invalid inputs fail before any artifact is
    returned, so callers can publish the result transactionally.
    """

    blocks = _normalise_blocks(source)
    custom = [_custom_profile(item, index) for index, item in enumerate(custom_profiles)]
    profiles = [*BUILTIN_PROFILES, *custom]
    if len({item.id for item in profiles}) != len(profiles):
        raise DialogueContractError("Regex profile IDs must be unique")
    if enabled_profile_ids is not None:
        enabled = set(enabled_profile_ids)
        profiles = [
            RegexProfile(**{**item.__dict__, "enabled": item.id in enabled}) for item in profiles
        ]

    raw, by_profile = _raw_scan(blocks, profiles, open_speaker_literals, open_speaker_patterns)
    raw, structural_issues, resolved_structural_issues = _resolve_structural_issues(
        raw,
        profiles,
        blocks,
        structural_resolutions,
        open_speaker_literals,
        open_speaker_patterns,
    )
    candidates = _coalesce(raw)
    accepted, conflicts, resolved_conflicts = _resolve_conflicts(candidates, conflict_resolutions)
    for conflict in [*conflicts, *resolved_conflicts]:
        conflict["claims"] = _match_evidence_with_context(conflict["claims"], blocks)
    partition = _partition(blocks, accepted, narrator_intact_paragraphs)

    profile_results = []
    for profile in sorted(profiles, key=lambda item: (item.priority, item.id)):
        matches = by_profile[profile.id]
        logical_matches = _match_evidence_with_context(
            _logical_match_evidence(matches), blocks
        )
        profile_results.append(
            {
                "id": profile.id,
                "label": profile.label,
                "priority": profile.priority,
                "enabled": profile.enabled,
                "custom": profile.custom,
                "builtIn": not profile.custom,
                "pattern": profile.pattern,
                "flags": (
                    ("m" if profile.flags & re.MULTILINE else "")
                    + ("s" if profile.flags & re.DOTALL else "")
                ),
                "matchCount": len(logical_matches),
                "examples": logical_matches[:example_limit],
            }
        )

    logical_accepted = {
        str(item.get("turnGroupId") or item["spanId"]): item for item in accepted
    }.values()
    logical_candidates = {
        str(item.get("turnGroupId") or item["spanId"]): item for item in candidates
    }.values()
    summary = {
        "regexClaims": len(logical_candidates),
        "explicitTurns": sum(item["speakerStatus"] == "explicit" for item in logical_accepted),
        "openSpeakerTurns": sum(item["speakerStatus"] == "unresolved" for item in logical_accepted),
        "unlabelledCandidates": sum(
            item["speakerStatus"] == "unlabelled" for item in logical_accepted
        ),
        "conflicts": len(conflicts),
        "structuralIssues": len(structural_issues),
        "continuedTurns": len(
            {
                item["turnGroupId"]
                for item in raw
                if item.get("turnGroupId")
                and str(item.get("origin", "")).endswith(":cross-boundary")
            }
        ),
    }
    return {
        "scanVersion": DIALOGUE_SCAN_VERSION,
        "blocks": blocks,
        "profiles": profile_results,
        "matches": candidates,
        "acceptedMatches": accepted,
        "conflicts": conflicts,
        "resolvedConflicts": resolved_conflicts,
        "conflictResolutions": [dict(row) for row in conflict_resolutions],
        "structuralIssues": structural_issues,
        "resolvedStructuralIssues": resolved_structural_issues,
        "structuralResolutions": [dict(row) for row in structural_resolutions],
        "summary": summary,
        "partition": partition,
        "narratorIntactParagraphs": narrator_intact_paragraphs,
        "openSpeakerLiterals": list(open_speaker_literals),
        "openSpeakerPatterns": list(open_speaker_patterns),
    }


def _logical_match_evidence(matches: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    order: list[str] = []
    for match in matches:
        key = str(match.get("turnGroupId") or match["matchId"])
        if key not in grouped:
            order.append(key)
        grouped.setdefault(key, []).append(match)
    result = []
    for key in order:
        fragments = grouped[key]
        if len(fragments) == 1 and not fragments[0].get("turnGroupId"):
            result.append(dict(fragments[0]))
            continue
        first = dict(fragments[0])
        first.update(
            {
                "matchId": key,
                "source": "".join(str(row.get("source", "")) for row in fragments),
                "text": "".join(str(row.get("text", "")) for row in fragments),
                "sourceFragments": [
                    {
                        "spanId": row["spanId"],
                        "blockId": row["blockId"],
                        "page": row["page"],
                        "sourceStart": row["sourceStart"],
                        "sourceEnd": row["sourceEnd"],
                    }
                    for row in fragments
                ],
            }
        )
        result.append(first)
    return result


def _match_evidence_with_context(
    matches: Sequence[Mapping[str, Any]], blocks: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """Show the complete matched line plus its nearest source line on either side."""
    document = "".join(str(block.get("text", "")) for block in blocks)
    offsets: dict[str, int] = {}
    cursor = 0
    for block in blocks:
        offsets[str(block["id"])] = cursor
        cursor += len(str(block.get("text", "")))
    lines = []
    cursor = 0
    for line in document.splitlines(keepends=True) or [document]:
        lines.append((cursor, cursor + len(line), line))
        cursor += len(line)

    result = []
    for raw in matches:
        match = dict(raw)
        fragments = list(match.get("sourceFragments", []))
        first = fragments[0] if fragments else match
        last = fragments[-1] if fragments else match
        start = offsets.get(str(first.get("blockId")), 0) + int(
            first.get("sourceStart", match.get("sourceStart", 0))
        )
        end = offsets.get(str(last.get("blockId")), 0) + int(
            last.get("sourceEnd", match.get("sourceEnd", 0))
        )
        covered = [index for index, (line_start, line_end, _) in enumerate(lines) if line_end > start and line_start < end]
        first_line = covered[0] if covered else 0
        last_line = covered[-1] if covered else first_line
        previous = next(
            (index for index in range(first_line - 1, -1, -1) if lines[index][2].strip()),
            first_line,
        )
        following = next(
            (index for index in range(last_line + 1, len(lines)) if lines[index][2].strip()),
            last_line,
        )
        match["contextBefore"] = document[lines[previous][0] : start]
        match["contextAfter"] = document[end : lines[following][1]]
        result.append(match)
    return result


def reconstruct_partition(result: Mapping[str, Any]) -> dict[int, str]:
    """Reconstruct pages from a scan result; useful as an acceptance invariant."""

    reconstructed: dict[int, list[str]] = {}
    for span in result["partition"]:
        reconstructed.setdefault(int(span["page"]), []).append(str(span["source"]))
    return {page: "".join(parts) for page, parts in reconstructed.items()}


def dialogue_progression_blockers(result: Mapping[str, Any]) -> list[str]:
    """Return conflicts that require a regex toggle or revised Dialogue run."""
    conflicts = list(result.get("conflicts", []))
    blockers = []
    if conflicts:
        blockers.append(f"Resolve {len(conflicts)} overlapping regex claim(s) before acceptance")
    structural_issues = list(result.get("structuralIssues", []))
    if structural_issues:
        blockers.append(
            f"Resolve {len(structural_issues)} interrupted dialogue turn(s) before acceptance"
        )
    return blockers
