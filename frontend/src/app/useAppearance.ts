import { useCallback, useEffect, useRef, useState } from 'react'

export type Appearance = 'light' | 'dark' | 'system'
export type ResolvedAppearance = Exclude<Appearance, 'system'>
export const appearanceStorageKey = 'meowdiobooks.appearance'
export const appearanceOverrideDuration = 12 * 60 * 60 * 1000
const query = '(prefers-color-scheme: dark)'
type Override = { appearance: ResolvedAppearance; expiresAt: number }

function parseOverride(value: string | null): Override | null {
  if (!value) return null
  try {
    const saved: unknown = JSON.parse(value)
    if (typeof saved !== 'object' || saved === null) return null
    const { appearance, expiresAt } = saved as Partial<Override>
    if ((appearance === 'light' || appearance === 'dark') && typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > Date.now() && expiresAt <= Date.now() + appearanceOverrideDuration) {
      return { appearance, expiresAt }
    }
  } catch { /* Untimestamped legacy preferences have no known remaining lifetime. */ }
  return null
}

/** Undefined means storage is unavailable, so a current in-memory choice can survive a wake. */
function readOverride(): Override | null | undefined {
  try { return parseOverride(window.localStorage.getItem(appearanceStorageKey)) }
  catch { return undefined }
}

function systemAppearance(): ResolvedAppearance {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches ? 'dark' : 'light'
}

/** Preference belongs to the browser UI, never to a book or workflow artifact. */
export function useAppearance(controlled?: Appearance, onChange?: (appearance: Appearance) => void) {
  const [override, setOverride] = useState<Override | null>(() => controlled === undefined ? readOverride() ?? null : null)
  const [system, setSystem] = useState(systemAppearance)
  const unpersisted = useRef(false)
  const appearance = controlled ?? override?.appearance ?? 'system'

  useEffect(() => {
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(query) : undefined
    const update = () => setSystem(media?.matches ? 'dark' : 'light')
    update()
    media?.addEventListener('change', update)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      media?.removeEventListener('change', update)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  useEffect(() => {
    if (controlled !== undefined) return
    const refresh = () => {
      if (!unpersisted.current) {
        const saved = readOverride()
        if (saved !== undefined) setOverride(saved)
      }
      setOverride(current => current && current.expiresAt <= Date.now() ? null : current)
    }
    const sync = (event: StorageEvent) => {
      if (event.key !== appearanceStorageKey && event.key !== null) return
      try {
        if (event.storageArea !== null && event.storageArea !== window.localStorage) return
      } catch { return /* Storage may become unavailable while this tab is open. */ }
      unpersisted.current = false
      setOverride(parseOverride(event.newValue))
    }
    refresh()
    window.addEventListener('storage', sync)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [controlled])

  useEffect(() => {
    if (controlled !== undefined || override === null) return
    const timeout = window.setTimeout(() => setOverride(null), Math.max(0, override.expiresAt - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [controlled, override])

  const setAppearance = useCallback((next: Appearance) => {
    if (controlled === undefined) {
      const saved = next === 'system' ? null : { appearance: next, expiresAt: Date.now() + appearanceOverrideDuration }
      setOverride(saved)
      try {
        if (saved === null) window.localStorage.removeItem(appearanceStorageKey)
        else window.localStorage.setItem(appearanceStorageKey, JSON.stringify(saved))
        unpersisted.current = false
      } catch { unpersisted.current = true /* A blocked store does not prevent changing appearance. */ }
    }
    onChange?.(next)
  }, [controlled, onChange])
  return { appearance, resolvedAppearance: appearance === 'system' ? system : appearance, setAppearance }
}
