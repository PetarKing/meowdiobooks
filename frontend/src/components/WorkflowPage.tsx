import type { ReactNode } from "react";

/** A shared editorial introduction. Keep the task and its scope ahead of its controls. */
export function StepIntro({ eyebrow, title, copy, className = "" }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  copy?: ReactNode;
  className?: string;
}) {
  return <header className={`page-title workflow-intro ${className}`.trim()}>
    {eyebrow}
    <h1>{title}</h1>
    {copy && <p>{copy}</p>}
  </header>;
}

/** Empty and finished states use the same calm, legible composition. */
export function WorkflowEmpty({ title, copy, symbol = "✦", children, className = "" }: {
  title: ReactNode;
  copy?: ReactNode;
  symbol?: string;
  children?: ReactNode;
  className?: string;
}) {
  return <section className={`workflow-empty ${className}`.trim()}>
    <span className="workflow-empty-symbol" aria-hidden="true">{symbol}</span>
    <h2>{title}</h2>
    {copy && <p>{copy}</p>}
    {children && <div className="workflow-empty-action">{children}</div>}
  </section>;
}

/** A preparatory stage has one obvious action rather than an empty dashboard. */
export function WorkflowLaunch({ children }: { children: ReactNode }) {
  return <div className="stage-launch workflow-launch">
    <div className="workflow-launch-art" aria-hidden="true"><i /><i /><i /><span>✦</span></div>
    <div className="workflow-launch-action">{children}</div>
  </div>;
}
