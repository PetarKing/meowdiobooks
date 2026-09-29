/** Drive the one-icon preference through the same UI as a person. Synthetic reviews only. */
export async function chooseAppearance(page, appearance) {
  if (appearance === 'system') {
    await page.evaluate(() => localStorage.removeItem('meowdiobooks.appearance'));
    await page.reload();
    await page.getByText('Synthetic data · safe to explore', { exact: true }).waitFor();
    return;
  }
  const mode = () => page.locator('.app-shell').getAttribute('data-appearance');
  const toggle = page.getByRole('button', { name: /Toggle dark mode|切换深色模式/ });
  const saved = await readAppearance(page);
  if (await mode() === appearance && saved !== appearance) {
    await toggle.click();
    await page.waitForFunction(a => document.querySelector('.app-shell')?.dataset.appearance !== a, appearance);
  }
  if (await mode() !== appearance) await toggle.click();
  await page.waitForFunction(a => document.querySelector('.app-shell')?.dataset.appearance === a, appearance);
  // Let descendant colours resolve after changing the root's inherited tokens.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
export async function readAppearance(page) {
  return page.evaluate(() => localStorage.getItem('meowdiobooks.appearance') ?? 'system');
}
