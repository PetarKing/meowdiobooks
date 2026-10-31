import type { WorkflowModel } from "../app/useWorkflowModel";

export type LibrarySkeletonModel = Pick<WorkflowModel, "t">;

export function LibrarySkeleton({ model }: { model: LibrarySkeletonModel; }) {
  const { t } = model;
  return <div className="library-grid library-skeleton-grid" role="status" aria-label={t("Loading audiobooks")} aria-busy="true">{[1, 2].map((item) => <article key={item} className="library-book library-skeleton" aria-hidden="true"><div className="library-cover" /><div className="library-book-body"><div className="library-book-copy"><span className="skeleton-line title" /><span className="skeleton-line author" /><div className="library-chapters"><span className="skeleton-line chapter" /></div><div className="library-meta"><span className="skeleton-line meta" /><span className="skeleton-line meta" /></div></div><div className="library-actions"><span /><span /></div></div></article>)}</div>;

}
