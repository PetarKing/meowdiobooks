# Shared roster cards and local shelf

These captures are from the local component workshop at `http://127.0.0.1:5180/studio.html` using synthetic data. The shared Cast/Voices cards use a horizontal spine-and-crescent layout on desktop and a two-column bowl-and-underline layout on phones. The monogram field has a restrained status tint bounded by the curve, with no nested card. Only the interaction changes: Cast opens identity review; Voices plays or pauses from the initials.

| Scenario | Desktop | Phone |
| --- | --- | --- |
| Cast with required, suggested, and ready states | [1440 dark](cast-1440-dark.png) | [390 light](cast-390-light.png) |
| Voices with required, pending, and approved states | [1440 dark](voices-1440-dark.png) | [390 light](voices-390-light.png) |
| Six local books on Home | [1440 dark](home-six-1440-dark.png) | [390 light](home-six-390-light.png) |
| Exact Cast editing footer | [1440 dark](editing-cast-footer-1440-dark.png) | [390 light](editing-cast-footer-390-light.png) |

Checks: production frontend build; 33 targeted Cast/Voice unit tests; browser state checks at 1440 and 390 in light and dark; a 61-member dense roster with long names, one-click apply, audition return, reclassification, and custom dialogs; Home navigation and deletion; actual synthetic audio play/pause; axe on both roster grids at desktop and phone; and exact Cast/Voices footer style measurements. No axe violations, horizontal page overflow, or browser page errors were observed in these checks. The desktop and phone footer has an open top divider with 20px and 16px content inset respectively; the phone secondary action is unboxed and retains a 44px touch target.
