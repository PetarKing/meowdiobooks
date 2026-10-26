import { useEffect, useRef, useState } from "react";
import { WorkflowScenario } from "../stories/workflowScenario";
import { enterScenario } from "../stories/enterScenario";
import { workflowStorageKey, writeWorkflowStorage } from "../src/workflow/workflowLocation";
import { scenarios, type ScenarioId } from "./fixtures";
import { HomeSceneDirectionContext, type HomeSceneDirection } from "../src/components/homeSceneDirection";
import { useAppearance } from "../src/app/useAppearance";
import { AgentGuideFooter } from "../src/components/AgentGuideFooter";

const directions = [
  { id: 'hybrid-dithercn', label: 'dithercn' },
  { id: 'hybrid', label: 'Custom SVG' },
] as const;
const previousDirections = [
  { id: 'wide-sky', label: '01 · Wide sky' },
  { id: 'moonrise', label: '02 · Moonrise' },
  { id: 'storybook', label: '03 · Storybook' },
] as const;

function resetPreviewLocation() {
  writeWorkflowStorage(workflowStorageKey("location"), null);
  writeWorkflowStorage(workflowStorageKey("activeJob"), null);
}

export function StudioPreviewApp() {
  const { appearance, resolvedAppearance, setAppearance } = useAppearance();
  const queryAppearance = new URLSearchParams(window.location.search).get('appearance');
  const forcedAppearance = queryAppearance === 'light' || queryAppearance === 'dark' ? queryAppearance : undefined;
  const [scenario, setScenario] = useState<ScenarioId>(() => { resetPreviewLocation(); return "home"; });
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [direction, setDirection] = useState<HomeSceneDirection>(() => {
    const selected = new URLSearchParams(window.location.search).get('cat');
    return [...directions, ...previousDirections].find(item => item.id === selected)?.id ?? 'hybrid-dithercn';
  });
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    setReady(false); setFailure("");
    if (frame.current) void enterScenario(frame.current, scenario).then(() => { if(current) { window.scrollTo(0,0); setReady(true); } }).catch((error: unknown) => { if(current) setFailure(String(error)); });
    return () => { current = false; };
  }, [scenario]);
  useEffect(() => { document.title = `${[...directions, ...previousDirections].find(item => item.id === direction)?.label} · Meowdiobooks preview`; }, [direction]);
  return <>
    <aside className="preview-controls" aria-label="Design preview controls">
      <nav className="preview-directions" aria-label="Home design versions">{directions.map(item => <button key={item.id} type="button" aria-pressed={direction === item.id} onClick={() => setDirection(item.id)}>{item.label}</button>)}</nav>
      <label>Preview <select disabled={!ready && !failure} value={scenario} onChange={event=>{ resetPreviewLocation(); setScenario(event.target.value as ScenarioId); }}>{scenarios.map(({id,label})=><option key={id} value={id}>{label}</option>)}</select></label>
      <span role="status">{failure ? "Could not prepare this state" : ready ? "Synthetic data · safe to explore" : "Preparing screen…"}</span>
    </aside>
    {failure && <pre className="preview-error" role="alert">{failure}</pre>}
    <HomeSceneDirectionContext.Provider value={direction}><div className="preview-product" ref={frame}><WorkflowScenario key={scenario} scenario={scenario} appearance={forcedAppearance ?? appearance} onAppearanceChange={setAppearance} /><AgentGuideFooter appearance={forcedAppearance ?? resolvedAppearance} /></div></HomeSceneDirectionContext.Provider>
  </>;
}
