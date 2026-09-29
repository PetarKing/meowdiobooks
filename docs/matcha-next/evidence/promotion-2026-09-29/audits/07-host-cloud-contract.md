# 07 — Packaged host and companion contract audit

Date: 2026-09-29. Independent audit of Core `68fcf318be7d7f49c396d135663cbfaa8e24438d` (UI package 0.1.37) and a separate companion checkout based on `a307d0e7ee9adc9ec1df52af663b344cd980c421`, with the parent task's uncommitted host-only appearance/import/inset repairs. This audit made no repository code or Git changes.

**Result: PASS for the checked source/package contracts and synthetic host geometry.** This is not proof of release publication, verified companion pin adoption, real authentication UI, deployed PostgreSQL concurrency, payment, object-storage delivery or a deployed service.

## Executed evidence

- Independently packed the public UI with `npm pack`, unpacked into a disposable host outside both repositories, and typechecked public App, gateway, edition translations and UI exports against the fixed accepted-main host contract. **87 packed files; TypeScript passed.** Development fixtures, tests, Storybook, rejected art assets and the removed Three animation component are absent. `product.css`, legacy CSS exports and `ui` remain publicly resolvable. See `07-package-check.json`.
- Typechecked the same separate host after using public `useAppearance` to control App and host-owned appearance data. No type errors. Existing composition props, custom header/step hooks, complete edition keys and `renderLibraryActions` remain compatible.
- Ran three focused Core frontend suites with the filter `embedding|host|appearance|controlled|palette`: **10 passed, 123 deliberately not selected**. See `07-host-contract-tests.txt`.
- Ran the companion's hosted composition, voice settlement, voice reuse, casting reuse and flow, database foundation, live recipe validation and auth security suites with current Core source first on `PYTHONPATH`: **205 passed** in 18.07 seconds. One existing Starlette/httpx deprecation warning. Full output remains `/private/tmp/meow-audit07-cloud-tests.log`; no providers, production data or deployment were used.
- Exercised actual companion `PostgresModelStore.update` and current Core `_JobReporter.commit` using a recording connection double: cancellation before commit prevents the publication callback; commit before cancellation returns the published result and leaves terminal success; a throwing publication callback leaves the job uncommitted. In all cases the tenant-scoped `SELECT ... FOR UPDATE`, callback and job write use the same connection/transaction scope. See `07-publication-adapter.json`. This does **not** simulate PostgreSQL lock contention or process/transaction crashes.

## Rendered host evidence

A disposable host loads the **packed** App plus actual companion edition copy, SupportLink and host CSS. Account markup is a **synthetic surrogate** using the existing Clerk classes, dimensions and placement; the Clerk SDK was not mounted or contacted. All UI actions used CUA.

- CSS viewport **390 × 844**: brand x16–179.26, theme/language controls x215.49–328.00, account x339.00–375.00. No overlap or document overflow.
- Original CSS viewport **320 × 844**: brand x16–152.14 overlapped the controls' hitbox beginning at x145.49 by **6.65 px**. Reported to the parent; fixed in the companion's smallest-phone host inset and brand gap, without overriding shared Core palette or component styling.
- Rechecked the repair at **320 × 844**: brand x10–144.13, controls x151.48–264.00, account x269.00–305.00. Gaps are **7.35 px** and **5.00 px** respectively; scrollWidth = innerWidth = 320. See `07-packed-host-mobile-after.json` and `07-packed-host-library-320-dark-after.png`.
- Two hosted Library items render two custom **Download audiobook** buttons and **zero** local Open/Finder controls. Buttons resolve to dark cherry `rgb(244,155,182)` with ink `rgb(21,38,42)`, and edition copy says finished audiobooks are organized by chapter, rather than claiming local storage.
- Clicking the shared theme button changes the host's `data-host-appearance` to dark; the shared App is controlled through the public hook and callback. Host CSS uses its own `--host-*` values and does not redefine the Core semantic palette.
- The temporary browser tabs were closed and viewport override reset. The temporary localhost server was stopped. The disposable package/typecheck harness remains in `/private/tmp/meow-audit07-host.mjs` for a follow-up audit after the verified pin.

## Findings and remaining gates

1. **Resolved adoption blocker:** the companion originally imported only `styles.css` and `media.css`. Those compatibility exports do not load the approved canonical roster/voice-create/floating-dock/appearance rules. The parent changed the consumer to import `product.css` once before its own CSS. The disposable packed consumer verifies this entry; a real verified pin is still required.
2. **Resolved host polish issue:** separately owned auth/account/payment/support surfaces had old purple values. The parent replaced them with host-only Matcha/Cherry variables and controlled preference composition. Source inspection confirms the public hook exists and signatures align. Real Clerk popup and BillingDialog rendering were not exercised here.
3. **Resolved smallest-phone hitbox issue:** the corrected header has positive hitbox gaps at 320 px, as measured above.
4. **Backend compatibility limit:** the optional structural publication reporter adds no required provider method or HTTP contract. Direct callable reporters preserve their cooperative checkpoint behavior. The companion store supports its transaction callback contract. File publication and database commit are not a distributed crash-atomic transaction; real PostgreSQL concurrency/crash behavior needs its own explicit integration evidence.
5. **Promotion gates remain owned by the parent:** immutable Core release/tag and exact asset hashes; remote pin verification; full companion verify/container CI; actual hosted auth, payment and storage smoke checks at the promoted service. This audit does not waive those gates.
