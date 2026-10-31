import { useTranslation } from 'react-i18next';
import { PresentationRoot } from './PresentationRoot';
import type { ResolvedAppearance } from '../app/useAppearance';
import './AgentGuideFooter.css';

export function AgentGuideFooter({ appearance }: { appearance: ResolvedAppearance }) {
  const { i18n } = useTranslation();
  return <PresentationRoot className="agent-guide-footer" appearance={appearance}><footer><a href="/for-agents">{i18n.resolvedLanguage?.startsWith('zh') ? '智能体指南' : 'For agents'}</a></footer></PresentationRoot>;
}
