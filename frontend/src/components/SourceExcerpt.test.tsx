import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourceExcerpt } from './SourceExcerpt';

describe('source evidence', () => {
  it('preserves literal source and context without interpreting markup', () => {
    const source = '<script>untrusted</script> & “Exact words.”';
    const { container } = render(<SourceExcerpt className="ai-source-evidence" source={source} contextBefore="Before." contextAfter="After." />);
    expect(container.querySelector('mark')?.textContent).toBe(source);
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('Before.').tagName).toBe('P');
    expect(container.querySelector('div.ai-source-evidence')?.children).toHaveLength(3);
  });
  it('omits absent context instead of inventing source information', () => {
    const { container } = render(<SourceExcerpt source="Only evidence" />);
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(container.querySelector('mark')).toHaveTextContent('Only evidence');
  });
});


describe('continuous source passages', () => {
  it('keeps the source speaker and speech together without inventing labels or changing characters', () => {
    const before = 'The floorboards creaked.\n\nMARA: ';
    const source = '[said softly]';
    const after = ' Stay close. If they hear us, run.\n\nHe nodded.';
    const { container } = render(<SourceExcerpt layout="passage" label="Manuscript context" source={source} contextBefore={before} contextAfter={after} />);
    expect(screen.getByLabelText('Manuscript context').textContent).toBe(before + source + after);
    expect(container.querySelector('.source-focus')?.textContent).toBe('MARA: [said softly] Stay close. If they hear us, run.');
    expect(container.querySelector('mark')?.textContent).toBe(source);
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
  it('preserves multiline targets and literal markup at document edges', () => {
    const source = '第一章\n<script>do not interpret</script> & “words”';
    const { container } = render(<SourceExcerpt layout="passage" source={source} />);
    expect(container.querySelector('.source-passage')?.textContent).toBe(source);
    expect(container.querySelector('mark')?.textContent).toBe(source);
    expect(container.querySelector('script')).toBeNull();
  });
});
