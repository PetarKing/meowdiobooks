import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PhaseHelp } from './PhaseHelp'
import { PresentationRoot } from './PresentationRoot'
import '../i18n'

describe('phase help shared dialog lifecycle', () => {
  it('carries dark appearance and host visual tokens into its body portal', () => {
    render(<PresentationRoot appearance="dark" palette={{ action: '#123456' }} style={{ '--action-ink': '#fafafa', width: 400 } as React.CSSProperties}><PhaseHelp stage="extract" /></PresentationRoot>)
    fireEvent.click(screen.getByRole('button', { name: 'About Extract' }))
    const backdrop = screen.getByRole('dialog').parentElement!
    expect(backdrop.parentElement).toBe(document.body)
    expect(backdrop).toHaveAttribute('data-appearance', 'dark')
    expect(backdrop.style.getPropertyValue('--color-action')).toBe('#123456')
    expect(backdrop.style.getPropertyValue('--action-ink')).toBe('#fafafa')
    expect(backdrop.style.width).toBe('')
  })

  it('focuses the reading surface, traps keyboard focus and restores the guide trigger on Escape', () => {
    render(<PhaseHelp stage="extract" />)
    const trigger = screen.getByRole('button', { name: 'About Extract' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Check the reading order.' })
    const close = screen.getByRole('button', { name: 'Close phase guide' })
    expect(dialog).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })
})
