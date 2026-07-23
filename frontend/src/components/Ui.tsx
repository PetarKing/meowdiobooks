import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export function Panel({ title, eyebrow, children, actions }: { title: string; eyebrow?: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="panel"><header className="panel-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>{actions}</header>{children}</section>
}

export function Choice({ selected, title, text, onClick, badge, detail, detailLabel }: { selected?: boolean; title: string; text: string; onClick?: () => void; badge?: string; detail?: string; detailLabel?: string }) {
  const tooltipId = useId()
  const shellRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [clicked, setClicked] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const detailOpen = (hovered || focused || clicked) && !dismissed

  useEffect(() => {
    if (!clicked) return
    const dismissFromOutside = (event: PointerEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) {
        setClicked(false)
        setDismissed(true)
      }
    }
    document.addEventListener('pointerdown', dismissFromOutside)
    return () => document.removeEventListener('pointerdown', dismissFromOutside)
  }, [clicked])

  return <div ref={shellRef} className={`choice-shell ${detail ? 'has-detail' : ''}`}>
    <button type="button" className={`choice ${selected ? 'selected' : ''}`} onClick={onClick}><span className="choice-title">{title}{badge && <small>{badge}</small>}</span><span>{text}</span></button>
    {detail && <>
      <span className="choice-info">
        <button
          type="button"
          className="choice-info-trigger"
          aria-label={detailLabel ?? title}
          aria-describedby={tooltipId}
          aria-expanded={detailOpen}
          onClick={(event) => {
            event.stopPropagation()
            setClicked(!clicked)
            setDismissed(clicked)
          }}
          onFocus={() => { setFocused(true); setDismissed(false) }}
          onBlur={() => { setFocused(false); setClicked(false); setDismissed(false) }}
          onMouseEnter={() => { setHovered(true); setDismissed(false) }}
          onMouseLeave={() => setHovered(false)}
          onKeyDown={(event) => { if (event.key === 'Escape') { setClicked(false); setDismissed(true) } }}
        >i</button>
      </span>
      <span id={tooltipId} role="tooltip" className={`choice-tooltip ${detailOpen ? 'visible' : ''}`} aria-hidden={!detailOpen}>{detail}</span>
    </>}
  </div>
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'rose' }) { return <span className={`tag ${tone}`}>{children}</span> }
