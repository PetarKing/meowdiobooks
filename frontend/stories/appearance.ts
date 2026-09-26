/** Explicit URL preference makes visual review independent of local storage and OS settings. */
export function previewAppearance(): 'light' | 'dark' {
  return new URLSearchParams(window.location.search).get('appearance') === 'dark' ? 'dark' : 'light'
}
