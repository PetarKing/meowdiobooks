import { useTranslation } from 'react-i18next'
import type { Appearance } from '../app/useAppearance'

export function ThemeToggle({ appearance, onChange }: { appearance: Appearance; onChange: (appearance: Appearance) => void }) {
  const { t } = useTranslation()
  return <label className="theme-toggle">
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg>
    <span className="theme-label">{t('Appearance')}</span>
    <select aria-label={t('Appearance')} value={appearance} onChange={(event) => onChange(event.target.value as Appearance)}>
      <option value="light">{t('Light')}</option><option value="dark">{t('Dark', { context: 'appearance' })}</option><option value="system">{t('System')}</option>
    </select>
  </label>
}
