import { useId, useState, type ReactNode } from 'react'

export function Panel({ title, eyebrow, children, actions }: { title: string; eyebrow?: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="panel"><header className="panel-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>{actions}</header>{children}</section>
}

export function Choice({ selected, title, text, onClick, badge, detail, detailLabel }: { selected?: boolean; title: string; text: string; onClick?: () => void; badge?: string; detail?: string; detailLabel?: string }) {
  const tooltipId = useId()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const detailOpen = hovered || focused

  return <div className={`choice-shell ${detail ? 'has-detail' : ''}`}>
    <button type="button" className={`choice ${selected ? 'selected' : ''}`} onClick={onClick}><span className="choice-title">{title}{badge && <small>{badge}</small>}</span><span>{text}</span></button>
    {detail && <>
      <span className="choice-info">
        <button
          type="button"
          className="choice-info-trigger"
          aria-label={detailLabel ?? title}
          aria-describedby={tooltipId}
          aria-expanded={detailOpen}
          onClick={(event) => { event.stopPropagation(); setFocused(true) }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.blur() }}
        >i</button>
      </span>
      <span id={tooltipId} role="tooltip" className={`choice-tooltip ${detailOpen ? 'visible' : ''}`} aria-hidden={!detailOpen}>{detail}</span>
    </>}
  </div>
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'rose' }) { return <span className={`tag ${tone}`}>{children}</span> }
