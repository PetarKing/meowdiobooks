# Matcha & Cherry Sanctuary

Current local design candidate on `codex/studio-rebuild`, following the user's selection of Matcha & Cherry with Japanese-inspired maximalism and the reading cat as a local kami. The original cat remains recognizable; the home sanctuary is imagined and richly illustrated. Light/Dark/System stays functional throughout. This direction supersedes rejected Folio and Nocturne visuals; it preserves the improved workflow compositions and public host contracts.

## Open and edit

- [Safe manual preview](http://127.0.0.1:5179/studio.html): 40 synthetic workflow states, both appearances, locale switching.
- [Storybook workshop](http://127.0.0.1:6006/): production components, editable component controls, product scenarios and palette isolation.
- [Production design system](../../frontend/DESIGN_SYSTEM.md): authoritative tokens, art, ownership and compatibility.
- [Requirement audit](CANDIDATE-AUDIT.md), [validation and scope](REVIEW.md), [independent critique](evidence/independent/REVIEW.md), [image-generation prompt](ART-PROMPT.md).

Restart locally:

```sh
npm --prefix frontend run storybook
npm --prefix frontend run studio
```

Edit `frontend/src/styles/appearance.css` for light/dark semantic colors, `styles/studio.css` for the shell and entrance framing, `styles/pages.css` for page compositions, and `pages/`/`components/` for live content. `StudioHero.tsx` owns the final sanctuary WebP. Existing `PresentationRoot` semantic palette values remain optional and scoped; controls do not import the bitmap. The home illustration has a finite hover response, disabled with reduced motion, and no animation loop or GPU allocation.

## Current interaction clips

[Appearance and sanctuary](clips/appearance-and-sanctuary.webm), [required voice review](clips/required-voice-phone.webm), [saved-audio failure](clips/generation-failure-phone.webm), and [audition selection/approval](clips/audition-selection-phone.webm) record the actual synthetic controls in this design.

## Evidence ownership

The local source checkpoint includes the implementation, review notes, compact verification receipts, representative views and interaction clips. The complete generated capture matrix and original PNG remain in this workspace as inspection artifacts; they are preserved rather than added wholesale to the source checkpoint. Commands and matrix scopes in `REVIEW.md` allow reproduction.

## State

Implemented and locally validated. Aesthetic approval remains a user judgment; neither tests nor the chosen palette prove an S-tier result. No push, merge, release or deployment has occurred. Fixtures use synthetic data and silent audio; they do not prove real backend generation or filesystem export.
