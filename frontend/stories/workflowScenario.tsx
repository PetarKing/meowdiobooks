import { useMemo } from "react";
import App from "../src/App";
import { createFixtureGateway, type ScenarioId } from "../design-kit/fixtures";
export function WorkflowScenario({ scenario }: { scenario: ScenarioId }) {
  const queryAppearance = new URLSearchParams(window.location.search).get("appearance");
  const appearance = queryAppearance === "light" || queryAppearance === "dark" ? queryAppearance : undefined;
  const gateway = useMemo(() => {
    const fixture = createFixtureGateway(scenario);
    if (new URLSearchParams(window.location.search).has("legacyMedia")) {
      delete fixture.sourcePageImageUrl;
      delete fixture.libraryCoverImageUrl;
      delete fixture.layeredVoicePreviewUrl;
    }
    if (new URLSearchParams(window.location.search).has("multipleMethods")) {
      const readSnapshot = fixture.getBookSnapshot.bind(fixture);
      fixture.getBookSnapshot = async (...args) => {
        const snapshot = await readSnapshot(...args);
        return { ...snapshot, voiceModels: [
          { id: "qwen", label: "Expressive voices", supportedLanguages: ["english", "french", "german"] },
          { id: "preview-natural", label: "Natural voices", supportedLanguages: ["english", "french", "german"] },
          { id: "preview-local", label: "Local voice design", supportedLanguages: ["english", "french", "german"] },
        ] };
      };
    }
    return fixture;
  }, [scenario]);
  return <App key={scenario} gateway={gateway} appearance={appearance} capabilities={new URLSearchParams(window.location.search).has("managedVoices") ? { showVoiceModelControls: false } : undefined} />;
}
