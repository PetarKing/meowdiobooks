"""Luna ``Dual pass with tools`` dialogue attribution.

The workflow keeps source ownership deterministic: Luna can inspect evidence and propose
classification/speaker decisions, but it cannot create or rewrite source identifiers.  Two
independent passes run over bounded eight-page scenes.  A higher-reasoning pass adjudicates only
meaningful disagreements.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .dialogue import DialogueContractError
from .dialogue_ai import (
    _selected_attribution_statuses,
    resolve_dialogue,
)
from .dialogue_attribution import (
    attribution_check,
    attribution_summary,
)
from .model_config import RemoteTextModelConfig, load_model_registry
from .remote_llm import RemoteRequestAdmission, _observe_remote_call, admit_remote_request


POLICY_ID = "dual-pass-with-tools-v1"
_SENTINELS = {"", "?", "/"}
_GENERIC_ROLES = {
    "footman",
    "frog-footman",
    "fish-footman",
    "guard",
    "narrator",
    "unknown man",
    "unknown woman",
}

_FAST_SYSTEM = """You assign audiobook dialogue to named characters.

For every requested target:
- classify it as D (spoken dialogue) or N (not spoken dialogue);
- for D, return the proper character name only when the source supports the identity;
- use "?" when it is dialogue but the proper name remains unsupported;
- never turn roles or descriptions such as Narrator, Footman, Guard, Mother, or unknown man into
  character names unless the book establishes that as the character's actual name;
- use the available tools only when nearby pages or book search can resolve genuine uncertainty;
- treat search hits as leads, not proof that a character spoke the target;
- return one decision for every target ID and no others.

Prefer an adjacent speech tag, a continuous turn, an explicit address plus turn structure, or a
nearby passage that identifies the same exchange. Do not guess from personality alone."""

_STRONG_SYSTEM = """You are a source-critical dialogue attribution analyst for audiobook production.

Decide every requested target:
- D = spoken dialogue; N = narration, typography, or other non-dialogue.
- For D, return a proper character identity only when the source supports it.
- Return "?" when speech is real but only a role, description, or unsupported guess is available.
- An addressee is not the speaker. First-person narration does not make every quotation the narrator.
- Preserve interrupted speech when a speech tag establishes it.
- Audible muttering is dialogue; private thought is not.
- Audit the local turn sequence before trusting conversational alternation.

The prompt contains a bounded scene. The tools provide model-friendly local inspection, exact target
context, bounded read-ahead/read-behind, and character evidence elsewhere in the book. A mention
establishes that a character exists, not automatically that they spoke. Do not call tools for locally
explicit decisions and do not perform decorative research.

Evidence must explain the attribution, not merely repeat the quote. Return exactly one decision for
every requested target ID and no others."""

_FAST_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "targetId": {"type": "string"},
                    "classification": {"type": "string", "enum": ["D", "N"]},
                    "speaker": {"type": "string"},
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                    "evidencePages": {
                        "type": "array",
                        "items": {"type": "integer"},
                    },
                    "evidenceQuote": {"type": "string"},
                    "unresolvedReason": {"type": "string"},
                },
                "required": [
                    "targetId",
                    "classification",
                    "speaker",
                    "confidence",
                    "evidencePages",
                    "evidenceQuote",
                    "unresolvedReason",
                ],
            },
        }
    },
    "required": ["decisions"],
}

_STRONG_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "targetId": {"type": "string"},
                    "classification": {"type": "string", "enum": ["D", "N"]},
                    "speaker": {"type": "string"},
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                    "basis": {
                        "type": "string",
                        "enum": [
                            "explicit-local",
                            "local-turn-structure",
                            "outside-scene",
                            "unresolved",
                            "not-dialogue",
                        ],
                    },
                    "evidencePages": {
                        "type": "array",
                        "items": {"type": "integer"},
                    },
                    "evidenceQuote": {"type": "string"},
                    "attributionReason": {"type": "string"},
                    "outsideEvidenceUsed": {"type": "boolean"},
                },
                "required": [
                    "targetId",
                    "classification",
                    "speaker",
                    "confidence",
                    "basis",
                    "evidencePages",
                    "evidenceQuote",
                    "attributionReason",
                    "outsideEvidenceUsed",
                ],
            },
        }
    },
    "required": ["decisions"],
}

_FAST_TOOLS: tuple[dict[str, Any], ...] = (
    {
        "type": "function",
        "name": "read_pages",
        "description": (
            "Read at most six contiguous pages. Use for nearby continuation or to verify a "
            "promising search hit."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "start_page": {"type": "integer", "minimum": 1},
                "end_page": {"type": "integer", "minimum": 1},
            },
            "required": ["start_page", "end_page"],
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "search_book",
        "description": (
            "Search the full book for a short exact phrase or character name. Results are leads, "
            "not proof of who spoke."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "query": {"type": "string", "minLength": 2, "maxLength": 120},
                "max_results": {"type": "integer", "minimum": 1, "maximum": 8},
            },
            "required": ["query", "max_results"],
        },
        "strict": True,
    },
)

_STRONG_TOOLS: tuple[dict[str, Any], ...] = (
    {
        "type": "function",
        "name": "inspect_dialogue_targets",
        "description": (
            "Show a clean turn-by-turn neighborhood around requested target IDs. This is local "
            "scene evidence reformatted to expose tags, addressees, and turn continuity."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "target_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 1,
                    "maxItems": 8,
                },
                "radius": {"type": "integer", "enum": [3, 6, 10]},
            },
            "required": ["target_ids", "radius"],
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "retrieve_target_context",
        "description": (
            "Locate requested target words and return wider exact context. Use when extraction "
            "damage or omitted local spans make the position unclear."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "target_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 1,
                    "maxItems": 8,
                },
                "context_chars": {"type": "integer", "enum": [400, 800, 1400]},
            },
            "required": ["target_ids", "context_chars"],
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "find_character_evidence",
        "description": (
            "Search outside the supplied scene for one proposed name or distinctive identity "
            "clue. A mention establishes existence, not attribution."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "query": {"type": "string", "minLength": 2, "maxLength": 80},
                "max_hits": {"type": "integer", "minimum": 1, "maximum": 6},
            },
            "required": ["query", "max_hits"],
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "read_beyond_scene",
        "description": (
            "Read pages immediately before or after the supplied scene. Use when an exchange "
            "crosses the boundary or its nearest continuation identifies a participant."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "direction": {"type": "string", "enum": ["before", "after"]},
                "page_count": {"type": "integer", "minimum": 1, "maximum": 4},
            },
            "required": ["direction", "page_count"],
        },
        "strict": True,
    },
)


RemoteReporter = Callable[[float, str | None], None]
UsageObserver = Callable[[RemoteTextModelConfig, Mapping[str, Any]], None]
ApiCall = Callable[[dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class DualPassPolicy:
    window_pages: int = 8
    max_targets_per_batch: int = 8
    max_workers: int = 8
    fast_max_tools: int = 8
    strong_max_tools: int = 8
    adjudicator_max_tools: int = 6
    max_tool_rounds: int = 5
    max_tool_result_characters: int = 10_000


@dataclass(frozen=True)
class ToolResult:
    output: str
    pages: tuple[int, ...] = ()
    provenance: str = "local"
    error: str = ""


@dataclass
class BookEvidence:
    pages: list[str]
    window: Mapping[str, Any]
    max_result_characters: int

    @property
    def scene_pages(self) -> set[int]:
        return {int(page) for page in self.window["contextPages"]}

    def execute(self, name: str, arguments: Mapping[str, Any]) -> ToolResult:
        if name == "read_pages":
            return self.read_pages(
                int(arguments.get("start_page", 0)),
                int(arguments.get("end_page", 0)),
            )
        if name == "search_book":
            return self.search_book(
                str(arguments.get("query", "")),
                int(arguments.get("max_results", 0)),
            )
        if name == "inspect_dialogue_targets":
            raw_ids = arguments.get("target_ids")
            return self.inspect_targets(
                [str(value) for value in raw_ids] if isinstance(raw_ids, list) else [],
                int(arguments.get("radius", 0)),
            )
        if name == "retrieve_target_context":
            raw_ids = arguments.get("target_ids")
            return self.retrieve_target_context(
                [str(value) for value in raw_ids] if isinstance(raw_ids, list) else [],
                int(arguments.get("context_chars", 0)),
            )
        if name == "find_character_evidence":
            return self.find_character_evidence(
                str(arguments.get("query", "")),
                int(arguments.get("max_hits", 0)),
            )
        if name == "read_beyond_scene":
            return self.read_beyond_scene(
                str(arguments.get("direction", "")),
                int(arguments.get("page_count", 0)),
            )
        return ToolResult(f"TOOL ERROR: unknown tool {name!r}.", error="unknown tool")

    def read_pages(self, start_page: int, end_page: int) -> ToolResult:
        if start_page < 1 or end_page < start_page or end_page - start_page + 1 > 6:
            return ToolResult(
                "TOOL ERROR: request one to six contiguous pages.",
                error="invalid page range",
            )
        if start_page > len(self.pages):
            return ToolResult(
                f"TOOL ERROR: the book has {len(self.pages)} pages.",
                error="page out of range",
            )
        selected = range(start_page, min(end_page, len(self.pages)) + 1)
        output = ["BOUNDED BOOK PAGES"]
        for page in selected:
            output.extend((f"[page {page}]", self.pages[page - 1].strip()))
        return ToolResult(
            _bounded("\n".join(output), self.max_result_characters),
            tuple(selected),
            "outside" if set(selected).isdisjoint(self.scene_pages) else "local",
        )

    def search_book(self, query: str, max_results: int) -> ToolResult:
        query = _compact(query)
        if len(query) < 2:
            return ToolResult("TOOL ERROR: query is too short.", error="query too short")
        hits = self._matches(query, excluded_pages=set())[: max(1, min(8, max_results))]
        lines = [f"BOOK SEARCH — query: {query!r}"]
        for rank, (page, offset) in enumerate(hits, 1):
            text = self.pages[page - 1]
            lines.extend(
                (
                    f"[hit {rank} | page {page}]",
                    _compact(text[max(0, offset - 360) : offset + len(query) + 360]),
                )
            )
        if not hits:
            lines.append("No exact matches. This does not prove absence.")
        return ToolResult(
            _bounded("\n".join(lines), self.max_result_characters),
            tuple(page for page, _offset in hits),
            "outside" if any(page not in self.scene_pages for page, _ in hits) else "local",
        )

    def inspect_targets(self, target_ids: Sequence[str], radius: int) -> ToolResult:
        partition = list(self.window["partition"])
        positions = {str(span["id"]): index for index, span in enumerate(partition)}
        invalid = [target_id for target_id in target_ids if target_id not in positions]
        if not target_ids or invalid or radius not in {3, 6, 10}:
            return ToolResult("TOOL ERROR: invalid target IDs or radius.", error="invalid request")
        selected: set[int] = set()
        for target_id in target_ids:
            center = positions[target_id]
            selected.update(range(max(0, center - radius), min(len(partition), center + radius + 1)))
        lines = ["LOCAL TURN INSPECTION", f"Targets: {', '.join(target_ids)}"]
        pages: set[int] = set()
        target_set = set(target_ids)
        for index in sorted(selected):
            span = partition[index]
            page = int(span.get("page", 0))
            pages.add(page)
            span_id = str(span["id"])
            marker = "TARGET" if span_id in target_set else str(span.get("renderRole") or "span").upper()
            explicit = str(span.get("sourceSpeakerLabel") or "").strip()
            suffix = f" | explicit source label: {explicit}" if explicit else ""
            lines.extend(
                (
                    f"[p{page} | {marker} | {span_id}{suffix}]",
                    _compact(str(span.get("source") or span.get("text") or "")),
                )
            )
        return ToolResult(
            _bounded("\n".join(lines), self.max_result_characters),
            tuple(sorted(pages)),
        )

    def retrieve_target_context(
        self,
        target_ids: Sequence[str],
        context_characters: int,
    ) -> ToolResult:
        partition = {str(span["id"]): span for span in self.window["partition"]}
        invalid = [target_id for target_id in target_ids if target_id not in partition]
        if not target_ids or invalid or context_characters not in {400, 800, 1400}:
            return ToolResult("TOOL ERROR: invalid target IDs or context size.", error="invalid request")
        lines = ["RETRIEVED TARGET CONTEXT"]
        pages: set[int] = set()
        for target_id in target_ids:
            span = partition[target_id]
            source_page = int(span.get("page", 0))
            target = _compact(str(span.get("source") or span.get("text") or ""))
            if not 1 <= source_page <= len(self.pages):
                continue
            page_text = _compact(self.pages[source_page - 1])
            needle = target.casefold().strip('"“”')
            offset = page_text.casefold().find(needle)
            if offset < 0:
                offset = min(max(0, int(span.get("sourceStart", 0))), len(page_text))
            pages.add(source_page)
            lines.extend(
                (
                    f"[{target_id} | page {source_page}]",
                    page_text[
                        max(0, offset - context_characters) :
                        offset + len(needle) + context_characters
                    ],
                )
            )
        return ToolResult(
            _bounded("\n".join(lines), self.max_result_characters),
            tuple(sorted(pages)),
            "outside" if pages.isdisjoint(self.scene_pages) else "local",
        )

    def find_character_evidence(self, query: str, max_hits: int) -> ToolResult:
        query = _compact(query)
        if len(query) < 2 or len(re.findall(r"[\w'’-]+", query, flags=re.UNICODE)) > 4:
            return ToolResult(
                "TOOL ERROR: search one name or distinctive clue of at most four words.",
                error="invalid query",
            )
        hits = self._matches(query, excluded_pages=self.scene_pages)
        if not hits:
            alternatives = sorted(
                {token for token in re.findall(r"[\w'’-]+", query) if len(token) >= 4},
                key=len,
                reverse=True,
            )
            if alternatives:
                query = alternatives[0]
                hits = self._matches(query, excluded_pages=self.scene_pages)
        center = sum(self.scene_pages) / max(1, len(self.scene_pages))
        hits.sort(key=lambda row: (abs(row[0] - center), row[0]))
        hits = hits[: max(1, min(6, max_hits))]
        lines = [f"OUTSIDE-SCENE CHARACTER EVIDENCE — searched: {query!r}"]
        for rank, (page, offset) in enumerate(hits, 1):
            text = self.pages[page - 1]
            lines.extend(
                (
                    f"[hit {rank} | page {page}]",
                    _compact(text[max(0, offset - 300) : offset + len(query) + 420]),
                )
            )
        if not hits:
            lines.append("No outside-scene matches. This does not prove absence.")
        return ToolResult(
            _bounded("\n".join(lines), self.max_result_characters),
            tuple(page for page, _offset in hits),
            "outside",
        )

    def read_beyond_scene(self, direction: str, page_count: int) -> ToolResult:
        if direction not in {"before", "after"}:
            return ToolResult("TOOL ERROR: direction must be before or after.", error="invalid direction")
        page_count = max(1, min(4, page_count))
        if direction == "before":
            selected = list(range(max(1, min(self.scene_pages) - page_count), min(self.scene_pages)))
        else:
            selected = list(
                range(
                    max(self.scene_pages) + 1,
                    min(len(self.pages), max(self.scene_pages) + page_count) + 1,
                )
            )
        lines = [f"OUTSIDE-SCENE CONTINUATION — {direction.upper()}"]
        for page in selected:
            lines.extend((f"[page {page}]", self.pages[page - 1].strip()))
        if not selected:
            lines.append("No pages exist in this direction.")
        return ToolResult(
            _bounded("\n".join(lines), self.max_result_characters),
            tuple(selected),
            "outside",
        )

    def _matches(self, query: str, excluded_pages: set[int]) -> list[tuple[int, int]]:
        needle = query.casefold()
        matches = []
        for page, text in enumerate(self.pages, 1):
            if page in excluded_pages:
                continue
            offset = text.casefold().find(needle)
            if offset >= 0:
                matches.append((page, offset))
        return matches


def run_dialogue_remote(
    repo_root: Path,
    scan: Mapping[str, Any],
    strategy: str,
    report: RemoteReporter | None = None,
    attribution_targets: Sequence[str] = ("open-speakers", "unlabelled-candidates"),
    usage_observer: UsageObserver | None = None,
    request_admission: RemoteRequestAdmission | None = None,
) -> dict[str, Any]:
    """Run the selected dialogue policy and return the shared Dialogue artifact contract."""

    if strategy != "fill-gaps":
        raise DialogueContractError("Dual pass with tools only supports fill-gaps")
    selected = _selected_attribution_statuses(attribution_targets)
    targets = _target_ids(scan.get("partition", []), selected)
    if not targets:
        return _empty_result(scan, strategy, attribution_targets)

    config = load_model_registry(Path(repo_root)).remote_dialogue_model()
    if config is None or config.engine != "openai_responses":
        raise DialogueContractError("Dual pass with tools requires an OpenAI Responses profile")
    if config.model != "gpt-5.6-luna":
        raise DialogueContractError("Dual pass with tools requires the configured Luna model")
    resolved_policy = DualPassPolicy(
        max_targets_per_batch=config.max_targets_per_batch,
        max_workers=config.max_concurrent_batches,
    )
    calls = {
        effort: _responses_api_call(
            config, effort, usage_observer, request_admission=request_admission
        )
        for effort in ("low", "medium", "high")
    }
    notify = report or (lambda _progress, _message=None: None)
    windows = _dialogue_windows(
        scan.get("partition", []),
        targets,
        window_pages=resolved_policy.window_pages,
        max_targets=resolved_policy.max_targets_per_batch,
    )
    pages = _book_pages(scan.get("partition", []))
    notify(15, "Running Dual pass with tools")

    pass_results: dict[tuple[str, str], dict[str, Any]] = {}
    jobs = [
        (stage, window)
        for window in windows
        for stage in ("fast", "strong")
    ]
    with ThreadPoolExecutor(max_workers=resolved_policy.max_workers) as executor:
        futures = {
            executor.submit(
                _run_stage,
                stage,
                window,
                pages,
                calls["low" if stage == "fast" else "medium"],
                resolved_policy,
            ): (stage, window)
            for stage, window in jobs
        }
        for completed, future in enumerate(as_completed(futures), 1):
            stage, window = futures[future]
            pass_results[(stage, str(window["batchId"]))] = future.result()
            notify(
                15 + completed / max(1, len(futures)) * 65,
                "Checking speakers from two independent perspectives",
            )

    fast: dict[str, dict[str, Any]] = {}
    strong: dict[str, dict[str, Any]] = {}
    all_runs = list(pass_results.values())
    for (stage, _batch_id), run in pass_results.items():
        destination = fast if stage == "fast" else strong
        destination.update({str(row["targetId"]): row for row in run["decisions"]})

    disagreements: dict[str, tuple[str, str]] = {}
    final_decisions = dict(strong)
    for target_id in targets:
        left = _prediction(fast[target_id])
        right = _prediction(strong[target_id])
        if _needs_adjudication(left, right):
            disagreements[target_id] = (left, right)

    adjudication_windows = _adjudication_windows(windows, disagreements)
    if adjudication_windows:
        notify(82, "Adjudicating the remaining speaker conflicts")
        with ThreadPoolExecutor(max_workers=resolved_policy.max_workers) as executor:
            futures = [
                executor.submit(
                    _run_adjudicator,
                    window,
                    pages,
                    calls["high"],
                    resolved_policy,
                )
                for window in adjudication_windows
            ]
            for future in as_completed(futures):
                run = future.result()
                all_runs.append(run)
                final_decisions.update(
                    {str(row["targetId"]): row for row in run["decisions"]}
                )

    predictions: dict[str, str] = {}
    checks: list[dict[str, Any]] = []
    full_context = "".join(
        str(span.get("source", span.get("text", "")))
        for span in scan.get("partition", [])
    )
    for target_id in targets:
        final = _prediction(final_decisions[target_id])
        predictions[target_id] = final
        check = attribution_check(
            target_id,
            _prediction(fast[target_id]),
            _prediction(strong[target_id]),
            final,
            full_context,
            outcome="agreed" if final not in {"?", "/"} else "withheld",
        )
        check["suggestedSpeakers"] = [
            speaker
            for speaker in check["suggestedSpeakers"]
            if _normal(speaker) not in _GENERIC_ROLES
        ]
        check["resolution"] = "adjudicated" if target_id in disagreements else "dual-pass"
        check["policy"] = POLICY_ID
        checks.append(check)

    result = resolve_dialogue(
        scan,
        strategy,
        lambda _system, _prompt, owners: predictions[str(owners[0])],
        attribution_targets,
        attribution_origin=f"remote:{POLICY_ID}",
        validate_focused_evidence=False,
    )
    requests = [request for run in all_runs for request in run["requests"]]
    usage = _sum_usage(requests)
    result["attributionRoute"] = "remote"
    result["attributionChecks"] = checks
    result["remoteUsage"] = {
        "inputTokens": usage["input_tokens"],
        "cachedInputTokens": usage["cached_input_tokens"],
        "cacheWriteInputTokens": usage["cache_write_input_tokens"],
        "outputTokens": usage["output_tokens"],
        "estimatedCostUsd": round(_usage_cost(config, usage), 4),
        "modelProfile": config.id,
        "modelDisplayName": config.display_name,
        "providerModels": sorted(
            {
                str(request.get("model"))
                for request in requests
                if request.get("model")
            }
        ),
        "policy": POLICY_ID,
        "physicalRequests": len(requests),
        "toolCalls": sum(int(run["toolCalls"]) for run in all_runs),
        "adjudicatedTargets": len(disagreements),
    }
    result["resultSummary"].update(attribution_summary(checks, len(requests)))
    notify(100, "Dialogue speaker attribution complete")
    return result


def _run_stage(
    stage: str,
    window: Mapping[str, Any],
    pages: list[str],
    api_call: ApiCall,
    policy: DualPassPolicy,
) -> dict[str, Any]:
    strong = stage == "strong"
    return _run_agent(
        api_call=api_call,
        evidence=BookEvidence(pages, window, policy.max_tool_result_characters),
        instructions=_STRONG_SYSTEM if strong else _FAST_SYSTEM,
        prompt=_render_prompt(window, window["ownerIds"], full_scene=strong),
        target_ids=window["ownerIds"],
        schema=_STRONG_SCHEMA if strong else _FAST_SCHEMA,
        tools=_STRONG_TOOLS if strong else _FAST_TOOLS,
        max_tools=policy.strong_max_tools if strong else policy.fast_max_tools,
        max_rounds=policy.max_tool_rounds,
        strong=strong,
    )


def _run_adjudicator(
    window: Mapping[str, Any],
    pages: list[str],
    api_call: ApiCall,
    policy: DualPassPolicy,
) -> dict[str, Any]:
    prompt = _render_prompt(window, window["ownerIds"], full_scene=True)
    prompt += (
        "\n\nINDEPENDENT-PASS DISAGREEMENTS:\n"
        "Neither candidate is authoritative. Reconstruct the source turn sequence and choose a "
        "candidate, ?, /, or a different supported proper identity.\n"
    )
    for target_id in window["ownerIds"]:
        left, right = window["candidates"][target_id]
        prompt += f"- {target_id}: candidate A={left!r}; candidate B={right!r}\n"
    return _run_agent(
        api_call=api_call,
        evidence=BookEvidence(pages, window, policy.max_tool_result_characters),
        instructions=_STRONG_SYSTEM,
        prompt=prompt,
        target_ids=window["ownerIds"],
        schema=_STRONG_SCHEMA,
        tools=_STRONG_TOOLS,
        max_tools=policy.adjudicator_max_tools,
        max_rounds=max(1, policy.max_tool_rounds - 1),
        strong=True,
    )


def _run_agent(
    *,
    api_call: ApiCall,
    evidence: BookEvidence,
    instructions: str,
    prompt: str,
    target_ids: Sequence[str],
    schema: Mapping[str, Any],
    tools: Sequence[Mapping[str, Any]],
    max_tools: int,
    max_rounds: int,
    strong: bool,
) -> dict[str, Any]:
    conversation: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    requests: list[dict[str, Any]] = []
    tool_trace: list[dict[str, Any]] = []
    tool_calls = 0
    validation_failures = 0
    force_final = max_tools <= 0
    round_number = 0
    while True:
        round_number += 1
        payload: dict[str, Any] = {
            "instructions": instructions,
            "input": conversation,
            "max_output_tokens": 8_000,
            "store": False,
            "include": ["reasoning.encrypted_content"],
            "text": {
                "verbosity": "low",
                "format": {
                    "type": "json_schema",
                    "name": "dialogue_attribution_decisions",
                    "strict": True,
                    "schema": dict(schema),
                },
            },
        }
        if not force_final:
            payload["tools"] = list(tools)
            payload["tool_choice"] = "auto"
        response_started = time.monotonic()
        response = api_call(payload)
        requests.append(
            {
                "latencyMs": round((time.monotonic() - response_started) * 1_000),
                "usage": dict(response.get("usage") or {}),
                "responseId": response.get("id"),
                "model": response.get("model"),
            }
        )
        output = response.get("output")
        if not isinstance(output, list):
            raise DialogueContractError("Luna Responses output was missing")
        function_calls = [
            item
            for item in output
            if isinstance(item, Mapping) and item.get("type") == "function_call"
        ]
        if not function_calls:
            try:
                parsed = json.loads(_response_text(response))
                decisions = _validate_decisions(parsed, target_ids, strong=strong)
            except (json.JSONDecodeError, ValueError) as error:
                validation_failures += 1
                if validation_failures >= 2:
                    raise DialogueContractError(
                        f"Luna returned inconsistent structured decisions: {error}"
                    ) from error
                conversation.extend(dict(item) for item in output if isinstance(item, Mapping))
                conversation.append(
                    {
                        "role": "user",
                        "content": (
                            f"Correct the structured decision error: {error}. Return every "
                            "required target. N requires speaker=\"\"; D requires a name or ?."
                        ),
                    }
                )
                force_final = True
                continue
            return {
                "decisions": decisions,
                "requests": requests,
                "toolTrace": tool_trace,
                "toolCalls": tool_calls,
            }

        conversation.extend(dict(item) for item in output if isinstance(item, Mapping))
        for item in function_calls:
            try:
                arguments = json.loads(str(item.get("arguments") or "{}"))
            except json.JSONDecodeError:
                arguments = {}
            if tool_calls >= max_tools:
                execution = ToolResult(
                    f"TOOL BUDGET EXHAUSTED: {max_tools} calls. Finish and use ? where needed.",
                    error="tool budget exhausted",
                )
            else:
                execution = evidence.execute(str(item.get("name") or ""), arguments)
                tool_calls += 1
            tool_trace.append(
                {
                    "name": str(item.get("name") or ""),
                    "arguments": arguments,
                    "provenance": execution.provenance,
                    "resultPages": list(execution.pages),
                    "error": execution.error or None,
                }
            )
            conversation.append(
                {
                    "type": "function_call_output",
                    "call_id": str(item.get("call_id") or ""),
                    "output": execution.output,
                }
            )
        if tool_calls >= max_tools or round_number >= max_rounds:
            conversation.append(
                {
                    "role": "user",
                    "content": (
                        "Research is complete. Return all required decisions now and use ? for "
                        "any unsupported proper identity."
                    ),
                }
            )
            force_final = True


def _responses_api_call(
    config: RemoteTextModelConfig,
    reasoning_effort: str,
    usage_observer: UsageObserver | None,
    *,
    request_admission: RemoteRequestAdmission | None = None,
) -> ApiCall:
    api_key = os.environ.get(config.api_key_env, "").strip()
    if not api_key:
        raise DialogueContractError(
            f"Remote Dialogue requires {config.api_key_env} in the service environment"
        )
    endpoint = f"{config.base_url.rstrip('/')}/responses"

    def call(raw_payload: dict[str, Any]) -> dict[str, Any]:
        payload = {
            **raw_payload,
            "model": config.model,
            "reasoning": {
                "effort": reasoning_effort,
                "context": "all_turns",
            },
        }
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        last_error = ""
        for attempt, delay in enumerate((2, 5, 10, 0), 1):
            request = urllib.request.Request(
                endpoint,
                data=encoded,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            completion = admit_remote_request(
                config,
                request_admission,
                payload_bytes=len(encoded),
                max_output_tokens=payload.get("max_output_tokens"),
                attempt=attempt,
            )
            try:
                with urllib.request.urlopen(request, timeout=600) as response:
                    raw_response = response.read()
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")[:2_000]
                last_error = f"HTTP {error.code}: {detail}"
                _observe_remote_call(
                    config, usage_observer, completion=completion,
                    outcome="http-error", attempt=attempt,
                    ambiguous_billable=error.code in {408, 500, 502, 503, 504},
                    http_status=error.code,
                )
                if error.code not in {429, 500, 502, 503, 504} or not delay:
                    break
            except (OSError, urllib.error.URLError) as error:
                last_error = f"{type(error).__name__}: {error}"
                _observe_remote_call(
                    config, usage_observer, completion=completion,
                    outcome="transport-error", attempt=attempt, ambiguous_billable=True,
                )
                if not delay:
                    break
            else:
                try:
                    result = json.loads(raw_response)
                    if not isinstance(result, Mapping):
                        raise ValueError("Response must be an object")
                except (ValueError, TypeError) as error:
                    last_error = f"{type(error).__name__}: {error}"
                    _observe_remote_call(
                        config, usage_observer, completion=completion,
                        outcome="invalid-response", attempt=attempt, ambiguous_billable=True,
                    )
                    if not delay:
                        break
                else:
                    usage = result.get("usage")
                    _observe_remote_call(
                        config, usage_observer, completion=completion,
                        outcome="response", attempt=attempt,
                        model=str(result.get("model") or config.model),
                        reported_model=result.get("model"),
                        usage=usage if isinstance(usage, Mapping) else {},
                        ambiguous_billable=not bool(usage), http_status=200,
                    )
                    return result
            time.sleep(delay)
        raise DialogueContractError(f"Luna request failed: {last_error}")

    return call


def _target_ids(
    spans: Sequence[Mapping[str, Any]],
    selected_statuses: set[str],
) -> list[str]:
    targets = []
    seen_groups: set[str] = set()
    for span in spans:
        if span.get("renderRole") != "dialogue" or span.get("speakerStatus") not in selected_statuses:
            continue
        logical = str(span.get("turnGroupId") or span["id"])
        if logical in seen_groups:
            continue
        seen_groups.add(logical)
        targets.append(str(span["id"]))
    return targets


def _dialogue_windows(
    spans: Sequence[Mapping[str, Any]],
    target_ids: Sequence[str],
    *,
    window_pages: int,
    max_targets: int,
) -> list[dict[str, Any]]:
    if window_pages < 2 or max_targets < 1:
        raise DialogueContractError("Dual-pass Dialogue window limits are invalid")
    ordered = [dict(span) for span in spans]
    by_id = {str(span.get("id")): span for span in ordered}
    if len(by_id) != len(ordered) or "" in by_id:
        raise DialogueContractError("Dialogue spans require unique non-empty IDs")
    buckets: dict[int, list[str]] = {}
    for target_id in target_ids:
        if target_id not in by_id:
            raise DialogueContractError(f"Unknown Dialogue target: {target_id}")
        page = max(1, int(by_id[target_id].get("page", 1)))
        start = ((page - 1) // window_pages) * window_pages + 1
        buckets.setdefault(start, []).append(target_id)
    windows = []
    for start, owners in sorted(buckets.items()):
        end = start + window_pages - 1
        partition = [span for span in ordered if start <= int(span.get("page", 0)) <= end]
        context_pages = sorted({int(span.get("page", 0)) for span in partition})
        for offset in range(0, len(owners), max_targets):
            index = len(windows) + 1
            windows.append(
                {
                    "id": f"dual-pass-scene-{start:04d}-{end:04d}",
                    "batchId": f"dual-pass-batch-{index:05d}",
                    "contextPages": context_pages,
                    "ownerIds": list(owners[offset : offset + max_targets]),
                    "partition": partition,
                }
            )
    return windows


def _adjudication_windows(
    windows: Sequence[Mapping[str, Any]],
    disagreements: Mapping[str, tuple[str, str]],
) -> list[dict[str, Any]]:
    output = []
    for window in windows:
        targets = [target_id for target_id in window["ownerIds"] if target_id in disagreements]
        for offset in range(0, len(targets), 6):
            owners = targets[offset : offset + 6]
            if not owners:
                continue
            output.append(
                {
                    **dict(window),
                    "ownerIds": owners,
                    "candidates": {target_id: disagreements[target_id] for target_id in owners},
                }
            )
    return output


def _render_prompt(
    window: Mapping[str, Any],
    target_ids: Sequence[str],
    *,
    full_scene: bool,
) -> str:
    partition = list(window["partition"])
    target_set = set(target_ids)
    if full_scene:
        selected = range(len(partition))
    else:
        selected_set: set[int] = set()
        for index, span in enumerate(partition):
            if str(span["id"]) in target_set:
                selected_set.update(range(max(0, index - 12), min(len(partition), index + 13)))
        selected = sorted(selected_set)
    parts = [
        f"SCENE: {window['id']}",
        f"SUPPLIED PAGES: {', '.join(map(str, window['contextPages']))}",
        "REQUESTED TARGET IDS:",
        *[f"- {target_id}" for target_id in target_ids],
        "",
        "ORDERED LOCAL SCENE:",
    ]
    for index in selected:
        span = partition[index]
        span_id = str(span["id"])
        marker = f">>> TARGET {span_id}" if span_id in target_set else str(span.get("renderRole") or "span").upper()
        label = str(span.get("sourceSpeakerLabel") or "").strip()
        suffix = f" | explicit source label: {label}" if label else ""
        parts.extend(
            (
                f"[p{int(span.get('page', 0))} | {marker}{suffix}]",
                str(span.get("source") or span.get("text") or "").strip(),
            )
        )
    parts.extend(
        (
            "",
            "Return one decision per requested ID. N => speaker=\"\". Unresolved D => "
            "speaker=\"?\". A role is not a proper identity.",
        )
    )
    return "\n".join(parts)


def _validate_decisions(
    parsed: Mapping[str, Any],
    target_ids: Sequence[str],
    *,
    strong: bool,
) -> list[dict[str, Any]]:
    raw_decisions = parsed.get("decisions")
    if not isinstance(raw_decisions, list):
        raise ValueError("decisions must be an array")
    expected = list(target_ids)
    decisions: dict[str, dict[str, Any]] = {}
    for raw in raw_decisions:
        if not isinstance(raw, Mapping):
            raise ValueError("each decision must be an object")
        decision = dict(raw)
        target_id = str(decision.get("targetId") or "")
        if target_id not in expected or target_id in decisions:
            raise ValueError(f"unexpected or duplicate targetId: {target_id}")
        classification = decision.get("classification")
        speaker = str(decision.get("speaker") or "").strip()
        if classification == "N" and speaker:
            raise ValueError(f"N decision has a speaker: {target_id}")
        if classification == "D" and not speaker:
            raise ValueError(f"D decision has no speaker or ?: {target_id}")
        if classification not in {"D", "N"}:
            raise ValueError(f"invalid classification: {target_id}")
        if strong and _normal(speaker) in _GENERIC_ROLES:
            decision["modelSpeaker"] = speaker
            decision["speaker"] = "?"
            decision["confidence"] = "low"
            decision["basis"] = "unresolved"
            decision["outsideEvidenceUsed"] = False
            decision["guardrail"] = "generic-role-is-not-a-proper-identity"
        decisions[target_id] = decision
    missing = [target_id for target_id in expected if target_id not in decisions]
    if missing:
        raise ValueError(f"missing targets: {missing}")
    return [decisions[target_id] for target_id in expected]


def _prediction(decision: Mapping[str, Any]) -> str:
    return "/" if decision.get("classification") == "N" else str(decision.get("speaker") or "").strip()


def _same_identity(left: str, right: str) -> bool:
    left_text = _normal(left)
    right_text = _normal(right)
    if left_text == right_text:
        return True
    if left_text in _SENTINELS or right_text in _SENTINELS:
        return False
    left_tokens = set(re.findall(r"\w+", left_text, flags=re.UNICODE))
    right_tokens = set(re.findall(r"\w+", right_text, flags=re.UNICODE))
    return bool(left_tokens and right_tokens and (left_tokens <= right_tokens or right_tokens <= left_tokens))


def _needs_adjudication(left: str, right: str) -> bool:
    if _same_identity(left, right):
        return False
    if {_normal(left), _normal(right)} & _GENERIC_ROLES and "?" in {_normal(left), _normal(right)}:
        return False
    return True


def _book_pages(spans: Sequence[Mapping[str, Any]]) -> list[str]:
    page_count = max((int(span.get("page", 0)) for span in spans), default=0)
    pages: list[list[str]] = [[] for _ in range(page_count)]
    for span in spans:
        page = int(span.get("page", 0))
        if 1 <= page <= page_count:
            pages[page - 1].append(str(span.get("source", span.get("text", ""))))
    return ["".join(parts) for parts in pages]


def _sum_usage(requests: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    totals = {
        "input_tokens": 0,
        "cached_input_tokens": 0,
        "cache_write_input_tokens": 0,
        "output_tokens": 0,
    }
    for request in requests:
        usage = request.get("usage")
        if not isinstance(usage, Mapping):
            continue
        totals["input_tokens"] += int(usage.get("input_tokens", usage.get("prompt_tokens", 0)) or 0)
        totals["output_tokens"] += int(usage.get("output_tokens", usage.get("completion_tokens", 0)) or 0)
        details = usage.get("input_tokens_details", usage.get("prompt_tokens_details", {}))
        if isinstance(details, Mapping):
            totals["cached_input_tokens"] += int(details.get("cached_tokens", 0) or 0)
            totals["cache_write_input_tokens"] += int(
                details.get("cache_write_tokens", details.get("cache_creation_tokens", 0)) or 0
            )
    return totals


def _usage_cost(config: RemoteTextModelConfig, usage: Mapping[str, int]) -> float:
    cached = usage["cached_input_tokens"]
    cache_write = usage["cache_write_input_tokens"]
    uncached = max(0, usage["input_tokens"] - cached - cache_write)
    cache_write_price = float(
        getattr(
            config,
            "cache_write_input_usd_per_million_tokens",
            config.input_usd_per_million_tokens,
        )
    )
    return (
        uncached * config.input_usd_per_million_tokens
        + cached * config.cached_input_usd_per_million_tokens
        + cache_write * cache_write_price
        + usage["output_tokens"] * config.output_usd_per_million_tokens
    ) / 1_000_000


def _response_text(response: Mapping[str, Any]) -> str:
    chunks = []
    for item in response.get("output", []):
        if not isinstance(item, Mapping) or item.get("type") != "message":
            continue
        for part in item.get("content", []):
            if isinstance(part, Mapping) and part.get("type") == "output_text":
                chunks.append(str(part.get("text") or ""))
    text = "".join(chunks).strip()
    if not text:
        raise DialogueContractError("Luna returned neither function calls nor output text")
    return text


def _empty_result(
    scan: Mapping[str, Any],
    strategy: str,
    attribution_targets: Sequence[str],
) -> dict[str, Any]:
    result = resolve_dialogue(
        scan,
        strategy,
        lambda *_args: "?",
        attribution_targets,
        attribution_origin=f"remote:{POLICY_ID}",
        validate_focused_evidence=False,
    )
    result["attributionRoute"] = "remote"
    result["attributionChecks"] = []
    result["resultSummary"].update(attribution_summary([], 0))
    return result


def _compact(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _normal(value: Any) -> str:
    return _compact(str(value or "")).casefold()


def _bounded(text: str, max_characters: int) -> str:
    if len(text) <= max_characters:
        return text
    return text[: max(0, max_characters - 64)].rstrip() + "\n… tool result truncated by controller …"
