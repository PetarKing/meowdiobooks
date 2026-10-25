export interface SourceExcerptProps {
  source: string;
  contextBefore?: string;
  contextAfter?: string;
  className?: string;
  layout?: "separate" | "passage";
  label?: string;
}

/** Preserve literal source evidence; the focused line is not a speaker attribution. */
export function SourceExcerpt({ source, contextBefore = "", contextAfter = "", className, layout = "separate", label }: SourceExcerptProps) {
  if (layout === "passage") {
    const beforeBreak = contextBefore.lastIndexOf("\n") + 1;
    const afterBreak = contextAfter.indexOf("\n");
    const afterEnd = afterBreak < 0 ? contextAfter.length : afterBreak;
    return <div className={['source-excerpt source-passage', className].filter(Boolean).join(' ')} aria-label={label}>
      <span className="source-passage-context">{contextBefore.slice(0, beforeBreak)}</span><span className="source-focus">{contextBefore.slice(beforeBreak)}<mark>{source}</mark>{contextAfter.slice(0, afterEnd)}</span><span className="source-passage-context">{contextAfter.slice(afterEnd)}</span>
    </div>;
  }
  return <div className={['source-excerpt', className].filter(Boolean).join(' ')} aria-label={label}>
    {contextBefore && <p>{contextBefore}</p>}
    <mark>{source}</mark>
    {contextAfter && <p>{contextAfter}</p>}
  </div>;
}
