# Home and Library finish — 29 September 2026

Home keeps the selected temple illustration and real import controls. Local source books use a compact three-column desktop shelf with live titles, source metadata and Continue actions; phone slips grow with long titles. Delete uses a 44 px icon target and opens the existing designed confirmation. The upload arrow and icon respond locally on hover/focus without moving the whole composition.

Library pairs a genuine 3:4 cover surface with title, author, chapter scope and host-owned actions. The artwork fills its surface without an inner decorative container. Desktop covers are 148 × 197 px; phone covers are 108 × 144 px. A missing cover uses a quiet audio emblem rather than initials posing as cover artwork. Long edition titles remain fully readable. Loading follows the same composition, and the true empty state retains the sanctuary illustration.

Library request errors have a dedicated retry action. A failed initial query no longer claims that no audiobooks exist. A failed refresh preserves the last successful editions; retry never replaces those editions with a skeleton. The gateway and host action contracts remain unchanged.

## Curated rendered evidence

- [Home, six books, desktop dark](home-six-1440-dark.jpg)
- [Home, six books, phone light](home-six-390-light.jpg)
- [Library, desktop light](library-1440-light.jpg)
- [Library, phone dark](library-390-dark.jpg)

Browser JPEG exports have a different raster size from their measured CSS viewport; logical dimensions below come from the rendered DOM.

## Executed checks

- CUA browser inspection and UI-driven state selection at measured `1440 × 900` and `390 × 844`, both appearances: Home with one/six books; Library populated, empty, loading, first-load error, missing cover and refresh failure. All 32 combinations had zero horizontal overflow. [Read-only DOM measurements](render-checks.json).
- Phone product tabs are hidden. Clicking the logo returns to Home, whose Library action returns to the finished editions.
- The new delete icon opens the existing custom confirmation; Keep book cancels it. No working book was deleted during browser verification.
- Library first-error Retry was exercised against the synthetic failing gateway, and refresh failure retained two editions. A Studio-only phone preparation bug was repaired by letting the fixture observe its hidden header count before clicking the visible Home Library action.
- `npm --prefix frontend test -- --run src/App.test.tsx -t 'Library|local books|working storage'`: seven passed, including two new first-failure/retry and failed-refresh/retry regressions, missing-cover action availability, host Library actions, and working-book deletion semantics.
- `npm --prefix frontend run build`: passed; existing large-chunk warning remains.
- `npm --prefix frontend run lint`: zero errors; existing LanguagePicker Fast Refresh warning remains.
- `npm --prefix frontend run storybook:check`: passed after the fixture repair.
- Reduced-motion styles disable the new cover sheen and upload-arrow transition; this is a source check, not an OS preference change during these CUA inspections.

These are synthetic Studio and component checks. They do not establish backend generation, production adoption, merge or deployment.
