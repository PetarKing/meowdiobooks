import { useTranslation } from 'react-i18next'
import { useAppearance, type Appearance } from '../app/useAppearance'

/** One quiet control; System is the initial preference until the user chooses. */
export function ThemeToggle({ appearance, onChange }: { appearance: Appearance; onChange: (appearance: Appearance) => void }) {
  const { t } = useTranslation()
  const { resolvedAppearance } = useAppearance(appearance)
  const dark = resolvedAppearance === 'dark'
  return <button type="button" className="theme-toggle" aria-label={t('Toggle dark mode')} aria-pressed={dark} title={t(dark ? 'Switch to light mode' : 'Switch to dark mode')} onClick={() => onChange(dark ? 'light' : 'dark')}>
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{dark ? <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>}</svg>
  </button>
}
