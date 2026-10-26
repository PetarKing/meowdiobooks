import { useEffect, useRef, useState } from "react";
import { WorkflowScenario } from "../stories/workflowScenario";
import { enterScenario } from "../stories/enterScenario";
import { workflowStorageKey, writeWorkflowStorage } from "../src/workflow/workflowLocation";
import { scenarios, type ScenarioId } from "./fixtures";
import { HomeSceneDirectionContext, type HomeSceneDirection } from "../src/components/homeSceneDirection";

const directions = [
  { id: 'wide-sky', label: '01 · Wide sky' },
  { id: 'moonrise', label: '02 · Moonrise' },
  { id: 'storybook', label: '03 · Storybook' },
] as const;

function resetPreviewLocation() {
  writeWorkflowStorage(workflowStorageKey("location"), null);
  writeWorkflowStorage(workflowStorageKey("activeJob"), null);
}

export function StudioPreviewApp() {
  const [scenario, setScenario] = useState<ScenarioId>(() => { resetPreviewLocation(); return "home"; });
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [direction, setDirection] = useState<HomeSceneDirection>(() => {
    const selected = new URLSearchParams(window.location.search).get('cat');
    return directions.find(item => item.id === selected)?.id ?? 'wide-sky';
  });
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    setReady(false); setFailure("");
    if (frame.current) void enterScenario(frame.current, scenario).then(() => { if(current) { window.scrollTo(0,0); setReady(true); } }).catch((error: unknown) => { if(current) setFailure(String(error)); });
    return () => { current = false; };
  }, [scenario]);
  useEffect(() => { document.title = `${directions.find(item => item.id === direction)?.label} · Meowdiobooks preview`; }, [direction]);
  return <>
    <aside className="preview-controls" aria-label="Design preview controls">
      <nav className="preview-directions" aria-label="Home design versions">{directions.map(item => <button key={item.id} type="button" aria-pressed={direction === item.id} onClick={() => setDirection(item.id)}>{item.label}</button>)}</nav>
      <label>Preview <select disabled={!ready && !failure} value={scenario} onChange={event=>{ resetPreviewLocation(); setScenario(event.target.value as ScenarioId); }}>{scenarios.map(({id,label})=><option key={id} value={id}>{label}</option>)}</select></label>
      <span role="status">{failure ? "Could not prepare this state" : ready ? "Synthetic data · safe to explore" : "Preparing screen…"}</span>
    </aside>
    {failure && <pre className="preview-error" role="alert">{failure}</pre>}
    <HomeSceneDirectionContext.Provider value={direction}><div ref={frame}><WorkflowScenario key={scenario} scenario={scenario} /></div></HomeSceneDirectionContext.Provider>
  </>;
}
