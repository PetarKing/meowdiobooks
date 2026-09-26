import { createContext, useContext, type CSSProperties } from 'react'

type PresentationValues = { appearance: 'light' | 'dark'; tokens: CSSProperties }
export const PresentationBoundary = createContext<PresentationValues | null>(null)

/** Portals keep the originating visual scope without styling the document or sibling roots. */
export function usePresentationPortalAttributes() {
  const scope = useContext(PresentationBoundary)
  return scope ? { 'data-presentation-root': '', 'data-appearance': scope.appearance, style: scope.tokens } : {}
}

