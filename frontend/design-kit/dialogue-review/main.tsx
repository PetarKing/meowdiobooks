import { useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { createFixtureGateway } from '../fixtures';
import { dialogueCandidate } from '../dialogueFixtures';
import { enterScenario } from '../../stories/enterScenario';
import '../../src/i18n';
import '../../src/styles/product.css';

// Synthetic long-book review: real workflow UI, no provider calls or user data.
const lines = ['“We should go.”', '“The gate is still open.”', '“Did you hear that?”', '“Wait for me.”', '“I left it by the window.”', '“Then we will try again tomorrow.”'];
export function Preview() {
  const root = useRef<HTMLDivElement>(null);
  const gateway = useMemo(() => {
    const fixture = createFixtureGateway('dialogue-results');
    const original = fixture.getStageCandidate.bind(fixture);
    fixture.getStageCandidate = async (...args) => {
      if (args[1] !== 'dialogue') return original(...args);
      const base = dialogueCandidate();
      const targets = Array.from({ length: 24 }, (_, i) => ({
        id: `review-${i}`, page: i + 1, source: lines[i % lines.length], text: lines[i % lines.length].slice(1,-1),
        renderRole: 'dialogue', resolvedSpeakerLabel: i % 3 === 1 ? 'Alice' : null,
        speakerStatus: i % 3 === 1 ? 'ai' : 'unresolved', origin: 'qwen:targeted-speaker-v2',
      }));
      const knownReaders = [
        ['Hatter', 'Have some tea.'], ['Dormouse', 'I was not asleep.'],
        ['Cheshire Cat', 'Which way would you like to go?'], ['Queen of Hearts', 'Come and join the game.'],
      ].map(([label, text], i) => ({ id: `known-${i}`, page: 1, source: `${label}: [${text}]`, text,
        renderRole: 'dialogue', sourceSpeakerLabel: label, resolvedSpeakerLabel: label,
        speakerStatus: 'explicit', origin: 'regex:label-brackets' }));
      const before = 'Alice stopped at the end of the path. The White Rabbit was waiting beside a small wooden gate, turning a silver key over in his hands. Beyond the garden wall, the last light of the afternoon was fading. Neither of them had spoken for several minutes.';
      const after = 'The Rabbit looked back towards the house, then tucked the key into his coat. A distant bell sounded across the garden. Alice picked up her bag and waited while he checked the path ahead.';
      const narration = (id: string, page: number, text: string) => ({ id, page, source: text, text, renderRole: 'narration', speakerStatus: 'not-applicable', origin: 'source-partition' });
      return { ...base, spans: [...knownReaders, ...targets.flatMap(row => [narration(`before-${row.id}`, row.page, before), row, narration(`after-${row.id}`, row.page, after)])], resultSummary: { totalTurns: 28, explicitTurns: 4, aiAttributed: 8, unresolved: 16, aiSuggestedForReview: 8 },
        aiWindows: targets.map(row => ({ id: `w-${row.id}`, ownerIds: [row.id], dossiers: [{ page: row.page, target: row.source, before, after }] })),
        attributionChecks: targets.map((row,i) => ({ spanId: row.id, suggestedSpeakers: i % 3 === 0 ? ['Alice', 'White Rabbit'] : [] })),
      };
    };
    return fixture;
  }, []);
  useEffect(() => { if (root.current) void enterScenario(root.current, 'dialogue-results'); }, []);
  return <div ref={root}><App gateway={gateway} appearance={new URLSearchParams(location.search).get('appearance') === 'dark' ? 'dark' : 'light'} /></div>;
}
window.history.pushState = () => {};
window.history.replaceState = () => {};
createRoot(document.getElementById('root')!).render(<Preview />);
