# Matcha & Cherry after dark

The prior dark palette kept the canvas (`#1d261b`), paper (`#293427`), and soft surface (`#354330`) close in value and saturation. This pass uses deeper green-black canvas (`#14231f`), warmer raised paper (`#26392e`), and a clearer matcha soft surface (`#354d3b`). Warm ivory text and brighter sakura action (`#f38ead`) give the nighttime screens more lift without changing the light palette or using neon accents. Advisory gold, required coral, and ready matcha remain independent status colors.

| Surface | Before | After |
| --- | --- | --- |
| Home, 1440 | [Previous](../chrome/home-six-1440-dark.png) | [Revised](home-six-1440-dark.png) |
| Cast, 1440 | [Previous](../cast-review-states/cast-1440-dark.png) | [Revised](cast-1440-dark.png) |
| Voices, 1440 | [Previous](../cast-review-states/voices-1440-dark.png) | [Revised](voices-1440-dark.png) |
| Phone, 390 | — | [Home](home-six-390-dark.png), [Cast](cast-390-dark.png), [Voices](voices-390-dark.png), [New Voice](new-voice-390-dark.png) |

The [browser report](report.json) records sampled solid-color contrast for both appearances. In dark mode, body ink on canvas is 14.8:1; muted copy on paper 8.07:1; action on paper 5.44:1; action ink on its fill 7.2:1; success, warning, and danger on paper are 7.97:1, 7.29:1, and 6.19:1. The lighter advisory label token also cleared the tinted-badge contrast issue found during this review. Settled Cast, Voices, and Export `main` scopes report no axe violations. Home, Cast, Voices, and New Voice were rendered at 1440 and 390 pixels without horizontal overflow or runtime errors. The existing focused Voice check also found no scoped axe violations in the New Voice editor.

Host palette precedence remained intact: a temporary inline host override of action `#123456`, paper `#2f2b28`, and ink `#fafafa` resolved to those values within the dark presentation root. System preference followed live light/dark OS emulation; explicit light and dark choices overrode the OS mode. All checks used the local synthetic Studio preview, not a persisted workflow or production host.
