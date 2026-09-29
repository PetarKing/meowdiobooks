# Cast identity review

The synthetic `cast-identities` scenario now includes two distinct source labels, **Queen of Hearts** and **Queen**. They are initially separate because a suggested match is evidence, not an automatic grouping or a mandatory confirmation. Both tiles carry a restrained gilt hint. Opening Queen of Hearts shows the source excerpt and an expanded Suggested matches section. **Attach** changes the draft identity decisions: the separate Queen tile disappears and the inspector shows two attached labels. The accepted backend Cast revision is unchanged until the later workflow action.

The identity inspector is content-sized on desktop rather than stretching to the viewport bottom. Phone keeps the full-screen editor and scrolls to the evidence. Representative captures: [desktop roster](roster-1440-light.png), [desktop suggestion](suggested-1440-light.png), [phone roster](roster-390-dark.png), [phone suggestion](suggested-390-dark.png). Both themes and widths are covered in [the browser report](report.json): Attach, no horizontal overflow, no native dialogs or API calls, no runtime errors, and no scoped axe violations.

From `frontend/`, with the local studio running:

```sh
node scripts/verify-cast-identity.mjs http://127.0.0.1:5179/studio.html ../docs/matcha-next/evidence/cast-identity
```
