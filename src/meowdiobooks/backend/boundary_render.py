"""Validate accepted two-span repairs against the source and current render inputs."""

from collections.abc import Mapping, Sequence
from copy import deepcopy
from .boundary_review import boundary_spellings


class BoundaryRenderError(ValueError):
    pass


_CONTEXT_FIELDS = (
    "renderRole",
    "sourceSpeakerLabel",
    "resolvedSpeakerLabel",
    "speakerLabels",
    "speakerStatus",
)


def validate_boundary_repairs(repairs, spans, entries, *, capture_context=False):
    """Return immutable copies; fail closed when an approved seam cannot be rendered."""
    if not isinstance(repairs, list):
        raise BoundaryRenderError("Boundary repairs must be a list")
    positions = {str(row["id"]): i for i, row in enumerate(spans)}
    sources = {str(row["id"]): row for row in spans}
    owners = {}
    for entry in entries:
        for source_id in entry.get("sourceSpanIds", []):
            if str(source_id) in owners:
                raise BoundaryRenderError("Boundary source has duplicate script ownership")
            owners[str(source_id)] = entry
    occupied = []
    result = []
    for raw in repairs:
        if not isinstance(raw, Mapping):
            raise BoundaryRenderError("Invalid boundary repair")
        anchors = raw.get("anchors")
        if (
            not isinstance(anchors, Sequence)
            or isinstance(anchors, (str, bytes))
            or len(anchors) != 2
        ):
            raise BoundaryRenderError("Boundary repair needs two exact anchors")
        context = []
        for i, anchor in enumerate(anchors):
            if not isinstance(anchor, Mapping):
                raise BoundaryRenderError("Invalid boundary anchor")
            span_id = anchor.get("spanId")
            if (
                not isinstance(span_id, str)
                or not span_id
                or not isinstance(anchor.get("blockId"), str)
            ):
                raise BoundaryRenderError("Invalid boundary source identity")
            span, entry = sources.get(span_id), owners.get(span_id)
            if span is None or entry is None or entry.get("sourceSpanIds") != [span_id]:
                raise BoundaryRenderError("Boundary source no longer has its original script entry")
            start, end = anchor.get("sourceStart"), anchor.get("sourceEnd")
            if type(start) is not int or type(end) is not int or not 0 <= start < end:
                raise BoundaryRenderError("Invalid boundary source range")
            span_start, span_end = span.get("sourceStart"), span.get("sourceEnd")
            if (
                type(span_start) is not int
                or type(span_end) is not int
                or not span_start <= start < end <= span_end
            ):
                raise BoundaryRenderError("Boundary anchor is outside its source span")
            source = anchor.get("source")
            if (
                not isinstance(source, str)
                or not source
                or str(span.get("blockId")) != anchor.get("blockId")
                or str(span.get("source", ""))[start - span_start : end - span_start] != source
            ):
                raise BoundaryRenderError("Boundary anchor no longer matches the source")
            spoken_edge = (
                span.get("spokenEnd", span_end) if i == 0 else span.get("spokenStart", span_start)
            )
            if (end if i == 0 else start) != spoken_edge:
                raise BoundaryRenderError("Boundary anchor is not at the spoken span edge")
            text = entry.get("text", "")
            if (
                entry.get("kind") != "source"
                or span.get("reviewAction") == "exclude"
                or not isinstance(text, str)
                or text != str(span.get("text", span.get("source", "")))
                or not (text.endswith(source) if i == 0 else text.startswith(source))
            ):
                raise BoundaryRenderError("Boundary repair conflicts with an edit or exclusion")
            for block, old_start, old_end in occupied:
                if block == anchor["blockId"] and max(start, old_start) < min(end, old_end):
                    raise BoundaryRenderError("Accepted boundary repairs overlap")
            occupied.append((anchor["blockId"], start, end))
            context.append(
                {
                    "chapterId": str(entry.get("chapterId") or "chapter-1"),
                    **{
                        key: deepcopy(span.get(key, "narration" if key == "renderRole" else None))
                        for key in _CONTEXT_FIELDS
                    },
                }
            )
        left, right = anchors
        if (
            left["blockId"] == right["blockId"]
            or positions[left["spanId"]] + 1 != positions[right["spanId"]]
            or context[0] != context[1]
        ):
            raise BoundaryRenderError(
                "Boundary repair requires adjacent compatible spans in one chapter"
            )
        if capture_context and any(
            key in raw and raw[key] != context[0][key] for key in _CONTEXT_FIELDS
        ):
            raise BoundaryRenderError("Boundary role or speaker changed since acceptance")
        if not capture_context and raw.get("renderContext") != context:
            raise BoundaryRenderError(
                "Boundary render context changed; rebuild the recording script"
            )
        action = raw.get("boundaryDecision")
        try:
            expected = boundary_spellings(left["source"], right["source"])[action]
        except (ValueError, KeyError, TypeError) as exc:
            raise BoundaryRenderError("Invalid boundary spelling decision") from exc
        if (
            raw.get("replacement") != expected
            or raw.get("source") != left["source"] + right["source"]
        ):
            raise BoundaryRenderError(
                "Boundary replacement does not match its exact spelling option"
            )
        result.append({**deepcopy(dict(raw)), "renderContext": context})
    return result
