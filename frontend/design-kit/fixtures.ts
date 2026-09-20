/** Stable entry point for synthetic product review fixtures. */
export {
  metadataFor,
  scenarioMetadata,
  scenarios,
  type ScenarioId,
  type ScenarioMetadata,
  type ScenarioStoryAction,
  type WorkflowScenarioAction,
} from "./scenarioRegistry";
export {
  fixtureBook,
  sourceImage,
  fixtureVoiceSample,
} from "./syntheticContent";
export { snapshotFor } from "./snapshotFixture";
export { createFixtureGateway } from "./gatewayFixture";
