import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AgentGuideFooter } from './components/AgentGuideFooter'
import { useAppearance } from './app/useAppearance'
import './i18n'
import './styles/product.css'

const AgentGuide = lazy(() => import('./pages/AgentGuide').then(module => ({ default: module.AgentGuide })))
function LocalStudio() {
  const { appearance, resolvedAppearance, setAppearance } = useAppearance()
  return <><App appearance={appearance} onAppearanceChange={setAppearance} /><AgentGuideFooter appearance={resolvedAppearance} /></>
}

const showAgentGuide = window.location.pathname.replace(/\/$/, '') === '/for-agents'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showAgentGuide
      ? <Suspense fallback={null}><AgentGuide /></Suspense>
      : <LocalStudio />}
  </StrictMode>,
)
