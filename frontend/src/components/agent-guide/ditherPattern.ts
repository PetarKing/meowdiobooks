/**
 * Bayer-4-only adaptation of dithercn's ditherPath (MIT).
 * Source: opencoredev/dithercn, 235d1345b0efa90e4525befcdc082c9711af3a15.
 * See DITHERCN-LICENSE.txt. No shader, canvas, frame loop or runtime dependency.
 */
const ranks = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function ditherPath(level: number) {
  let path = '';
  for (let y = 0; y < 4; y++) {
    let start = -1;
    for (let x = 0; x <= 4; x++) {
      const inked = x < 4 && level > (ranks[y * 4 + x] + 0.5) / 16;
      if (inked && start === -1) start = x;
      else if (!inked && start !== -1) {
        path += `M${start} ${y}h${x - start}v1h${start - x}z`;
        start = -1;
      }
    }
  }
  return path;
}
