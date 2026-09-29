import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from './ThemeToggle'

describe('appearance toggle', () => {
  it('starts from system appearance and toggles through a single accessible icon', () => {
    const change = vi.fn()
    render(<ThemeToggle appearance="system" onChange={change} />)
    const toggle = screen.getByRole('button', { name: 'Toggle dark mode' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(toggle.textContent).toBe('')
    fireEvent.click(toggle)
    expect(change).toHaveBeenCalledWith('dark')
  })
  it('reflects a controlled dark appearance and toggles back to light', () => {
    const change = vi.fn()
    render(<ThemeToggle appearance="dark" onChange={change} />)
    const toggle = screen.getByRole('button', { name: 'Toggle dark mode' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(change).toHaveBeenCalledWith('light')
  })
})
