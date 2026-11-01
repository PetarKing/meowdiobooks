import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import App from '../src/App';
import { createFixtureGateway, snapshotFor } from '../design-kit/fixtures';

function ReviewTranscriptLoading() {
  const gateway = useMemo(() => {
    const fixture = createFixtureGateway('review');
    const snapshot = snapshotFor('review');
    snapshot.pendingCandidates = { review: { revision: 'loading-review', status: 'candidate' } };
    fixture.getBookSnapshot = async () => structuredClone(snapshot);
    const original = fixture.getStageCandidate.bind(fixture);
    fixture.getStageCandidate = async (book, stage, revision) => {
      const candidate = await original(book, stage, revision);
      return stage === 'review' ? Object.assign(candidate, { revision: 'loading-review', warnings: [], boundaryCandidates: [] }) : candidate;
    };
    fixture.previewReviewTranscript = async () => new Promise(() => {});
    return fixture;
  }, []);
  return <App gateway={gateway} initialWorkflowLocation={{ bookId: snapshotFor('review').book.id, stepId: 'review' }} />;
}
const meta = { title: 'Product/Review transcript loading', component: ReviewTranscriptLoading } satisfies Meta<typeof ReviewTranscriptLoading>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PendingPage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Review complete transcript →' }));
    await expect(canvas.getByRole('region', { name: 'ORIGINAL PAGE' })).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'AUDIOBOOK TRANSCRIPT' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Accept review and continue →' })).toBeEnabled();
    await expect(canvasElement.querySelectorAll('.review-preview-skeleton')).toHaveLength(2);
  },
};
