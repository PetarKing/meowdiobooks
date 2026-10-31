/** Search is accent-insensitive and requires every entered word to match the collection item. */
export function collectionMatches(query: string, values: readonly string[]) {
  const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const searchable = normalize(values.join(" "));
  return words.every((word) => searchable.includes(word));
}

