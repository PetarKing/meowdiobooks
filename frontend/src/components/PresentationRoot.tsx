import { useContext, type CSSProperties, type HTMLAttributes } from 'react'

import { PresentationBoundary } from './presentationContext'

/** Visual values only. Commands, content and layout belong to their components. */
export interface PresentationPalette {
  action?: string
  actionHover?: string
  ink?: string
  muted?: string
  paper?: string
  border?: string
  success?: string
  warning?: string
}

export interface PresentationRootProps extends HTMLAttributes<HTMLDivElement> {
  palette?: PresentationPalette
  appearance?: 'light' | 'dark'
}

/** Use sibling roots for token previews, separate frames for whole style directions. */
export function PresentationRoot({ palette, appearance = 'light', style, children, ...props }: PresentationRootProps) {
  const nested = useContext(PresentationBoundary)
  if (nested) throw new Error('Presentation roots cannot be nested. Use sibling roots or separate preview frames.')
  const tokens = Object.fromEntries(Object.entries(palette ?? {}).map(([key, value]) => [
    `--color-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value,
  ])) as CSSProperties
  const visualTokens = Object.fromEntries(Object.entries(style ?? {}).filter(([key]) => key.startsWith('--'))) as CSSProperties
  return <PresentationBoundary.Provider value={{ appearance, tokens: { ...tokens, ...visualTokens } }}>
    <div {...props} data-presentation-root="" data-appearance={appearance} data-presentation-palette={palette ? 'custom' : undefined} style={{ ...tokens, ...style }}>{children}</div>
  </PresentationBoundary.Provider>
}
