// Derive identity from the name, never the row or current page. This keeps a
// speaker's accent stable while paging, reordering, or reopening the transcript.
const accents = [
  "var(--poppy-dark)",
  "var(--green)",
  "var(--honey-dark)",
  "color-mix(in srgb, var(--poppy-dark) 65%, var(--honey-dark))",
  "color-mix(in srgb, var(--green) 65%, var(--honey-dark))",
] as const;

export function speakerAccent(reader: string): string {
  const name = reader.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  let hash = 2166136261;
  for (const character of name) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  return accents[(hash >>> 0) % accents.length];
}
