import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import { ReviewSourcePage } from './ReviewSourcePage';

describe('original page inspection', () => {
  it('loads through the host media seam only on demand, bounds navigation, and returns to review', () => {
    const gateway = { sourcePageImageUrl: vi.fn((_book, page) => `/host-source-${page}.png`) };
    render(<ReviewSourcePage gateway={gateway} bookId="book-test" page={2} pageCount={3} />);
    expect(gateway.sourcePageImageUrl).not.toHaveBeenCalled();
    const trigger = screen.getByRole('button', { name: 'View original page' });
    fireEvent.click(trigger);
    expect(screen.getByRole('img', { name: 'Original PDF page 2' })).toHaveAttribute('src', '/host-source-2.png');
    fireEvent.click(screen.getByRole('button', { name: 'Next page →' }));
    expect(screen.getByRole('img', { name: 'Original PDF page 3' })).toHaveAttribute('src', '/host-source-3.png');
    expect(screen.getByRole('button', { name: 'Next page →' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '← Previous page' }));
    fireEvent.click(screen.getByRole('button', { name: '← Previous page' }));
    expect(screen.getByRole('button', { name: '← Previous page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to review' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('img', { name: 'Original PDF page 2' })).toBeInTheDocument();
  });
  it('offers a retry after media failure without requesting transcript generation or acceptance', () => {
    render(<ReviewSourcePage gateway={{}} bookId="book-test" page={1} pageCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'View original page' }));
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('alert')).toHaveTextContent('Your review choices are unchanged.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const image = screen.getByRole('img');
    expect(image).toHaveAttribute('src', '/api/books/book-test/pages/1/image');
    fireEvent.load(image);
    expect(screen.queryByText('Loading page 1…')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
