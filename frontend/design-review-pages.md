# Workflow screen review — Nocturne studio

Reviewed against the neutral foundation (`a9b7922`), 26 September 2026. The objective is a
simple next decision, readable source evidence, and a consistent literary studio. This is a
local design proposal. Fixture rendering verifies presentation and interactions, not real
backend inference, acceptance, or provider output quality.

## Individual screen findings

| Screen / source | Finding | Implemented response |
| --- | --- | --- |
| HomePage | Import, current work and resume actions already form the right task hierarchy; existing nested Home wrapper remounts on app changes. | Root owns immersive hero/import composition; root replaced nested wrapper with stable imported page component. Existing resume and deletion semantics retained. |
| LibraryPage | Full-card blurred cover competes with text, and the artifact identity is hard to scan. | Full, unblurred cover above a clear bibliographic receipt; metadata and open/reveal actions remain edition-driven. Shared empty composition. |
| LibrarySkeleton | Loading is already announced and preserves a two-book composition. | Retained semantics, updated cover geometry with the actual book layout. |
| ExtractPage | Full-height PDF dictates an oversized proof desk and buries the action; source label contrast is weak. | Bounded, independently scrollable source/text regions with keyboard focus; explicit selected sample state; stronger labels; coherent parser hierarchy. Original source is never cropped out of the scrollable region. |
| DialoguePage | Regex and unknown-speaker configuration competes with the ordinary transcript decision. | Unknown-speaker editor follows the expanded detection rules. Default screen keeps the two reader strategies and explicit AI scope. Strategy selection is exposed to assistive technology. |
| DialogueRecoveryPage | Correctly explains the invalid source range, unchanged audio, and downstream rebuilding consequence. | Retained all explanations and single recovery action; shared introduction and source-safety treatment. |
| ReviewPage | Evidence and decision hierarchy is sound, but weak labels and numerous boxed regions obscure it. | Open evidence desk, readable source/decision type, explicit pressed state on decisions, shared no-issues composition. Source, affected scope and consequence remain adjacent. |
| ReviewTranscriptFinalCheck | Source comparison and acceptance gating are essential; PDF zoom is separate from transcript decisions. | Retained complete-book page navigation and zoom. Shared introduction and labeled, keyboard reachable comparison regions; acceptance still waits for the exact requested preview page. |
| CastPage | The audition shelf compresses seven identities into small tiles and truncates status. Final bulk approval lacks shared modal keyboard handling. | Roomy ordinary-cast shelf, deliberate dense shelf for25+ identities, live text status, stable monogram and decorative waveform; shared DialogSurface for remaining-voices confirmation. All backend acceptance guards retained. |
| GeneratePage | Useful estimates, stale audio and selection already exist; remounting loses keyboard focus. Bomb-only split cue obscures intent. | Shared roving-tab keyboard behavior, stable mounted page, labeled split action, shared modal focus/Escape lifecycle for split/player. Unavailable chapter text stays legible; card controls retain disabled state. |
| ExportPage | Decorative chapter-number tiles hide titles, making partial export harder to verify. | Named chapter rows with number/duration, checkbox description linked to title, clear selected format, full metadata editing, single export action. Shared generation-required empty state. |

## Shared compositions

`components/WorkflowPage.tsx` supplies `StepIntro`, `WorkflowLaunch`, and `WorkflowEmpty`.
The real product uses them through shared titles, launch stages, and empty states. They own
presentation only; page models and workflow commands remain unchanged. `styles/pages.css`
owns the page treatment. Root integrates the public stylesheet and consolidates the legacy
cascade after rendered verification.

## Executed evidence

- Production build passed after the page components, dialog and tab integration.
- Existing App suite:109/109 passed, including actual arrow-key/Home focus preservation in
  Generate, Escape closure of the player, named export chapters, unchanged export payload,
  and advanced dialogue configuration remaining available when opened.
- Independently inspected actual desktop screenshots of Cast voices, Extract, Generate,
  Library and Review. Initial findings (tiny cast tiles, oversized proof panes, low-contrast
  labels, cover/title overlap) were fixed and rendered again.
- Phone rendering at390px for Cast voices, Extract, Generate, Library, Review, Dialogue and
  Export: no horizontal document overflow. Library covers retain their entire aspect ratio.
  Root owns shell fixed-header geometry and final screenshot scroll reset.
- Independent reviewer is running the complete Storybook interaction/accessibility matrix;
  page-owned contrast findings were fixed without adding accessibility exceptions.

The result is reviewable. A subjective S-tier claim requires the user's judgment of the live
preview; passing tests do not certify art direction.

## Ensemble and inspector follow-up

The independent review found that60-person casts still required scanning. `CollectionToolbar`
now supplies controlled name/source-label search and status filtering to both real cast
components when more than12 identities are present. Search ignores case and diacritics;
results preserve the original identity indexes. Counts and outstanding confirmation summaries
continue to use the complete cast, so a search cannot waive required review. Narrator remains
a separate destination on the identity board. Empty results offer an explicit clear action.
The five new ordinary UI strings include Chinese translations; edition keys are unchanged.

Voice inspectors now use the same `InspectorDialog` as identity inspectors. The shared
full-viewport backdrop covers the app's header and bottom navigation; the modal traps focus,
locks background scrolling, supports Escape and restores the initiating tile. If approval
removes the tile from a filtered shelf, focus returns to search instead.

Executed follow-up: production build passed; App109 tests passed; cast component27 tests
passed, including alias/accent search, hidden-required totals, no-match recovery, keyboard
clearing, modal Escape/scroll lock, and focus restoration when an approved item leaves the
filtered collection. Independent browser review covers pointer interception and final
accessibility results.
