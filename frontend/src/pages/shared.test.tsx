import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PageComparison } from './shared';

it('recovers an original image after a failed page is revisited and loads successfully', () => {
  const compare = (imageUrl: string) => <PageComparison imageUrl={imageUrl} imageAlt="Original page"
    sourcePlaceholder={<div data-testid="source-skeleton" />} rightLabel="Transcript"><p>Available text</p></PageComparison>;
  const view = render(compare('/one.png'));
  expect(screen.getByTestId('source-skeleton')).toBeInTheDocument();
  fireEvent.error(screen.getByAltText('Original page'));
  expect(screen.getByRole('status')).toHaveTextContent('The original page could not load. The transcript preview is still available.');
  expect(screen.getByText('Available text')).toBeVisible();
  view.rerender(compare('/two.png'));
  fireEvent.load(screen.getByAltText('Original page'));
  view.rerender(compare('/one.png'));
  fireEvent.load(screen.getByAltText('Original page'));
  expect(screen.getByAltText('Original page')).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByTestId('source-skeleton')).not.toBeInTheDocument();
});
