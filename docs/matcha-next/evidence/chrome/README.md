# Home shelf and Generate tab review

`frontend/scripts/verify-home-chrome.mjs` drove the real local studio with an in-memory gateway. The `home` and `home-shelf` fixture states provide one and six synthetic local books. The six-book fixture includes long and Japanese-script titles and can be selected from the studio Preview menu.

The [report](report.json) records 1440px desktop and 390px phone checks in both appearances. Each pass confirmed a compact card width, a three-column/two-row desktop shelf or a single-column phone shelf, no horizontal overflow or runtime/API errors, and separate Continue/Delete actions. Deleting opens the product dialog; Escape closes it and restores focus to the book. No native browser dialog appeared.

The Generate tab check uses both pointer and keyboard input. Pointer selection leaves no persistent focus box. Arrow navigation retains a visible, rounded-surface/four-pixel-underline focus indication without the inherited side borders. See [desktop light](tabs-keyboard-1440-light.png) and [phone dark](tabs-keyboard-390-dark.png), plus [six-book desktop](home-six-1440-light.png), [six-book phone](home-six-390-dark.png), and [one-book desktop](home-one-1440-light.png).

This evidence covers the synthetic UI. It does not prove PDF parsing or opening real local books.
