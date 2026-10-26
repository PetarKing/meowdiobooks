import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourceExcerpt } from './SourceExcerpt';

describe('source evidence', () => {
  it('preserves the existing separate evidence layout outside compact review', () => {
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

describe('compact review passages', () => {
  it('keeps the speaker and complete speech together, without unrelated outer paragraphs', () => {
    const { container } = render(<SourceExcerpt layout="passage" label="Manuscript context" source="[said softly]" contextBefore={'The floorboards creaked.\n\nMARA: '} contextAfter={' Stay close. If they hear us, run.\n\nHe nodded.'} />);
    expect(screen.getByLabelText('Manuscript context').textContent).toBe('MARA: [said softly] Stay close. If they hear us, run.');
    expect(container.querySelector('mark')?.textContent).toBe('[said softly]');
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(screen.queryByText(/floorboards/)).not.toBeInTheDocument();
  });
  it('shows the URL in its existing paragraph without importing surrounding front matter or blank lines', () => {
    const { container } = render(<SourceExcerpt layout="passage" source="www.example.org" contextBefore={'A digital edition.\n\n\n\nRead this book online at '} contextAfter={'. Check the applicable conditions before using this edition.\n\n\n\nTitle: A Book\n\nAuthor: A Writer'} />);
    expect(container.querySelector('.source-passage')?.textContent).toBe('Read this book online at www.example.org. Check the applicable conditions before using this edition.');
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(screen.queryByText(/Title:/)).not.toBeInTheDocument();
  });
  it('gives a standalone credit one nearby paragraph on either side inside the same passage', () => {
    const { container } = render(<SourceExcerpt layout="passage" source="Credits: A Reader" contextBefore={'Language: English\n\n\n\nOther formats: www.example.org/books/11\n\n\n\n'} contextAfter={'\n\n\n\n*** START OF THE BOOK ***\n\n\n\nA Book\n\nby A Writer'} />);
    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['Other formats: www.example.org/books/11', 'Credits: A Reader', '*** START OF THE BOOK ***']);
    expect(screen.queryByText('Language: English')).not.toBeInTheDocument();
    expect(screen.queryByText('by A Writer')).not.toBeInTheDocument();
  });
  it('bounds standalone heading context and separates unanchored legacy snippets instead of gluing words', () => {
    const before = 'The previous scene ends. '.repeat(20);
    const after = 'The next scene begins. '.repeat(20);
    const { container } = render(<SourceExcerpt compact source="Chapter 1" contextBefore={before} contextAfter={after} />);
    const snippets = [...container.querySelectorAll('.source-nearby')].map((p) => p.textContent!);
    expect(snippets).toHaveLength(2);
    expect(snippets.every((text) => text.length <= 141)).toBe(true);
    expect(snippets[0].startsWith('…')).toBe(true);
    expect(snippets[1].endsWith('…')).toBe(true);
    expect(container.querySelector('.source-focus')?.textContent).toBe('Chapter 1');
    expect(container.querySelector('mark')?.textContent).toBe('Chapter 1');
  });
  it('preserves multiline broken words and verse rather than flattening manuscript lines', () => {
    const source = 'bro-\nken';
    const { container } = render(<SourceExcerpt layout="passage" source={source} contextBefore={'Another scene.\n\nA silver bell,\nA '} contextAfter={' spell,\nThe river ran.\n\nAnother scene.'} />);
    expect(container.querySelector('.source-focus')?.textContent).toBe('A silver bell,\nA bro-\nken spell,\nThe river ran.');
    expect(container.querySelector('mark')?.textContent).toBe(source);
  });
  it('retains exact target characters while hiding only surplus blank lines for display', () => {
    const source = '第一章\r\n\r\n\r\n\r\n<script>do not interpret</script> & “words”';
    const { container } = render(<SourceExcerpt layout="passage" source={source} />);
    expect(container.querySelector('mark')?.textContent).toBe(source);
    expect(container.querySelector('.source-extra-whitespace')?.textContent).toBe('\r\n\r\n');
    expect(container.querySelector('script')).toBeNull();
  });
});
