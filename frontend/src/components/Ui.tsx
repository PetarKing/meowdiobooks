import { DialogBackdrop } from "./DialogBackdrop";
import { DialogSurface } from "./DialogSurface";
import { useEffect, useId, useRef, useState, type ComponentPropsWithRef, type ReactNode, type RefObject } from 'react'

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "unstyled";
  compact?: boolean;
  /** Retains the action's label while preventing duplicate commands. */
  busy?: boolean;
};

/** Shared action control. Unstyled keeps specialized tabs, tiles and icon controls intact. */
export function Button({
  variant = "primary",
  compact = false,
  busy = false,
  className,
  type = "button",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = [
    variant === "unstyled" ? undefined : variant,
    compact ? "compact" : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes || undefined} {...props} disabled={disabled || busy} aria-busy={busy || props['aria-busy']}>
    {busy && <span className="action-spinner" aria-hidden="true" />}
    {children}
  </button>;
}

export function InspectorDialog({
  label,
  closing,
  onClose,
  onClosed,
  className,
  surfaceRef,
  children,
}: {
  label: string;
  surfaceRef?: RefObject<HTMLElement | null>;
  closing: boolean;
  onClose: () => void;
  onClosed: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <DialogBackdrop
      className={`cast-inspector-backdrop ${closing ? "closing" : ""}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <DialogSurface
        onDismiss={onClose}
        surfaceRef={surfaceRef}
        className={`cast-inspector ${className ?? ""} ${closing ? "closing" : ""}`}
        aria-label={label}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && closing) onClosed();
        }}
      >
        {children}
      </DialogSurface>
    </DialogBackdrop>
  );
}

export type PanelProps = ComponentPropsWithRef<'section'> & {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  variant?: 'surface' | 'plain' | 'inset';
};

/** One content section, with an optional surface when separation earns its place. */
export function Panel({ title, eyebrow, children, actions, variant = 'surface', className, ...props }: PanelProps) {
  return <section {...props} className={['panel', `panel-${variant}`, className].filter(Boolean).join(' ')}><header className="panel-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>{actions}</header>{children}</section>
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
    <Button variant="unstyled" type="button" className={`choice ${selected ? 'selected' : ''}`} aria-pressed={Boolean(selected)} onClick={onClick}><span className="choice-title">{title}{badge && <small>{badge}</small>}</span><span>{text}</span></Button>
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
        ><span aria-hidden="true">i</span></button>
      </span>
      <span id={tooltipId} role="tooltip" className={`choice-tooltip ${detailOpen ? 'visible' : ''}`} aria-hidden={!detailOpen}>{detail}</span>
    </>}
  </div>
}

export type TagProps = ComponentPropsWithRef<'span'> & { tone?: 'neutral' | 'good' | 'warn' | 'rose' };
export function Tag({ children, tone = 'neutral', className, ...props }: TagProps) { return <span {...props} className={['tag', tone, className].filter(Boolean).join(' ')}>{children}</span> }
