# Stylesheet ownership

`product.css` is the canonical production stylesheet entry. A host loads it once,
then its own styles. Imports stay unlayered and in their current order so ordinary
host selectors with equal specificity continue to win.

| Source | Owns |
| --- | --- |
| `appearance.css` | Root-scoped light/dark visual tokens, host palette fallbacks and native color scheme |
| `../styles.css` | Public legacy baseline geometry and domain controls; imports appearance defaults |
| `../media.css` | Inherited media, transcript and recording surfaces |
| `primitives.css` | Shared Button, Panel, Choice, Tag, SourceExcerpt and language-control presentation |
| `pages.css` | Workflow compositions and domain page presentation |
| `cast-workbench.css` | Cast collection and audition inspector geometry |
| `studio.css` | Application shell, Home sanctuary art and finite decorative transitions |
| `../components/*.css` | Existing specialized component styles and dialog focus surface |

Change the owning sheet first. Add component states to `Components.stories.tsx`,
workflow compositions to `WorkflowCompositions.stories.tsx`, and domain scenarios
to `Product.stories.tsx`. `ButtonPlayground` and `PanelPlayground` expose controls
for quick iteration. Workflow components are available from the public `ui` export.

The inherited sheets remain public through the existing `styles.css`/`media.css`
exports. Some canonical rules intentionally supersede their older declarations.
Removing those declarations would change a host using the legacy pair alone;
that is a consumer migration, not a safe cleanup. Do not silently turn the legacy
exports into aliases of the canonical entry or import both pairs in one host.

This is an incremental ownership map, not a claim that all CSS is consolidated.
The inherited domain styles are still large, and several specialized controls
still depend on them. New shared behavior belongs in real components; copying
page selectors into another direction sheet would increase that debt.

Validate shared styling changes with focused component stories, representative
1440px and 390px product renders, and `npm run test:consumer`. A structural cleanup
that should not alter presentation also needs before/after pixel comparison.
Browser appearance uses the optional controlled App preference or a local Light/Dark/System choice.
`PresentationRoot` takes an explicit light/dark appearance for isolated previews.
Palette customization continues through `PresentationRoot` semantic colors; do
not increase selector specificity to force an art direction over a host palette.
