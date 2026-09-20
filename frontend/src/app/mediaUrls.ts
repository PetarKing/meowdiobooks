import type { WorkflowGateway } from '../api/contracts';

/** Hosts may resolve media; local applications retain the existing HTTP routes. */
export function sourcePageImageUrl(gateway: Pick<WorkflowGateway, 'sourcePageImageUrl'>, bookId: string, page: number): string {
  return gateway.sourcePageImageUrl?.(bookId, page) ?? `/api/books/${bookId}/pages/${page}/image`;
}

export function libraryCoverImageUrl(gateway: Pick<WorkflowGateway, 'libraryCoverImageUrl'>, exportId: string): string {
  return gateway.libraryCoverImageUrl?.(exportId) ?? `/api/library/${exportId}/cover`;
}
