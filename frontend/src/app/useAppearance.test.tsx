import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appearanceStorageKey, useAppearance } from './useAppearance'

afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks() })

describe('browser appearance preference', () => {
  it('restores a valid preference and gracefully ignores malformed storage', () => {
    window.localStorage.setItem(appearanceStorageKey, 'dark')
    const saved = renderHook(() => useAppearance())
    expect(saved.result.current.resolvedAppearance).toBe('dark')
    act(() => saved.result.current.setAppearance('light'))
    expect(window.localStorage.getItem(appearanceStorageKey)).toBe('light')
    window.localStorage.setItem(appearanceStorageKey, 'purple')
    expect(renderHook(() => useAppearance()).result.current.appearance).toBe('system')
  })
  it('changes the UI when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useAppearance())
    act(() => result.current.setAppearance('dark'))
    expect(result.current.resolvedAppearance).toBe('dark')
  })
  it('keeps controlled host preferences authoritative without writing local storage', () => {
    const changed = vi.fn()
    const { result, rerender } = renderHook(({ appearance }) => useAppearance(appearance, changed), { initialProps: { appearance: 'light' as 'light' | 'dark' } })
    act(() => result.current.setAppearance('dark'))
    expect(changed).toHaveBeenCalledWith('dark')
    expect(result.current.resolvedAppearance).toBe('light')
    expect(window.localStorage.getItem(appearanceStorageKey)).toBeNull()
    rerender({ appearance: 'dark' })
    expect(result.current.resolvedAppearance).toBe('dark')
  })
  it('follows system changes only when the preference is system and cleans up listeners', () => {
    let listener = () => {}
    const media = { matches: false, addEventListener: vi.fn((_event, callback) => { listener = callback }), removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const { result, unmount } = renderHook(() => useAppearance())
    act(() => { media.matches = true; listener() })
    expect(result.current.resolvedAppearance).toBe('dark')
    act(() => result.current.setAppearance('light'))
    act(() => { media.matches = false; listener() })
    expect(result.current.resolvedAppearance).toBe('light')
    unmount()
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener)
    vi.unstubAllGlobals()
  })
})
