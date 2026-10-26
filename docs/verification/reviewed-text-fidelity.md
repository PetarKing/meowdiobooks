# Preserve authored prefixes and reviewed spelling

Shared Core behavior: Dialogue's builtin speaker-label recipes and Generate's accepted-text contract.
No hosted provider settings, private book fixtures, native dependencies or release versions change.

- Builtin label recipes preserve recognized chapter headings and a bounded set of structural/sign
  prefixes as authored text, including before quoted content. Custom regex recipes remain explicit
  user choices. Ordinary named speakers remain supported. Arbitrary prose-versus-speaker ambiguity
  is not solved by this bounded guard. The scanner cache version advances to 12.
- Review is the sole spelling decision stage. Generate no longer rejoins a line-break hyphen because
  the joined word appears elsewhere. This preserves UNSURE and explicit Keep through preview,
  acceptance, recording script and paced render planning; approved KEEP/JOIN repairs still work.
- Legacy audio receipts with different spelling in a chapter retaining line-break hyphens are stale
  even at identical artifact revisions. Missing receipt text cannot establish equivalence. Native
  collapsed and hosted expanded layered tracks use one text per timeline slot for comparison.
  Snapshot and Export use the same eligibility function; old audio is not rewritten.

Regression coverage includes repeated signs, chapter prefixes before quotes, genuine multiword
speaker names, custom sign-as-speaker recipes, malformed/low-confidence/rejected AI answers,
source immutability, paragraph timing, cross-chapter isolation and same-revision audio receipts.
Exact validation commands and results are recorded on the pull request under the authorized CI outage.
