import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PresentationRoot } from './PresentationRoot'

describe('presentation boundary', () => {
  it('keeps a proposed palette local to its own root', () => {
    render(<><PresentationRoot data-testid="baseline">Baseline</PresentationRoot><PresentationRoot data-testid="proposal" palette={{ action: '#123456', actionHover: '#234567' }}>Proposal</PresentationRoot></>)
    expect(screen.getByTestId('baseline').style.getPropertyValue('--color-action')).toBe('')
    expect(screen.getByTestId('proposal').style.getPropertyValue('--color-action')).toBe('#123456')
    expect(screen.getByTestId('proposal').style.getPropertyValue('--color-action-hover')).toBe('#234567')
  })

  it('rejects nesting instead of claiming CSS ancestor isolation', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<PresentationRoot><PresentationRoot>Nested</PresentationRoot></PresentationRoot>)).toThrow('Presentation roots cannot be nested')
    } finally { error.mockRestore() }
  })
})
