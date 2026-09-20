import { createContext, useContext, type CSSProperties, type HTMLAttributes } from 'react'

const PresentationBoundary = createContext(false)

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
}

/** Use sibling roots for token previews, separate frames for whole style directions. */
export function PresentationRoot({ palette, style, children, ...props }: PresentationRootProps) {
  const nested = useContext(PresentationBoundary)
  if (nested) throw new Error('Presentation roots cannot be nested. Use sibling roots or separate preview frames.')
  const tokens = Object.fromEntries(Object.entries(palette ?? {}).map(([key, value]) => [
    `--color-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value,
  ])) as CSSProperties
  return <PresentationBoundary.Provider value={true}>
    <div {...props} data-presentation-root="" style={{ ...tokens, ...style }}>{children}</div>
  </PresentationBoundary.Provider>
}
