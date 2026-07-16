import type { ReactNode } from 'react'

export function Panel({ title, eyebrow, children, actions }: { title: string; eyebrow?: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="panel"><header className="panel-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>{actions}</header>{children}</section>
}

export function Choice({ selected, title, text, onClick, badge }: { selected?: boolean; title: string; text: string; onClick?: () => void; badge?: string }) {
  return <button type="button" className={`choice ${selected ? 'selected' : ''}`} onClick={onClick}><span className="choice-title">{title}{badge && <small>{badge}</small>}</span><span>{text}</span></button>
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'rose' }) { return <span className={`tag ${tone}`}>{children}</span> }
