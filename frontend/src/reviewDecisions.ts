import { reviewOccurrenceActions, reviewUsesOccurrenceDecisions } from "./workflow/review";
import type { ReviewCapability, ReviewWarning, ReviewWarningDecision, WorkflowGateway } from "./api/contracts";

export async function buildReviewWarningDecisions(
  bookId: string,
  revision: string,
  warnings: ReviewWarning[],
  selectedActions: Record<string, ReviewCapability>,
  previewBulk: WorkflowGateway["previewReviewBulk"],
): Promise<ReviewWarningDecision[]> {
  const decisions: ReviewWarningDecision[] = [];
  for (const warning of warnings) {
    if (reviewUsesOccurrenceDecisions(warning)) {
      for (const row of warning.occurrences) {
        const action = selectedActions[row.id];
        if (!reviewOccurrenceActions(warning, row).includes(action)) throw new Error("Choose a supported action for each review occurrence");
        decisions.push({ occurrenceIds: [row.id], action, provenance: "user" });
      }
      continue;
    }
    const action = selectedActions[warning.id];
    const pending = new Set(warning.occurrences.map((row) => row.id));
    while (pending.size > 0) {
      const seed = pending.values().next().value as string;
      if (pending.size === 1) {
        decisions.push({ occurrenceIds: [seed], action, provenance: "user" });
        pending.delete(seed);
        continue;
      }
      const preview = await previewBulk(bookId, revision, seed, action);
      const signedTargets = Array.isArray(preview.targetOccurrenceIds)
        ? preview.targetOccurrenceIds.map(String).filter((id) => pending.has(id))
        : [];
      if (!signedTargets.includes(seed)) {
        throw new Error("Bulk preview did not include its requested warning occurrence");
      }
      decisions.push({
        occurrenceIds: signedTargets,
        action,
        provenance: "user",
        ...(signedTargets.length > 1 ? { previewToken: preview.previewToken } : {}),
      });
      signedTargets.forEach((id) => pending.delete(id));
    }
  }
  return decisions;
}

export function buildReviewPreviewPolicies(warnings: ReviewWarning[], selectedActions: Record<string, ReviewCapability>) {
  return {
    policies: warnings.filter((warning) => !reviewUsesOccurrenceDecisions(warning) && selectedActions[warning.id])
      .map((warning) => ({ warningId: warning.id, action: selectedActions[warning.id] })),
    occurrencePolicies: warnings.filter(reviewUsesOccurrenceDecisions).flatMap((warning) =>
      warning.occurrences.filter((row) => reviewOccurrenceActions(warning, row).includes(selectedActions[row.id]))
        .map((row) => ({ occurrenceId: row.id, action: selectedActions[row.id] }))),
  };
}
