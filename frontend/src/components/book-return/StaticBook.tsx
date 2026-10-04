export function StaticBook() {
  return <span className="book-return-static" aria-hidden="true">
    <svg viewBox="0 0 112 92" width="220" height="180" focusable="false">
      <path className="book-return-cover" d="M13 29v43c17-6 29-4 43 5 14-9 26-11 43-5V29" />
      <path className="book-return-pages" d="M18 24c14-5 26-4 38 4 12-8 24-9 38-4v43c-14-5-26-4-38 4-12-8-24-9-38-4Z" />
      <path className="book-return-spine" d="M56 28v43" />
      <g className="book-return-lines"><path d="m28 37 17 2m-17 8 17 2m-17 8 12 1M67 39l17-2M67 49l17-2m-17 12 12-1" /></g>
      <path className="book-return-bookmark" d="M76 22h9v25l-4.5-4-4.5 4Z" />
    </svg>
  </span>;
}
