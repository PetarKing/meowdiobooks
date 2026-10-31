import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appearanceOverrideDuration, appearanceStorageKey, useAppearance } from './useAppearance'

const now = new Date('2026-10-04T10:00:00Z')
const savedOverride = (appearance: 'light' | 'dark', expiresAt = Date.now() + appearanceOverrideDuration) => JSON.stringify({ appearance, expiresAt })

function mockDeviceTheme(dark = false) {
  let listener = () => {}
  const media = {
    matches: dark,
    addEventListener: vi.fn((_event, callback) => { listener = callback }),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  return { media, change: (matches: boolean) => act(() => { media.matches = matches; listener() }) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  mockDeviceTheme()
})
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('browser appearance preference', () => {
  it('follows the device at startup and restores only an unexpired timestamped override', () => {
    mockDeviceTheme(true)
    expect(renderHook(() => useAppearance()).result.current.resolvedAppearance).toBe('dark')
    window.localStorage.setItem(appearanceStorageKey, savedOverride('light'))
    const saved = renderHook(() => useAppearance())
    expect(saved.result.current.resolvedAppearance).toBe('light')
    saved.unmount()
    vi.setSystemTime(Date.now() + appearanceOverrideDuration)
    expect(renderHook(() => useAppearance()).result.current.appearance).toBe('system')
  })

  it.each(['dark', 'light', 'system', 'purple', 'null', '{}', '{"appearance":"dark","expiresAt":"tomorrow"}', '{"appearance":"system","expiresAt":1791151200000}'])(
    'ignores malformed or unknown-age legacy storage: %s', value => {
      window.localStorage.setItem(appearanceStorageKey, value)
      expect(renderHook(() => useAppearance()).result.current.appearance).toBe('system')
    },
  )

  it('persists each manual choice for 12 hours and returns to the current device theme live', () => {
    const device = mockDeviceTheme()
    const { result } = renderHook(() => useAppearance())
    act(() => result.current.setAppearance('dark'))
    expect(JSON.parse(window.localStorage.getItem(appearanceStorageKey)!)).toEqual({ appearance: 'dark', expiresAt: now.getTime() + appearanceOverrideDuration })
    act(() => vi.advanceTimersByTime(appearanceOverrideDuration - 1))
    expect(result.current.resolvedAppearance).toBe('dark')
    device.change(true)
    device.change(false)
    expect(result.current.resolvedAppearance).toBe('dark')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.appearance).toBe('system')
    expect(result.current.resolvedAppearance).toBe('light')
    device.change(true)
    expect(result.current.resolvedAppearance).toBe('dark')
  })

  it('rejects expired and implausibly distant saved deadlines', () => {
    for (const expiresAt of [Date.now(), Date.now() - 1, Date.now() + appearanceOverrideDuration + 1]) {
      window.localStorage.setItem(appearanceStorageKey, savedOverride('dark', expiresAt))
      const hook = renderHook(() => useAppearance())
      expect(hook.result.current.appearance).toBe('system')
      hook.unmount()
    }
  })

  it('renews the deadline when the user chooses again and cancels expiry when returning to system', () => {
    const { result } = renderHook(() => useAppearance())
    act(() => result.current.setAppearance('dark'))
    act(() => vi.advanceTimersByTime(6 * 60 * 60 * 1000))
    act(() => result.current.setAppearance('light'))
    act(() => vi.advanceTimersByTime(6 * 60 * 60 * 1000))
    expect(result.current.appearance).toBe('light')
    act(() => result.current.setAppearance('system'))
    expect(window.localStorage.getItem(appearanceStorageKey)).toBeNull()
    expect(result.current.appearance).toBe('system')
    act(() => vi.advanceTimersByTime(appearanceOverrideDuration))
    expect(result.current.appearance).toBe('system')
  })

  it.each(['focus', 'visibilitychange'])('expires a sleeping-tab choice and refreshes device theme on %s', event => {
    const { media } = mockDeviceTheme()
    const { result } = renderHook(() => useAppearance())
    act(() => result.current.setAppearance('light'))
    // Moving the wall clock without running timers models a suspended tab or device.
    vi.setSystemTime(now.getTime() + appearanceOverrideDuration)
    media.matches = true
    act(() => (event === 'focus' ? window : document).dispatchEvent(new Event(event)))
    expect(result.current.appearance).toBe('system')
    expect(result.current.resolvedAppearance).toBe('dark')
  })

  it('synchronizes other tabs, respects their remaining lifetime, and handles a cleared store', () => {
    const { result } = renderHook(() => useAppearance())
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: appearanceStorageKey, newValue: savedOverride('dark', Date.now() + 1000), storageArea: window.localStorage })))
    expect(result.current.resolvedAppearance).toBe('dark')
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.appearance).toBe('system')
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: appearanceStorageKey, newValue: savedOverride('dark') })))
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: null })))
    expect(result.current.resolvedAppearance).toBe('dark')
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: appearanceStorageKey, newValue: null, storageArea: window.sessionStorage })))
    expect(result.current.resolvedAppearance).toBe('dark')
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null })))
    expect(result.current.appearance).toBe('system')
  })

  it('refreshes saved preferences when a tab returns to focus', () => {
    const { result } = renderHook(() => useAppearance())
    window.localStorage.setItem(appearanceStorageKey, savedOverride('dark'))
    act(() => window.dispatchEvent(new Event('focus')))
    expect(result.current.resolvedAppearance).toBe('dark')
  })

  it('retains an in-memory choice when writes are blocked, including wake, and still expires it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useAppearance())
    act(() => result.current.setAppearance('dark'))
    act(() => window.dispatchEvent(new Event('focus')))
    expect(result.current.resolvedAppearance).toBe('dark')
    act(() => vi.advanceTimersByTime(appearanceOverrideDuration))
    expect(result.current.appearance).toBe('system')
  })

  it('uses device appearance when reads are blocked and allows temporary manual choices', () => {
    mockDeviceTheme(true)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useAppearance())
    expect(result.current.resolvedAppearance).toBe('dark')
    act(() => result.current.setAppearance('light'))
    expect(result.current.resolvedAppearance).toBe('light')
    act(() => vi.advanceTimersByTime(appearanceOverrideDuration))
    expect(result.current.resolvedAppearance).toBe('dark')
  })

  it('keeps controlled host preferences authoritative beyond 12 hours without writing storage', () => {
    window.localStorage.setItem(appearanceStorageKey, savedOverride('dark'))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    const changed = vi.fn()
    const { result, rerender } = renderHook(({ appearance }) => useAppearance(appearance, changed), { initialProps: { appearance: 'light' as 'light' | 'dark' } })
    act(() => result.current.setAppearance('dark'))
    expect(changed).toHaveBeenCalledWith('dark')
    act(() => vi.advanceTimersByTime(appearanceOverrideDuration))
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: appearanceStorageKey, newValue: null })))
    expect(result.current.resolvedAppearance).toBe('light')
    expect(setItem).not.toHaveBeenCalled()
    expect(removeItem).not.toHaveBeenCalled()
    rerender({ appearance: 'dark' })
    expect(result.current.resolvedAppearance).toBe('dark')
  })

  it('follows device changes in controlled system mode and cleans up timers and listeners', () => {
    const device = mockDeviceTheme()
    const { result, unmount } = renderHook(() => useAppearance('system'))
    device.change(true)
    expect(result.current.resolvedAppearance).toBe('dark')
    unmount()
    expect(device.media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    const setTimeout = vi.spyOn(window, 'setTimeout')
    const clearTimeout = vi.spyOn(window, 'clearTimeout')
    const local = renderHook(() => useAppearance())
    act(() => local.result.current.setAppearance('dark'))
    const expiryTimer = setTimeout.mock.results.at(-1)!.value
    expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), appearanceOverrideDuration)
    local.unmount()
    expect(clearTimeout).toHaveBeenCalledWith(expiryTimer)
  })
})
