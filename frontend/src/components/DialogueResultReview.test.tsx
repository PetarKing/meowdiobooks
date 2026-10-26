import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dialogueFor } from '../../design-kit/dialogueFixtures';
import type { DialogueArtifact, DialogueExample } from '../api/contracts';
import { DialogueResultReview, type DialogueCorrectionDecision } from './DialogueResultReview';

const line = (spanId: string, extra: Partial<DialogueExample> = {}): DialogueExample => ({
  spanId, page: 1, source: `“${spanId}”`, spokenText: spanId,
  speakerStatus: 'unresolved', origin: 'qwen:targeted-speaker-v2', ...extra,
});
const examples = [
  line('agreed', { speakerStatus: 'ai', speakerLabel: 'Alice' }),
  line('suggested', { suggestedSpeakers: ['Alice', 'Rabbit'] }),
  line('unknown'),
  line('prose', { origin: 'qwen:not-vocalisation' }),
];
function mount(rows = examples, initialDecisions: DialogueCorrectionDecision[] = [], busy = false, onChangeStrategy = vi.fn(), speakerOptions = ['Alice', 'Rabbit', 'Hatter', 'Dormouse']) {
  const onAccept = vi.fn();
  const result: DialogueArtifact = { ...dialogueFor('standard'), examples: rows, readerAssignments: undefined, speakerOptions };
  render(<DialogueResultReview result={result} initialDecisions={initialDecisions} busy={busy} onAccept={onAccept} onChangeStrategy={onChangeStrategy} />);
  return onAccept;
}
const accept = () => screen.getByRole('button', { name: 'Continue →' });

describe('required dialogue review', () => {
  it('does not count skips or inspecting other views as decisions', () => {
    const onAccept = mount();
    expect(accept()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now →' }));
    fireEvent.click(accept());
    expect(onAccept).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.getByText('Line 2 of 3')).toBeInTheDocument();
  });

  it('accepts first suggestions, preserves agreed AI provenance and uses narrator without a guess', () => {
    const onAccept = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Accept all AI guesses' }));
    expect(screen.getByRole('heading', { name: 'Your transcript' })).toHaveFocus();
    expect(accept()).toBeEnabled();
    const breakdown = screen.getByRole('region', { name: 'By reader' });
    expect(within(breakdown).getByText('Alice').closest('.dialogue-reader-card')).toHaveTextContent('Alice2');
    expect(within(breakdown).getByRole('img', { name: '1 AI · 1 changed' })).toBeInTheDocument();
    expect(within(breakdown).getByText('Narrator', { selector: '.dialogue-reader-card span' }).closest('.dialogue-reader-card')).toHaveTextContent('Narrator1');
    expect(screen.queryByText('Review complete')).not.toBeInTheDocument();
    fireEvent.click(accept());
    expect(onAccept).toHaveBeenCalledWith([
      { spanId: 'suggested', action: 'speaker', speakerLabel: 'Alice', provenance: 'user' },
      { spanId: 'unknown', action: 'narrator', provenance: 'user' },
    ]);
  });

  it('rejects all remaining AI guesses across pages without overwriting a manual choice or narration', () => {
    const rows = [...Array.from({ length: 24 }, (_, i) => line(`ai-${i}`, { speakerStatus: 'ai', speakerLabel: 'Alice' })), examples[3]];
    const onAccept = mount(rows, [{ spanId: 'ai-0', action: 'speaker', speakerLabel: 'Rabbit', provenance: 'user' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Use narrator for remaining' }));
    fireEvent.click(accept());
    const decisions = onAccept.mock.calls[0][0] as DialogueCorrectionDecision[];
    expect(decisions).toHaveLength(24);
    expect(decisions[0]).toEqual({ spanId: 'ai-0', action: 'speaker', speakerLabel: 'Rabbit', provenance: 'user' });
    expect(decisions.slice(1).every(d => d.action === 'narrator')).toBe(true);
    expect(decisions.some(d => d.spanId === 'prose')).toBe(false);
  });

  it('shows the chosen reader and restores the original AI reader by selecting it directly', () => {
    const onAccept = mount([examples[0]], [{ spanId: 'agreed', action: 'narrator', provenance: 'user' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Check your choices' }));
    const alice = screen.getByRole('button', { name: 'Choose Alice' });
    const narrator = screen.getByRole('button', { name: 'Choose Narrator' });
    expect(alice).toHaveAttribute('aria-description', 'AI choice');
    expect(alice).toHaveTextContent('✧');
    expect(alice).not.toHaveTextContent('✓');
    expect(alice).toHaveClass('ai-option-muted');
    expect(narrator).toHaveAttribute('aria-pressed', 'true');
    expect(narrator).toHaveTextContent('✓');
    expect(screen.queryByRole('button', { name: 'Restore AI choice' })).not.toBeInTheDocument();
    fireEvent.click(alice);
    expect(alice).toHaveAttribute('aria-pressed', 'true');
    expect(alice).toHaveTextContent('✓');
    expect(alice).not.toHaveTextContent('✧');
    expect(alice).toHaveAttribute('aria-description', 'AI choice');
    expect(narrator).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Needs review 0' })).toBeInTheDocument();
    fireEvent.click(accept());
    expect(onAccept).toHaveBeenCalledWith([]);
  });

  it('preserves full source context on demand and returns editor focus on Escape', () => {
    mount([line('target', { contextBefore: 'Nearby before.', expandedContextBefore: 'Full before.', contextAfter: 'Nearby after.' })]);
    expect(screen.queryByText('Full before.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show more source context' }));
    expect(screen.getByText('Full before.')).toBeInTheDocument();
    expect(screen.getByText('Nearby after.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another character' }));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Choose another character' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Choose Narrator' }));
    expect(accept()).toBeEnabled();
  });

  it('shows the nearest 120 characters on each side and expands and collapses without losing source', () => {
    const before = 'Distant before. ' + '近'.repeat(160);
    const after = '後'.repeat(160) + ' Distant after.';
    mount([line('target', { contextBefore: before, contextAfter: after, expandedContextBefore: before, expandedContextAfter: after })]);
    const excerpt = screen.getByText('“target”').closest('.ai-source-evidence')!;
    expect(excerpt.querySelectorAll('p')[0].textContent).toBe('…' + '近'.repeat(120));
    expect(excerpt.querySelectorAll('p')[1].textContent).toBe('後'.repeat(120) + '…');
    fireEvent.click(screen.getByRole('button', { name: 'Show more source context' }));
    expect(excerpt.querySelectorAll('p')[0].textContent).toBe(before);
    expect(excerpt.querySelectorAll('p')[1].textContent).toBe(after);
    fireEvent.click(screen.getByRole('button', { name: 'Show less source context' }));
    expect(excerpt.querySelectorAll('p')[0].textContent).toBe('…' + '近'.repeat(120));
    expect(screen.getByText('“target”')).toBeInTheDocument();
  });

  it('undoes a bulk choice without losing earlier individual choices', () => {
    const onAccept = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Choose Rabbit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use narrator for remaining' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo bulk choice' }));
    expect(screen.getByText('Line 2 of 3')).toBeInTheDocument();
    expect(accept()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Accept all AI guesses' }));
    fireEvent.click(accept());
    expect(onAccept).toHaveBeenCalledWith([
      { spanId: 'suggested', action: 'speaker', speakerLabel: 'Rabbit', provenance: 'user' },
      { spanId: 'unknown', action: 'narrator', provenance: 'user' },
    ]);
  });

  it('requires the first pass before exposing navigation to the reader breakdown', () => {
    const onAccept = mount();
    expect(screen.getByRole('heading', { name: 'Your transcript' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Dialogue checks' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'By reader' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back to readers|Close/ })).not.toBeInTheDocument();
    expect(accept()).toBeDisabled();
    fireEvent.click(accept());
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Accept all AI guesses' }));
    expect(screen.queryByRole('region', { name: 'Dialogue checks' })).not.toBeInTheDocument();
    const breakdown = screen.getByRole('region', { name: 'By reader' });
    expect(within(breakdown).getByRole('group', { name: 'Reader assignment legend' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Dialogue assignment summary' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ readers/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check your choices' }));
    const back = screen.getByRole('button', { name: '← Back to readers' });
    expect(back).toBeVisible();
    fireEvent.click(back);
    expect(screen.getByRole('heading', { name: 'Your transcript' })).toHaveFocus();
    expect(screen.getByRole('region', { name: 'By reader' })).toBeInTheDocument();
  });

  it('reuses one compact card for rechecking and counts review state after every decision', () => {
    mount();
    const requiredCardClass = screen.getByText('“suggested”').closest('article')!.className;
    expect(requiredCardClass).toContain('dialogue-focused-outcome');
    fireEvent.click(screen.getByRole('button', { name: 'Accept all AI guesses' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check your choices' }));
    expect(screen.queryByRole('region', { name: 'By reader' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article')).toHaveClass('dialogue-focused-outcome');
    expect(screen.getByRole('button', { name: 'Reviewed 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs review 0' })).toBeInTheDocument();
    expect(accept()).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Needs review 0' }));
    expect(screen.getByText('No lines need review.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All 4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByRole('button', { name: 'Choose Alice' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Choose Rabbit' }));
    expect(screen.getByRole('button', { name: 'Needs review 0' })).toBeInTheDocument();
    expect(accept()).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '← Back to readers' }));
    expect(screen.getByRole('button', { name: 'Check your choices' })).toBeInTheDocument();
  });

  it('resumes at the first unchecked line when earlier choices already exist', () => {
    mount(examples, [{ spanId: 'suggested', action: 'speaker', speakerLabel: 'Rabbit', provenance: 'user' }]);
    expect(screen.getByText('“agreed”')).toBeInTheDocument();
    expect(screen.getByText('Line 2 of 3')).toBeInTheDocument();
    expect(accept()).toBeDisabled();
  });

  it('advances on first choices, but shows and edits an earlier answer without advancing', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Choose Rabbit' })).toHaveAttribute('aria-description', 'AI suggestion');
    expect(screen.getByRole('button', { name: 'Choose Alice' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Choose Rabbit' }));
    expect(screen.getByText('Line 2 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('button', { name: 'Choose Rabbit' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Choose Alice' })).toHaveClass('ai-option-muted');
    fireEvent.click(screen.getByRole('button', { name: 'Choose Alice' }));
    expect(screen.getByText('Line 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose Alice' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Choose Rabbit' })).toHaveAttribute('aria-pressed', 'false');
    expect(accept()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByText('Line 2 of 3')).toBeInTheDocument();
  });

  it('never labels narrator fallback as an AI guess, but does label an explicit AI narration decision', () => {
    mount([examples[2], examples[3]]);
    expect(screen.getByText('No AI guess')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose Narrator' })).not.toHaveAttribute('aria-description', 'AI choice');
    fireEvent.click(screen.getByRole('button', { name: 'Choose Narrator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check your choices' }));
    expect(screen.getByRole('button', { name: 'Choose Narrator' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Choose Narrator' })).not.toHaveAttribute('aria-description', 'AI choice');
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
    expect(screen.getByRole('button', { name: 'Choose Narrator' })).toHaveAttribute('aria-description', 'AI choice');
    expect(screen.queryByText('No AI guess')).not.toBeInTheDocument();
  });

  it('keeps a custom chosen reader visible as an option when revisiting the line', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another character' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Guest' } });
    fireEvent.click(screen.getByRole('option', { name: 'Guest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('button', { name: 'Choose Guest' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Choose Guest' })).toHaveTextContent('✓');
    expect(screen.getByRole('button', { name: 'Choose Alice' })).toHaveAttribute('aria-description', 'AI suggestion');
  });

  it('offers a new reader alongside partial matches without duplicating exact matches', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another character' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Hatter' } });
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Hatter']);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Hat' } });
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Hatter', 'Hat']);
    fireEvent.click(screen.getByRole('option', { name: 'Hat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('button', { name: 'Choose Hat' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('commits picker choices immediately, excludes visible readers and replaces the one extra reader', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another character' }));
    expect(screen.queryByText('Pick an existing character or type a new name.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Hatter', 'Dormouse']);
    fireEvent.click(screen.getByRole('option', { name: 'Hatter' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Line 2 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('button', { name: 'Choose Hatter' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Choose another character' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Dormouse']);
    fireEvent.click(screen.getByRole('option', { name: 'Dormouse' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Line 1 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose Hatter' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose Dormouse' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Choose Dormouse' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another character' }));
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Hatter']);
  });

  it('closes the picker by toggling or clicking outside and supports direct keyboard selection', () => {
    mount();
    const picker = screen.getByRole('button', { name: 'Choose another character' });
    fireEvent.click(picker);
    fireEvent.click(picker);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(picker);
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Your transcript' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(accept()).toBeDisabled();
    fireEvent.click(picker);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(screen.getByText('Line 2 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('button', { name: 'Choose Dormouse' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('hides the picker when every available reader is already shown', () => {
    mount([examples[1]], [], false, vi.fn(), ['Alice', 'Rabbit', 'Narrator']);
    expect(screen.queryByRole('button', { name: 'Choose another character' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose Alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose Rabbit' })).toBeInTheDocument();
  });

  it('confirms changing strategy and preserves choices when cancelled or dismissed', () => {
    const onChangeStrategy = vi.fn();
    mount(examples, [], false, onChangeStrategy);
    fireEvent.click(screen.getByRole('button', { name: 'Choose Rabbit' }));
    const trigger = screen.getByRole('button', { name: 'Change strategy' });
    fireEvent.click(trigger);
    let modal = screen.getByRole('dialog', { name: 'Change dialogue strategy?' });
    expect(within(modal).getByRole('button', { name: 'Keep reviewing' })).toHaveFocus();
    expect(onChangeStrategy).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole('button', { name: 'Keep reviewing' }));
    expect(trigger).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('button', { name: 'Choose Rabbit' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onChangeStrategy).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    modal = screen.getByRole('dialog', { name: 'Change dialogue strategy?' });
    fireEvent.click(within(modal).getByRole('button', { name: 'Change strategy' }));
    expect(onChangeStrategy).toHaveBeenCalledOnce();
  });

  it('disables decisions while acceptance is in flight' , () => {
    mount(examples, [], true);
    for (const button of within(screen.getByRole('region', { name: 'Review required' })).getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose Alice' })).toBeDisabled();
    expect(accept()).toBeDisabled();
  });

  it('permits a transcript with no AI dialogue guesses without manufacturing a review', () => {
    const onAccept = mount([examples[3]]);
    expect(screen.queryByRole('region', { name: 'Review required' })).not.toBeInTheDocument();
    expect(accept()).toBeEnabled();
    fireEvent.click(accept());
    expect(onAccept).toHaveBeenCalledWith([]);
  });
});
