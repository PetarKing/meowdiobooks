# Compact home illustration — approved design

When Home has books in progress, its illustration becomes a shorter backdrop.
Desktop combines the copy, upload control, and artwork in one continuous hero;
mobile retains a full-width panoramic crop below the copy. The artwork frames
the cat and book, and the books shelf moves higher on the page. Empty Home keeps
the existing introductory layout. No workflow, gateway, or dependency change.

The user approved the revised continuous desktop composition after rejecting an
initial detached side-by-side crop. The approved design is the one shown below.

| Size | Before | After |
| --- | --- | --- |
| Mobile 390 px | [Before](mobile-before.png) | [After](mobile-after.png) |
| Desktop 1440 px | [Before](desktop-before.png) | [After](desktop-after.png) |

These actual production-source renders use deterministic synthetic book data,
the same viewport/data/appearance on both sides, and reduced motion. Baseline
is `b4560f2`; these three Home files are unchanged in the release integration
baseline `c12a225`. Original approved implementation: `43f86a3`.

At 390 px the illustration changes from 238.66 to 119.33 px (50% height); at
1440 px it changes from 487.59 to 271.84 px (55.75% height). The shelf moves up
135.33 and 223.75 px respectively. Desktop artwork now shares the full hero
bounds instead of occupying a detached column.

[Browser report](browser-report.json) covers 42 layouts: zero, one and six books;
320, 390, 768, 1024, 1280, 1440 and 1920 px; light/dark; plus Chinese at all sizes.
All render without horizontal/title overflow, page errors, or live API requests.
The existing PDF upload and Continue/Delete controls remain available.

The original implementation passed all 369 frontend tests in 33 files, ESLint
(zero errors, one existing LanguagePicker warning), TypeScript and production
build. The initial default-concurrency run had five failures; the same five
passed on the unchanged baseline and candidate with one worker, and the full
two-worker run passed. Release integration is verified separately on its exact
candidate and in the consumer host; this evidence does not claim a physical
device or authenticated live-book flow.

To inspect the integrated source locally, run Vite in studio mode and open
`/studio.html?appearance=light`; choose Home, the six-book shelf, or empty import
in the Preview selector. The fixture imports the actual production App and CSS,
uses only synthetic gateway data, and is excluded from the consumer package.
