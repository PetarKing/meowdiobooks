import { useId, useRef } from "react";

/** Controlled collection controls: filtering changes visibility, never the underlying selection. */
export function CollectionToolbar({ query, onQueryChange, filter, onFilterChange, filters, searchLabel, filterLabel, countLabel, clearLabel }: {
  query: string;
  onQueryChange: (query: string) => void;
  filter: string;
  onFilterChange: (filter: string) => void;
  filters: ReadonlyArray<{ value: string; label: string }>;
  searchLabel: string;
  filterLabel: string;
  countLabel: string;
  clearLabel: string;
}) {
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const active = Boolean(query) || filter !== filters[0]?.value;
  return <div className="collection-toolbar">
    <label className="collection-search" htmlFor={`${id}-search`}><span>{searchLabel}</span><input ref={search} id={`${id}-search`} type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => {
      if (event.key === "Escape" && query) { event.preventDefault(); onQueryChange(""); }
    }} /></label>
    <label className="collection-filter" htmlFor={`${id}-filter`}><span>{filterLabel}</span><select id={`${id}-filter`} value={filter} onChange={(event) => onFilterChange(event.target.value)}>{filters.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
    <div className="collection-result"><output aria-live="polite" aria-atomic="true">{countLabel}</output>{active && <button type="button" className="ghost compact" onClick={() => { onQueryChange(""); onFilterChange(filters[0].value); search.current?.focus(); }}>{clearLabel}</button>}</div>
  </div>;
}
