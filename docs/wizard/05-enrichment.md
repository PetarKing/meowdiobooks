# Phase 5 — Enrichment (optional)

## Purpose

Attach optional presentation and experience decorators to the accepted transcript without changing
source text, dialogue boundaries, speakers, identities or voices.

## Phase contract

```text
Input:  accepted Dialogue + Cast revisions and selected decorator options
Work:   when enabled, run bounded transcript windows through Qwen
Output: optional turn states and source-linked ambience/effect ranges
Gate:   explicit skipped revision while disabled; no model work is performed
```

Example: turn `t-42` may receive state `afraid`, while ambience `rain on windows` may cover `t-40`
through `t-48`. Both are metadata; the current renderer ignores them.

## AI use — OPTIONAL TEXT MODEL

While Enrichment is unavailable, continuing creates and accepts an explicit skipped revision so the
wizard can persist completion across reloads. It performs no model request. Any future enabled state,
ambience or effect option runs Qwen once per planned bounded window.

## Options

- one bounded turn-level `state` used for both emotion and avatar/animation state;
- scene ambience descriptors;
- player/visual effect cues;
- future independently versioned decorators.

The current state vocabulary is:

```text
neutral, happy, sad, angry, afraid, surprised,
disgusted, embarrassed, determined, confused, pained, tender
```

## Bounded workload contract

Enrichment may touch every transcript span and can therefore exceed speaker-attribution work by an
order of magnitude. The current implementation therefore:

- show total spans, contextual batches, estimated time and expected model load before submit;
- use contiguous chapter/scene windows bounded by input-token and output-row budgets;
- assign one owning window per turn while overlap supplies context only;
- combine enabled turn-level decorators in one pass over the same windows;
- emit scene ambience/effects as range decorators rather than repeating them on every line;
- allow complete skip with no effect on audio generation.

## Prompt, input and output contract

The system prompt says: decorate an accepted transcript; never change IDs, speakers, identities or
text; return JSON containing only `turnStates` and `rangeDecorators`; use only the fixed state list.

One user payload has this shape:

```json
{
  "options": {"state": true, "ambience": true, "effects": false},
  "ownerTurnIds": ["t-42", "t-43"],
  "contextOnlyTurnIds": ["t-41", "t-44"],
  "turns": [
    {"id": "t-41", "text": "Rain struck the glass.", "speakerId": "narrator"},
    {"id": "t-42", "text": "Did you hear that?", "speakerId": "character:mara"},
    {"id": "t-43", "text": "Keep moving.", "speakerId": "character:vey"},
    {"id": "t-44", "text": "The latch lifted.", "speakerId": "narrator"}
  ],
  "output": {
    "turnStates": [{"turnId": "owner ID", "state": "allowed state"}],
    "rangeDecorators": [{"kind": "ambience|effect", "startTurnId": "owner ID", "endTurnId": "owner ID", "value": "brief descriptor"}]
  }
}
```

Only owner IDs are requested as output from a window; context-only turns supply continuity. When state
is enabled, the complete combined response must contain exactly one valid state row for every
transcript turn:

```json
{
  "turnStates": [
    {"turnId": "t-42", "state": "afraid"},
    {"turnId": "t-43", "state": "determined"}
  ],
  "rangeDecorators": [
    {"kind": "ambience", "startTurnId": "t-42", "endTurnId": "t-43", "value": "rain on windows"}
  ]
}
```

Invented, missing or duplicate IDs; disabled decorator kinds; invalid states; reversed/cross-chapter
ranges; or attempts to change speaker/identity fail transactional validation. No partial Enrichment
revision is published.

## Submit and processing

Qwen receives accepted transcript IDs, text, durable identities and local continuity context. Speaker
and identity fields are read-only. It returns decorators keyed to supplied turn IDs or explicit turn
ranges. Missing/duplicate/invented IDs trigger transactional retries.

## Result review

The user sees representative early/middle/late results, state distribution, scene ranges, estimated
player consequences and warnings. Enrichment results can be accepted, rerun or skipped independently.

## Downstream honesty

The current Qwen Base TTS call does not consume `state`; it is player/avatar metadata. Audible ambient
effects are not implemented until a separately approved asset, timeline and mixing contract exists.
The UI must not imply that accepting these decorators changes synthesized performance or chapter audio.

## Artifact and gate

Enrichment publishes a separate optional revision referencing accepted Dialogue and Cast revisions;
the current disabled UI publishes the explicit skipped form. Generate prepares its recording script
from either a skipped or a validated complete Enrichment revision. Changing enrichment does not
invalidate synthesized speech while no audio consumer exists.

## Tests

- skip path requires no model;
- bounded complete-book batching and workload estimates;
- one result per owning turn and valid scene ranges;
- locked speakers/identities;
- invalid/missing/duplicate IDs fail atomically;
- separate invalidation from Dialogue, Cast and audio;
- no false audible-effect claim.
