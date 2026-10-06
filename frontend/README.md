# Meowdiobooks frontend

React + TypeScript + Vite wizard. The HTTP client uses `/api`; production contains no mock-data fallback. Brand artwork is served locally and typography uses an offline-safe editorial system stack.

```bash
npm ci
npm run dev
npm test
npm run lint
npm run build
```

Vite proxies `/api` to `http://127.0.0.1:8000` in development. The production build is emitted to `dist/` for FastAPI to serve.

## Component and browser review

`npm run storybook` renders production components with deterministic synthetic gateways.
`npm run studio` opens the same workflow compositions in a manual fixture preview. These entries
use synthetic data and silent audio; they do not establish backend generation behavior.

```bash
npm run storybook:check
npm run test-storybook
npm run build-storybook
npm run test:consumer
npm run visual:review -- ../.review-evidence/canonical
```

Browser checks require Playwright Chromium (`npx playwright install chromium`). They inspect
desktop and phone layouts, keyboard behavior, accessibility and public host composition. Individual
scripts accept a preview URL and output location; generated screenshots, recordings and reports
belong in `.review-evidence/` at the repository root or a temporary directory. The source page used
by `verify-review-extract.mjs` is a retained [public-domain fixture](../docs/ASSET_PROVENANCE.md).

The [design system](DESIGN_SYSTEM.md), [appearance contract](../docs/APPEARANCE.md) and
[interaction decisions](../docs/INTERACTION_DECISIONS.md) describe current source behavior.
