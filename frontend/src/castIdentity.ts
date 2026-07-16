import type { CastArtifact } from "./api/contracts";

export interface IdentityDecision {
  label: string;
  category: string;
  canonicalName: string;
  aliases: string[];
  primaryLabel?: string;
}

function comparisonKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function strongConfirmationLabelsForCast(
  cast: CastArtifact,
  decisions: Record<string, IdentityDecision>,
) {
  const groupSizes = new Map<string, number>();
  for (const proposal of cast.proposals) {
    const decision = decisions[proposal.label];
    const category = decision?.category ?? proposal.category;
    const anchor = decision?.primaryLabel || proposal.label;
    const key = `${category}:${comparisonKey(anchor)}`;
    groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1);
  }
  return cast.proposals.filter((proposal) => {
    if (!proposal.reviewRequired) return false;
    const decision = decisions[proposal.label];
    const category = decision?.category ?? proposal.category;
    const anchor = decision?.primaryLabel || proposal.label;
    const key = `${category}:${comparisonKey(anchor)}`;
    return category !== "character" || (groupSizes.get(key) ?? 0) > 1;
  }).map((proposal) => proposal.label);
}
