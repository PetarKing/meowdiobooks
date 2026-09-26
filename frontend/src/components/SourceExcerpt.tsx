export interface SourceExcerptProps {
  source: string;
  contextBefore?: string;
  contextAfter?: string;
  className?: string;
}

/** Preserve source evidence verbatim; layout and typography stay with the review owner. */
export function SourceExcerpt({ source, contextBefore, contextAfter, className }: SourceExcerptProps) {
  return <div className={['source-excerpt', className].filter(Boolean).join(' ')}>
    {contextBefore && <p>{contextBefore}</p>}
    <mark>{source}</mark>
    {contextAfter && <p>{contextAfter}</p>}
  </div>;
}
