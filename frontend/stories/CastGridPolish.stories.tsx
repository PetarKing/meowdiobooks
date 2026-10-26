import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CastArtifact } from "../src/api/contracts";
import type { IdentityDecision } from "../src/castIdentity";
import { CastIdentityReview } from "../src/components/CastIdentityReview";

const names = ["Subaru Natsuki", "Petra Leyte", "Ram", "Beatrice", "Julius Juukulius", "Subaru"];
const cast: CastArtifact = {
  revision: "synthetic-grid-polish", phase: "identity-review",
  previousVoiceMatches: Object.fromEntries([names[0], names[3], names[4]].map(name => [name, { bookTitle: "Prior sample" }])),
  dossiers: names.map((label, i) => ({ label, occurrenceCount: [10,9,6,2,2,1][i], examples: [{ page: 1, source: `${label}: We can take the garden path.` }] })),
  proposals: names.map((label, i) => ({ label, canonicalName: label, category: "character", reviewRequired: i === 0, competingLabels: i === 0 ? ["Subaru"] : [] })),
};
function CastGridPolish() {
  const [decisions, setDecisions] = useState<Record<string, IdentityDecision>>(Object.fromEntries(names.map(label => [label, {label,category:"character",canonicalName:label,aliases:[],primaryLabel:label}])));
  const [resolvedLabels, setResolvedLabels] = useState<string[]>([]);
  const appearance = new URLSearchParams(location.search).get("appearance") === "dark" ? "dark" : "light";
  return <div data-presentation-root data-appearance={appearance} style={{minHeight:"100vh",padding:"24px 16px"}}><main style={{maxWidth:1100,margin:"auto"}}><h1 style={{font:"500 32px var(--font-display)",margin:"0 0 8px"}}>Build the cast.</h1><p style={{color:"var(--muted)",margin:"0 0 28px"}}>Open a cast member to check its names and source labels.</p><CastIdentityReview cast={cast} decisions={decisions} setDecisions={setDecisions} resolvedLabels={resolvedLabels} setResolvedLabels={setResolvedLabels} voiceModels={[]} voiceModel="" language="english" onVoiceModelChange={()=>{}} onLanguageChange={()=>{}} hideVoiceSettings /></main></div>;
}
const meta = {title:"Workflow/Cast grid polish",component:CastGridPolish} satisfies Meta<typeof CastGridPolish>;
export default meta;
export const WrappedMetadata: StoryObj<typeof meta> = {};
