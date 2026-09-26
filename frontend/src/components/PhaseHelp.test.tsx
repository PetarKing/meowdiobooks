import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PhaseHelp } from './PhaseHelp'
import '../i18n'

describe('phase help shared dialog lifecycle', () => {
  it('focuses close, traps keyboard focus and restores the guide trigger on Escape', () => {
    render(<PhaseHelp stage="extract" />)
    const trigger = screen.getByRole('button', { name: 'About Extract' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Check the reading order.' })
    const close = screen.getByRole('button', { name: 'Close phase guide' })
    expect(close).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })
})
