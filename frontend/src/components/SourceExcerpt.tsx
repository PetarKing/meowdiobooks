export interface SourceExcerptProps {
  source: string;
  contextBefore?: string;
  contextAfter?: string;
  className?: string;
  layout?: "separate" | "passage";
  compact?: boolean;
  label?: string;
}

const paragraphBreak = /\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/;
const paragraphs = (text: string) => text.split(paragraphBreak);

/** A small adjacent paragraph is enough when the target stands on its own. */
function nearby(text: string, side: "before" | "after") {
  const parts = paragraphs(text).map((part) => part.trim()).filter(Boolean);
  const paragraph = (side === "before" ? parts.at(-1) : parts[0]) ?? "";
  if (paragraph.length <= 140) return paragraph;
  if (side === "before") {
    const tail = paragraph.slice(-140);
    const boundary = tail.search(/\s/);
    return `…${boundary >= 0 ? tail.slice(boundary + 1) : tail}`;
  }
  const head = paragraph.slice(0, 140);
  const boundary = head.search(/\s+\S*$/);
  return `${boundary > 0 ? head.slice(0, boundary) : head}…`;
}

/** Collapse empty display lines while retaining every highlighted source character in the DOM. */
function compactLines(text: string) {
  return text.split(/((?:\r?\n[\t ]*){3,})/).map((part, index) => {
    if (!/^(?:\r?\n[\t ]*){3,}$/.test(part)) return part;
    const firstTwo = part.match(/^(?:\r?\n[\t ]*){2}/)![0];
    return <span key={index}>{firstTwo}<span className="source-extra-whitespace" aria-hidden="true">{part.slice(firstTwo.length)}</span></span>;
  });
}

/** Source offsets and review actions remain anchored to the original, unmodified target. */
export function SourceExcerpt({ source, contextBefore = "", contextAfter = "", className, layout = "separate", compact = false, label }: SourceExcerptProps) {
  if (layout === "passage" || compact) {
    const continuous = layout === "passage";
    const beforeParts = paragraphs(contextBefore);
    const afterParts = paragraphs(contextAfter);
    const before = continuous ? beforeParts.at(-1) ?? "" : "";
    const after = continuous ? afterParts[0] ?? "" : "";
    // An already contextualized paragraph needs no additional paragraphs around it.
    const standalone = !before.trim() && !after.trim() && source.trim().length < 180;
    const preceding = !continuous ? nearby(contextBefore, "before") : standalone ? nearby(beforeParts.slice(0, -1).join("\n\n"), "before") : "";
    const following = !continuous ? nearby(contextAfter, "after") : standalone ? nearby(afterParts.slice(1).join("\n\n"), "after") : "";
    return <div className={['source-excerpt source-passage', className].filter(Boolean).join(' ')} aria-label={label}>
      {preceding && <p className="source-nearby">{preceding}</p>}
      <p className="source-focus">{compactLines(before)}<mark>{compactLines(source)}</mark>{compactLines(after)}</p>
      {following && <p className="source-nearby">{following}</p>}
    </div>;
  }
  return <div className={['source-excerpt', className].filter(Boolean).join(' ')} aria-label={label}>
    {contextBefore && <p>{contextBefore}</p>}
    <mark>{source}</mark>
    {contextAfter && <p>{contextAfter}</p>}
  </div>;
}
