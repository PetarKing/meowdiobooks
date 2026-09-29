/** Measured in unmodified d3855c3 accepted source. Only these contrast checks are inherited debt; other axe rules remain active. Remove each selector when its actual source contrast is fixed. */
export const baselineContrastExceptions: Record<string, string[]> = {
  "home": [
    ".local-assets-summary > span"
  ],
  "home-error": [
    ".local-assets-summary > span"
  ],
  "delete-dialog": [
    ".library-safe-note > b",
    ".local-assets-summary > span"
  ],
  "library": [
    ".library-count"
  ],
  "library-empty": [
    ".library-count",
    ".primary"
  ],
  "library-loading": [
    ".library-count"
  ],
  "library-error": [
    ".library-count",
    ".primary"
  ],
  "extract": [
    ".choice-title > small",
    ".page-comparison-heading > span",
    ".paper > span",
    ".primary",
    "button[aria-label=\"Extract In progress\"] > span > strong"
  ],
  "extract-accepted": [
    ".primary",
    ".summary-note",
    ".tag",
    "button[aria-label=\"Extract Complete\"] > span > strong"
  ],
  "dialogue": [
    ".good > small",
    ".narrator-outcome > span",
    ".primary",
    ".scope-count.warn",
    "button[aria-label=\"Dialogue In progress\"] > span > strong"
  ],
  "dialogue-conflicts": [
    ".conflict-help",
    "button[aria-label=\"Dialogue In progress\"] > span > strong"
  ],
  "dialogue-results": [
    ".dialogue-result-status",
    ".primary",
    ".revising > span > strong"
  ],
  "dialogue-accepted": [
    ".primary",
    ".summary-note",
    ".tag",
    "button[aria-label=\"Dialogue Complete\"] > span > strong"
  ],
  "review": [
    ".context-boundary:nth-child(1)",
    ".context-boundary:nth-child(4)",
    ".detected-span > span",
    ".revising > span > strong"
  ],
  "review-boundaries": [
    ".revising > span > strong",
    ".tag"
  ],
  "review-final": [
    ".paper-heading > span",
    ".pdf-zoom-controls > output",
    ".primary",
    ".revising > span > strong"
  ],
  "review-accepted": [
    ".primary",
    ".summary-note",
    ".tag",
    "button[aria-label=\"Review Complete\"] > span > strong"
  ],
  "cast-identities": [
    ".primary",
    "button[aria-label=\"Cast & voices In progress\"] > span > strong"
  ],
  "cast-dense": [
    ".primary",
    "button[aria-label=\"Cast & voices In progress\"] > span > strong"
  ],
  "cast-voices": [
    ".primary",
    "button[aria-label=\"Cast & voices In progress\"] > span > strong"
  ],
  "cast-voices-dense": [
    ".primary",
    "button[aria-label=\"Cast & voices In progress\"] > span > strong"
  ],
  "cast-inspector": [
    ".applied > p",
    ".candidate-applied-badge",
    ".primary",
    "button[aria-label=\"Cast & voices In progress\"] > span > strong"
  ],
  "cast-missing": [
    "button[aria-label=\"Cast & voices In progress\"] > span > strong"
  ],
  "cast-accepted": [
    ".primary",
    ".summary-note",
    ".tag",
    "button[aria-label=\"Cast & voices Complete\"] > span > strong"
  ],
  "generate": [
    ".primary",
    "button[aria-label=\"Generate Complete\"] > span > strong"
  ],
  "generate-stale": [
    ".primary",
    "button[aria-label=\"Generate Complete\"] > span > strong"
  ],
  "generate-split": [
    ".generation-selection-actions > .primary",
    ".primary[type=\"button\"]",
    "button[aria-label=\"Generate In progress\"] > span > strong"
  ],
  "generate-player": [
    ".primary",
    "button[aria-label=\"Generate Complete\"] > span > strong"
  ],
  "export": [
    ".export-summary > div > .eyebrow",
    ".export-summary > div > p",
    ".primary",
    ".selected > .export-format-copy > small",
    ".selected:nth-child(1) > .export-chapter-duration",
    ".selected:nth-child(2) > .export-chapter-duration",
    ".selected:nth-child(3) > .export-chapter-duration",
    "button[aria-label=\"Export In progress\"] > span > strong",
    "strong[aria-label=\"Approximately 6.0 MB\"]"
  ],
  "export-long-book": [
    ".export-summary > div > .eyebrow",
    ".export-summary > div > p",
    ".primary",
    ".selected > .export-format-copy > small",
    ".selected:nth-child(1) > .export-chapter-duration",
    ".selected:nth-child(10) > .export-chapter-duration",
    ".selected:nth-child(11) > .export-chapter-duration",
    ".selected:nth-child(12) > .export-chapter-duration",
    ".selected:nth-child(13) > .export-chapter-duration",
    ".selected:nth-child(14) > .export-chapter-duration",
    ".selected:nth-child(15) > .export-chapter-duration",
    ".selected:nth-child(16) > .export-chapter-duration",
    ".selected:nth-child(17) > .export-chapter-duration",
    ".selected:nth-child(18) > .export-chapter-duration",
    ".selected:nth-child(19) > .export-chapter-duration",
    ".selected:nth-child(2) > .export-chapter-duration",
    ".selected:nth-child(20) > .export-chapter-duration",
    ".selected:nth-child(3) > .export-chapter-duration",
    ".selected:nth-child(4) > .export-chapter-duration",
    ".selected:nth-child(5) > .export-chapter-duration",
    ".selected:nth-child(6) > .export-chapter-duration",
    ".selected:nth-child(7) > .export-chapter-duration",
    ".selected:nth-child(8) > .export-chapter-duration",
    ".selected:nth-child(9) > .export-chapter-duration",
    "button[aria-label=\"Export In progress\"] > span > strong",
    "strong[aria-label=\"Approximately 351.1 MB\"]"
  ],
  "phase-help": [
    ".choice-title > small",
    ".page-comparison-heading > span",
    ".paper > span",
    ".primary",
    "button[aria-label=\"Extract In progress\"] > span > strong"
  ]
};
