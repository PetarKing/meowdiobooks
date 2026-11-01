import type { CastArtifact, CastProposal } from "./api/contracts";

export interface IdentityDecision {
  label: string;
  category: string;
  canonicalName: string;
  aliases: string[];
  primaryLabel?: string;
}

/** Non-speaker text stays spoken by Narrator; identity conflicts still require review. */
export function narrateEditorialByDefault(proposal: CastProposal, proposals: CastProposal[]) {
  return proposal.category === "editorial"
    && !proposal.aliases?.length && !proposal.competingLabels?.length
    && !proposals.some((other) => [...(other.aliases ?? []), ...(other.competingLabels ?? [])]
      .some((label) => comparisonKey(label) === comparisonKey(proposal.label)));
}

function comparisonKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

// Only waive review for existing groups whose names form one nested chain.
// Whole tokens avoid accidental matches such as Ann / Anna; pairwise nesting
// avoids accepting John Smith / Jane Smith merely because both include Smith.
function hasNestedLabels(labels: string[]) {
  const names = labels.map((label) =>
    comparisonKey(label.normalize("NFKC")).split(/\s+/u),
  ).sort((left, right) => left.length - right.length);
  return names.every((shorter, index) => {
    if (!shorter.some(Boolean)) return false;
    if (index === names.length - 1) return true;
    const longer = names[index + 1];
    return longer.some((_, start) =>
      shorter.every((token, offset) => token === longer[start + offset]),
    );
  });
}

export function strongConfirmationLabelsForCast(
  cast: CastArtifact,
  decisions: Record<string, IdentityDecision>,
) {
  const groups = new Map<string, string[]>();
  for (const proposal of cast.proposals) {
    const decision = decisions[proposal.label];
    const category = decision?.category ?? proposal.category;
    const anchor = decision?.primaryLabel || proposal.label;
    const key = `${category}:${comparisonKey(anchor)}`;
    groups.set(key, [...(groups.get(key) ?? []), proposal.label]);
  }
  return cast.proposals.filter((proposal) => {
    if (!proposal.reviewRequired) return false;
    const decision = decisions[proposal.label];
    const category = decision?.category ?? proposal.category;
    const anchor = decision?.primaryLabel || proposal.label;
    const key = `${category}:${comparisonKey(anchor)}`;
    const labels = groups.get(key) ?? [];
    return category !== "character" || (labels.length > 1 && !hasNestedLabels(labels));
  }).map((proposal) => proposal.label);
}
