import { useCallback, useEffect, useState } from 'react'

export type Appearance = 'light' | 'dark' | 'system'
export type ResolvedAppearance = Exclude<Appearance, 'system'>
export const appearanceStorageKey = 'meowdiobooks.appearance'
const query = '(prefers-color-scheme: dark)'
const valid = (value: unknown): value is Appearance => value === 'light' || value === 'dark' || value === 'system'

function readPreference(): Appearance {
  try {
    const value = window.localStorage.getItem(appearanceStorageKey)
    return valid(value) ? value : 'system'
  } catch { return 'system' }
}
function systemAppearance(): ResolvedAppearance {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches ? 'dark' : 'light'
}

/** Preference belongs to the browser UI, never to a book or workflow artifact. */
export function useAppearance(controlled?: Appearance, onChange?: (appearance: Appearance) => void) {
  const [preference, setPreference] = useState(readPreference)
  const [system, setSystem] = useState(systemAppearance)
  const appearance = controlled ?? preference
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(query)
    const update = () => setSystem(media.matches ? 'dark' : 'light')
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === appearanceStorageKey) setPreference(valid(event.newValue) ? event.newValue : 'system')
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  const setAppearance = useCallback((next: Appearance) => {
    if (controlled === undefined) {
      setPreference(next)
      try { window.localStorage.setItem(appearanceStorageKey, next) } catch { /* A blocked store does not prevent changing appearance. */ }
    }
    onChange?.(next)
  }, [controlled, onChange])
  return { appearance, resolvedAppearance: appearance === 'system' ? system : appearance, setAppearance }
}
