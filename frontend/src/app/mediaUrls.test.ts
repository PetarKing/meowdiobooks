import { describe, expect, it, vi } from 'vitest';
import { libraryCoverImageUrl, sourcePageImageUrl } from './mediaUrls';

describe('optional host media resolvers', () => {
  it('preserves the accepted local HTTP routes when a host supplies no resolver', () => {
    expect(sourcePageImageUrl({}, 'book-1', 17)).toBe('/api/books/book-1/pages/17/image');
    expect(libraryCoverImageUrl({}, 'export-2')).toBe('/api/library/export-2/cover');
  });

  it('uses the host result with the original resource identity', () => {
    const gateway = {
      sourcePageImageUrl: vi.fn(() => 'https://media.example/source'),
      libraryCoverImageUrl: vi.fn(() => 'https://media.example/cover'),
    };
    expect(sourcePageImageUrl(gateway, 'book-1', 17)).toBe('https://media.example/source');
    expect(gateway.sourcePageImageUrl).toHaveBeenCalledWith('book-1', 17);
    expect(libraryCoverImageUrl(gateway, 'export-2')).toBe('https://media.example/cover');
    expect(gateway.libraryCoverImageUrl).toHaveBeenCalledWith('export-2');
  });

  it('preserves the resolver receiver for gateways implemented as classes', () => {
    const gateway = {
      origin: '/host-media',
      sourcePageImageUrl(bookId: string, page: number) { return `${this.origin}/${bookId}/${page}`; },
      libraryCoverImageUrl(exportId: string) { return `${this.origin}/${exportId}`; },
    };
    expect(sourcePageImageUrl(gateway, 'book-1', 17)).toBe('/host-media/book-1/17');
    expect(libraryCoverImageUrl(gateway, 'export-2')).toBe('/host-media/export-2');
  });
});
