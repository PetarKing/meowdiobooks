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
