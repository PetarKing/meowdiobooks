# Studio adoption candidate

The approved Matcha & Cherry design is integrated with Core foundation main
`590bcd44016dd7236a57d6612160a9bdccb73e46` in merge `4c8038470c052e09b229c8b00648ce041933689f`.
Conflicts were reviewed in explicit groups, with an independent exact-snapshot
[foundation audit](audits/03-foundation-merge.md). Main's UI export APIs, host CSS
priority checks, dialog focus lifecycle and all 31 edition copy keys are preserved.
Studio adds controlled appearance, portal propagation and current page composition.

The user-approved workflow supersedes the old explicit audition confirmation and
reverse chronology: selecting an audition applies it to the draft, generation
appends an audition, and accepting the complete Cast remains explicit. The audition
delete API remains compatible; the approved inspector does not expose a deletion
control. Native popups are replaced by the shared dialog lifecycle. Review's older
horizontal group strip becomes a semantic decision queue. Change settings prepares
the relevant review directly and leaves accepted work active until acceptance.

CSS comparison using PostCSS found no removed media selectors and only the old
global compound focus selector superseded by canonical target-specific focus rules.
Non-aesthetic layout changes in the preserved baseline are the approved shell
spacing. Active page geometry belongs to the canonical sheets listed in the design
system. No unrelated worktree or local source evidence was discarded.

## Visual validation gate

The former CI `visual:parity` gate required zero changed pixels against the PR's
old main source. That was an extraction-migration invariant, not a design acceptance
invariant; the approved new layout and palette cannot satisfy it. Comparing the
old source with new fixture headings also invalidates the old entry assertions.

CI now runs `visual:review` against the built canonical Storybook. It saves 24
representative workflow, blocking/advisory review, long-book and failure/recovery
states in both appearances at 1440 and 390 CSS pixels. Runtime errors, request
failures, horizontal document overflow and axe violations fail the gate. There are
no legacy contrast exclusions. Existing unit, Storybook browser/accessibility,
production build and packaged-host tests remain mandatory. Screenshots are
reviewable CI artifacts; a passing automated check is not aesthetic approval.

The original `visual:parity` command remains available for future source-preserving
extractions with matching fixtures. It is not used to claim this redesign has zero
visual differences from the previous design.
