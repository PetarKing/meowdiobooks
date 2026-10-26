/** Class joining for the engine's string-only call; our app does not use Tailwind. */
export function cn(...values: (string | undefined)[]) {
  return values.filter(Boolean).join(' ');
}
