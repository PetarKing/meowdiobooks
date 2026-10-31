import { describe, expect, it } from "vitest";
import type { CastArtifact } from "../api/contracts";
import { automaticSharedVoiceSelections } from "./cast";


describe("automaticSharedVoiceSelections", () => {
  it("preselects only the current shared candidate", () => {
    const cast: CastArtifact = {
      revision: "cast-1",
      phase: "audition-review",
      dossiers: [],
      proposals: [],
      identities: [
        {
          characterId: "guard",
          name: "Guard",
          voicePreviewRevision: "shared-1",
          voiceCandidates: [{
            revision: "shared-1",
            previewUrl: "/shared.wav",
            direction: "Supporting voice.",
            source: "shared",
            sharedVoiceGroupId: "shared-voice-01",
          }],
        },
        {
          characterId: "major",
          name: "Major",
          voicePreviewRevision: "major-1",
          voiceCandidates: [{
            revision: "major-1",
            previewUrl: "/major.wav",
            direction: "Dedicated voice.",
          }],
        },
      ],
    };

    expect(automaticSharedVoiceSelections(cast)).toEqual({ guard: "shared-1" });
  });
});
