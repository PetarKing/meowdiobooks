import { useEffect, useRef, useState } from "react";
import { WorkflowScenario } from "../stories/workflowScenario";
import { enterScenario } from "../stories/enterScenario";
import { scenarios, type ScenarioId } from "./fixtures";

export function StudioPreviewApp() {
  const [scenario, setScenario] = useState<ScenarioId>("home");
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    setReady(false); setFailure("");
    if (frame.current) void enterScenario(frame.current, scenario).then(() => { if(current) { window.scrollTo(0,0); setReady(true); } }).catch((error: unknown) => { if(current) setFailure(String(error)); });
    return () => { current = false; };
  }, [scenario]);
  return <>
    <aside className="preview-controls" aria-label="Design preview controls">
      <a href={import.meta.env.VITE_STORYBOOK_URL || "http://127.0.0.1:6006/"} target="_blank" rel="noreferrer">Component workshop ↗</a>
      <label>Preview <select disabled={!ready && !failure} value={scenario} onChange={event=>setScenario(event.target.value as ScenarioId)}>{scenarios.map(({id,label})=><option key={id} value={id}>{label}</option>)}</select></label>
      <span role="status">{failure ? "Could not prepare this state" : ready ? "Synthetic data · safe to explore" : "Preparing screen…"}</span>
    </aside>
    {failure && <pre className="preview-error" role="alert">{failure}</pre>}
    <div ref={frame}><WorkflowScenario key={scenario} scenario={scenario} /></div>
  </>;
}
