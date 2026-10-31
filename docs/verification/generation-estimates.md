# Generation progress and estimate clarity

The generation overlay now understands parallel renderers' aggregate completion messages as well
as sequential chapter prefixes. Counts are accepted only when the reported total matches the
requested chapter count and the completed count is bounded. “Recorded” describes completed audio
rendering without claiming it has already been published for playback.

The time label explicitly says “Estimated time left,” with an uncertainty note. Queued jobs and
running jobs reporting an audio-capacity wait show the waiting state instead of an unsupported
numeric ETA. Processing-rate arithmetic, host fallback policies, and historical samples are unchanged.

## Browser evidence

Only the synthetic Alice fixture was used. No customer books, data, account identifiers, live jobs,
or production services appear in these artifacts. The before frontend is base
`fde4f82e9f9c90ce61b4f3603c2275b191738d19`, with this PR's synthetic story component copied in and
its new-copy assertions omitted; its production source is unchanged.

The fixture restores a three-chapter job from its workflow location. Running: 20% after ten minutes,
with an aggregate message reporting one chapter completed. Waiting variants: queued or a running
capacity-wait message. The same source is exercised before and after.

| State | Before | After |
| --- | --- | --- |
| Running | 0 of 3 ready; Remaining ≈ 40 min | 1 of 3 recorded; Estimated time left ≈ 40 min |
| Queued | Remaining ≈ 4 min–13 min | Waiting to start |
| Capacity wait | Remaining ≈ 4 min–13 min | Waiting for audio capacity |

All three states were checked at 390 × 844 and 1440 × 1000, in light and dark appearances,
before and after: **24 browser captures/checks**, with zero horizontal overflow, dialog content
overflow, or uncaught browser errors. The phone captures below were visually inspected.

| Before running | After running |
| --- | --- |
| ![Incorrect completed count and unqualified remaining time](generation-estimates/before-running-phone.png) | ![Accurate recorded count and qualified time estimate](generation-estimates/after-running-phone.png) |

| Queued | Waiting for capacity |
| --- | --- |
| ![Queued job without numeric ETA](generation-estimates/after-queued-phone.png) | ![Capacity wait without numeric ETA](generation-estimates/after-waiting-for-capacity-phone.png) |

Reproduce with `npm --prefix frontend run storybook -- --port 6019 --ci`. Visit
`/iframe.html?id=workflow-generation-estimates--running&viewMode=story&appearance=dark`, substituting
`queued` or `waiting-for-capacity`, and `appearance=light`. Wait for `[data-scenario-ready]`.
The story's play function asserts the completed count, estimate label, explanatory copy, and waiting
states. The existing resume/cancel and generation-completion stories cover recovery and completion.

## Verification

macOS, Node 22; no Docker VM or model service required:

- `npm --prefix frontend test -- --run`: **600 tests passed**.
- `npm --prefix frontend run test-storybook -- stories/GenerationEstimates.stories.tsx stories/GenerationResume.stories.tsx stories/GenerationCompletion.stories.tsx stories/Product.stories.tsx`:
  **50 Chromium stories passed**, including accessibility checks.
- `npm --prefix frontend run lint`: passed with two existing Fast Refresh warnings.
- `npm --prefix frontend run build`: passed with the existing bundle-size advisory.
- `npm --prefix frontend run storybook:check`: passed.
- `git diff --check`: passed.

Unit and application tests cover aggregate count bounds and total mismatches, malformed messages,
legacy sequential statuses, terminal progress, missing context, queued jobs with stale progress,
capacity waits, observed-rate estimates, host fallback policy, and historical estimates. An independent
agent reviewed the production diff and found no correctness issue in this scope.

The public-domain PDF extraction/dialogue attribution matrix is not applicable: this changes only
presentation of existing job state, with no changes to book processing, chapter splitting, synthesis,
export, or generated artifacts. Existing synthetic/public-domain Alice workflow fixtures exercise the
affected generation surface. No throughput benchmark or voice-quality claim is made.

## Limits

This is clearer progress reporting, not faster generation or a new calibration. Estimates still use
observed elapsed time and percentage after enough progress; capacity waiting included in a backend's
`started_at` can continue to influence the estimate after rendering resumes. Aggregate count and
capacity-wait recognition use the current exact message contracts; unknown messages retain the
existing fallback behavior. A future structured progress contract could remove that dependency.
