import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jmcl.settings.v1', JSON.stringify({ language: 'en' }));
  });
  // Mock scenarios must never depend on public catalogs/accounts/real hosts.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    return route.abort();
  });
});

test('default: navigation, detail back, create cancel and reopen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Vanilla 1.21.4', { exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await nav.getByRole('button', { name: 'Servers', exact: true }).click();
  await page.getByRole('button', { name: /Vanilla Server/ }).click();
  await page.getByRole('button', { name: 'Back to servers', exact: true }).click();
  await page.getByRole('button', { name: 'New Server', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'New Server', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav.getByRole('button', { name: 'Instances', exact: true }).click();
  await expect(page.getByText('Vanilla 1.21.4', { exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('empty: server empty state stays empty after cancelled creation', async ({ page }) => {
  await page.goto('/?jmclMockScenario=empty');
  await page.getByRole('navigation').getByRole('button', { name: 'Servers', exact: true }).click();
  await expect(page.getByText('No servers yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New Server', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('No servers yet', { exact: true })).toBeVisible();
});

test('errors: failed handshake blocks actions without false empty success and reload recovers', async ({ page }) => {
  await page.goto('/?jmclMockScenario=errors');
  await page.getByRole('navigation').getByRole('button', { name: 'Servers', exact: true }).click();
  // The errors fixture rejects core.version before any server-list request.
  await expect(page.getByRole('alert')).toHaveText('Core connection failed');
  await expect(page.getByText('No servers yet', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh server list', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'New Server', exact: true })).toBeDisabled();
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Servers', exact: true }).click();
  await expect(page.getByRole('button', { name: /Vanilla Server/ })).toBeVisible();
});

test('diagnostics: browser-only fallback is explicit and actions cannot write', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  const logs = page.getByRole('region', { name: 'Diagnostic logs' });
  await expect(logs.getByText(/browser preview does not write logs/)).toBeVisible();
  await expect(logs.getByRole('button', { name: 'Export logs…', exact: true })).toBeDisabled();
  await expect(logs.getByRole('button', { name: 'Clear logs…', exact: true })).toBeDisabled();
  await logs.getByRole('button', { name: 'Refresh logs', exact: true }).click();
  await nav.getByRole('button', { name: 'Instances', exact: true }).click();
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(logs.getByRole('button', { name: 'Enable recording', exact: true })).toBeDisabled();
  await logs.screenshot({ path: 'test-results/diagnostic-browser-fallback.png' });
});
