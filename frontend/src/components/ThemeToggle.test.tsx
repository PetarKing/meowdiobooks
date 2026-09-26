import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeToggle } from './ThemeToggle'

describe('appearance choice', () => {
  it('provides an accessible native Light, Dark and System choice', () => {
    const change = vi.fn()
    render(<ThemeToggle appearance="system" onChange={change} />)
    const choice = screen.getByRole('combobox', { name: 'Appearance' })
    expect(choice).toHaveValue('system')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Light', 'Dark', 'System'])
    fireEvent.change(choice, { target: { value: 'dark' } })
    expect(change).toHaveBeenCalledWith('dark')
  })
})
