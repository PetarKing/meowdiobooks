import type { LocalBook } from "../src/api/contracts";
export const fixtureBook: LocalBook = {
  id: "kit-book",
  title: "Alice’s Adventures in Wonderland",
  source_name: "alice.pdf",
  source_kind: "pdf",
  page_count: 120,
};
export const text =
  "Alice was beginning to get very tired of sitting by her sister on the bank. “What is the use of a book,” thought Alice, “without pictures or conversations?”";
export const sourcePageLines = ["Alice was beginning to get very tired of sitting", "by her sister on the bank, and of having nothing", "to do: once or twice she had peeped into the book", "her sister was reading, but it had no pictures", "or conversations in it.", "“What is the use of a book,” thought Alice,", "“without pictures or conversations?”"];
export const sourcePageHeading = "Down the Rabbit-Hole";
export const sourcePageNarration = sourcePageLines.slice(0, 5).join(" ");
export const sourcePageThought = sourcePageLines.slice(5).join(" ");
export const sourceImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="620" height="820" viewBox="0 0 620 820"><rect width="620" height="820" fill="#fffdf8"/><g fill="#29252b" font-family="Georgia"><text x="70" y="80" font-size="15">SYNTHETIC SOURCE PREVIEW · 1</text><text x="70" y="145" font-size="27">${sourcePageHeading}</text>${sourcePageLines.map((line, i) => `<text x="70" y="${205 + i * 32}" font-size="18">${line}</text>`).join("")}</g></svg>`)}`;
// Four seconds of synthetic silence make transport progress and seeking observable.
// This is a player fixture, never a recording of the displayed transcript.
function silentPlayerFixture(): string {
  const sampleRate = 8000;
  const dataSize = sampleRate * 4 * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const textAt = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      bytes[offset + i] = text.charCodeAt(i);
  };
  textAt(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  textAt(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  textAt(36, "data");
  view.setUint32(40, dataSize, true);
  return (
    "data:audio/wav;base64," +
    btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
  );
}
export const silentWav = silentPlayerFixture();

/** Silent synthetic file; the credible filename keeps test provenance out of product UI. */
export function fixtureVoiceSample(): File {
  const bytes = Uint8Array.from(atob(silentWav.split(",")[1]), (char) =>
    char.charCodeAt(0),
  );
  return new File([bytes], "alice-reference.wav", {
    type: "audio/wav",
  });
}

/** Synthetic cover artwork, distinct from the source-page fixture. */
export const libraryCoverImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><defs><linearGradient id="night" x2="0" y2="1"><stop stop-color="#214b52"/><stop offset="1" stop-color="#292039"/></linearGradient></defs><rect width="600" height="800" fill="url(#night)"/><circle cx="420" cy="125" r="56" fill="#e8c68c"/><path d="M0 350Q180 220 330 390T600 310V800H0Z" fill="#172f3b"/><path d="M280 460Q220 345 290 265Q295 210 315 230L322 280Q360 320 335 380L370 440Z" fill="#edd8b0"/><path d="M0 560Q200 440 400 560T600 510V800H0Z" fill="#1c2131"/></svg>`)}`;
