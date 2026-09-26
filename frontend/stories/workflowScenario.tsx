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
    return fixture;
  }, [scenario]);
  return <App key={scenario} gateway={gateway} appearance={appearance} />;
}
