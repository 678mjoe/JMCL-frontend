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

test('instances: create, install and launch the same instance', async ({ page }) => {
  await page.goto('/?jmclMockScenario=empty');
  await page.getByRole('button', { name: 'New Instance', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Instance' });
  await dialog.getByLabel('Name', { exact: true }).fill('Acceptance Instance');
  await dialog.getByRole('button', { name: 'Customize instance ID', exact: true }).click();
  await expect(dialog.getByLabel('ID', { exact: true })).toHaveValue('acceptance-instance');
  await dialog.getByRole('button', { name: 'Game Version', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Select a game version', exact: true });
  await picker.getByRole('option', { name: '1.21.4', exact: true }).click();
  const selectedVersion = dialog.getByRole('button', { name: 'Game Version', exact: true });
  await expect(selectedVersion).toHaveText('1.21.4');
  await expect(selectedVersion).toHaveAccessibleDescription('1.21.4');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const created = page.getByRole('article', { name: 'Acceptance Instance', exact: true });
  await created.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Acceptance Instance', exact: true })).toBeVisible();
  const launch = page.getByRole('button', { name: 'Launch', exact: true });
  await expect(launch).toBeEnabled({ timeout: 15000 });
  await launch.click();
  const log = page.getByRole('dialog', { name: 'Game Log' });
  await expect(log.getByText('acceptance-instance', { exact: true })).toBeVisible();
  await expect(log).toContainText('Exited with code 0');
});

test('compact instance form: adjacent controls and a searchable in-dialog version picker', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 600 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New Instance', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Instance' });
  const name = dialog.getByLabel('Name', { exact: true });
  const version = dialog.getByRole('button', { name: 'Game Version', exact: true });
  const loader = dialog.getByRole('combobox', { name: 'Mod Loader', exact: true });
  const create = dialog.getByRole('button', { name: 'Create', exact: true });
  await name.fill('Narrow instance');
  await dialog.getByRole('button', { name: 'Customize instance ID', exact: true }).click();
  const id = dialog.getByLabel('ID', { exact: true });
  await id.fill('narrow-draft');
  await expect(create).toBeDisabled();
  await expect(create).toBeInViewport({ ratio: 1 });

  const dialogBox = (await dialog.boundingBox())!;
  const nameBox = (await name.boundingBox())!;
  const versionBox = (await version.boundingBox())!;
  const loaderBox = (await loader.boundingBox())!;
  expect(dialogBox.x).toBeGreaterThanOrEqual(15);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(415);
  expect(nameBox.x).toBeGreaterThan(dialogBox.x);
  expect(nameBox.x + nameBox.width).toBeLessThan(dialogBox.x + dialogBox.width);
  expect(Math.abs(nameBox.x - versionBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(nameBox.x + nameBox.width - loaderBox.x - loaderBox.width)).toBeLessThanOrEqual(1);
  expect(versionBox.x + versionBox.width).toBeLessThan(loaderBox.x);
  expect(Math.abs(versionBox.y - loaderBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(versionBox.height - loaderBox.height)).toBeLessThanOrEqual(1);

  await version.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Select a game version', exact: true });
  const search = picker.getByRole('combobox', { name: 'Search version numbers', exact: true });
  const list = picker.getByRole('listbox');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(search).toBeFocused();
  await expect(list.getByRole('option', { name: '1.21.4', exact: true })).toBeVisible();
  const pickerBox = (await picker.boundingBox())!;
  const searchBox = (await search.boundingBox())!;
  const listBox = (await list.boundingBox())!;
  expect(listBox.x).toBeGreaterThan(pickerBox.x);
  expect(listBox.x + listBox.width).toBeLessThan(pickerBox.x + pickerBox.width);
  expect(listBox.y).toBeGreaterThan(searchBox.y + searchBox.height);
  expect(listBox.y + listBox.height).toBeLessThan(pickerBox.y + pickerBox.height);
  await expect(list).toBeInViewport({ ratio: 1 });

  await search.fill('1.20');
  await expect(list.getByRole('option')).toHaveText(['1.20.4', '1.20.1']);
  await search.fill('no-such-version');
  await expect(picker.getByText('No matching versions', { exact: true })).toBeVisible();
  await expect(picker.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(version).toBeFocused();
  await expect(name).toHaveValue('Narrow instance');
  await expect(id).toHaveValue('narrow-draft');
  await expect(create).toBeDisabled();

  await version.press('Enter');
  await expect(search).toHaveValue('');
  await picker.getByRole('button', { name: 'Back to new instance', exact: true }).click();
  await expect(version).toBeFocused();
  await expect(id).toHaveValue('narrow-draft');
});

test('instances: keyboard navigation and content round trip at 800 by 600', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/');
  const main = page.getByRole('main');
  const skip = page.getByRole('link', { name: 'Skip to main content', exact: true });
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(main).toBeFocused();

  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  const instances = nav.getByRole('button', { name: 'Instances', exact: true });
  const servers = nav.getByRole('button', { name: 'Servers', exact: true });
  await instances.focus();
  await page.keyboard.press('Tab');
  await expect(servers).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(servers).toHaveAttribute('aria-current', 'page');
  await expect(main).toBeFocused();
  await expect(page.getByRole('button', { name: 'New Server', exact: true })).toBeVisible();
  await instances.press('Enter');
  await expect(instances).toHaveAttribute('aria-current', 'page');

  const instance = page.getByRole('article', { name: 'Vanilla 1.21.4', exact: true });
  await instance.getByRole('button', { name: 'Details', exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Vanilla 1.21.4', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Content', exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Content', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Mods', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Mods', exact: true }).press('ArrowRight');
  const resourcePacks = page.getByRole('tab', { name: 'Resource Packs', exact: true });
  await expect(resourcePacks).toBeFocused();
  await resourcePacks.press('Enter');
  await expect(resourcePacks).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => main.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Back to instance', exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Vanilla 1.21.4', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Instances', exact: true }).press('Enter');
  await expect(instance).toBeVisible();
});

test('servers: refresh, start, open the console and stop the same server', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Servers', exact: true }).click();
  await page.getByRole('button', { name: /Vanilla Server/ }).click();
  await expect(page.getByRole('heading', { name: 'Vanilla Server', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByText('Last known: running', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open console', exact: true }).click();
  const consolePanel = page.getByRole('region', { name: 'Server console and logs', exact: true });
  await expect(consolePanel.getByRole('button', { name: 'Close console', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('Last known: stopped', { exact: true })).toBeVisible();
});

test('java: install a managed runtime and preserve remove confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Java', exact: true }).click();
  const install = page.getByRole('region', { name: 'Install Managed Runtimes', exact: true });
  const managed = page.getByRole('region', { name: 'Managed Runtimes', exact: true });
  const runtime = managed.getByRole('listitem').filter({ hasText: '/mock/java/25/bin/java' });
  await expect(runtime).toHaveCount(0);
  await install.getByRole('button', { name: 'Java 25', exact: true }).click();
  await expect(runtime).toBeVisible();
  await runtime.getByRole('button', { name: 'Remove', exact: true }).click();
  await runtime.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(runtime).toBeVisible();
  await runtime.getByRole('button', { name: 'Remove', exact: true }).click();
  await runtime.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(runtime).toHaveCount(0);
});

test('settings: apply theme and language throughout the app at 430 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 720 });
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).click();
  await page.getByRole('option', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.getByLabel('Language', { exact: true }).click();
  await page.getByRole('option', { name: '中文', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  const main = page.getByRole('main');
  await expect.poll(() => main.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '服务器', exact: true }).click();
  await expect(page.getByRole('heading', { name: '服务器', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
});

test('empty: server empty state stays empty after cancelled creation', async ({ page }) => {
  await page.goto('/?jmclMockScenario=empty');
  await expect(page.getByText('No instances yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Instance', exact: true })).toBeEnabled();
  await page.getByRole('navigation').getByRole('button', { name: 'Servers', exact: true }).click();
  await expect(page.getByText('No servers yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New Server', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('No servers yet', { exact: true })).toBeVisible();
});

test('errors: failed handshake blocks actions without false empty success and reload recovers', async ({ page }) => {
  await page.goto('/?jmclMockScenario=errors');
  await expect(page.getByRole('alert')).toHaveText('Core connection failed');
  await expect(page.getByText('No instances yet', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New Instance', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Import modpack', exact: true })).toBeDisabled();
  await page.getByRole('navigation').getByRole('button', { name: 'Servers', exact: true }).click();
  // The errors fixture rejects core.version before any server-list request.
  await expect(page.getByRole('alert')).toHaveText('Core connection failed');
  await expect(page.getByText('No servers yet', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh server list', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'New Server', exact: true })).toBeDisabled();
  await page.goto('/');
  await expect(page.getByText('Vanilla 1.21.4', { exact: true })).toBeVisible();
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

test('modpack: confirmed preview, background navigation and completion summary', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await page.getByRole('button', { name: 'Import modpack', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Confirm and install', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Choose archive', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Installation summary' })).toContainText('Synthetic Modrinth Pack');
  await expect(dialog.getByLabel('New instance ID')).toHaveValue('synthetic-modrinth-pack');
  await dialog.getByRole('button', { name: 'Confirm and install', exact: true }).click();
  // Either fast terminal completion or active work may occur before this click.
  await dialog.getByRole('button', { name: /^(Continue in background|Close)$/ }).last().click();
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  const jobs = page.getByRole('region', { name: 'Installation tasks' });
  await expect(jobs).toContainText('synthetic-modrinth-pack');
  await jobs.getByRole('button', { name: 'View task', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Ready to open', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(dialog.getByRole('region', { name: 'Imported pack summary' })).toContainText('Skipped');
  await dialog.getByRole('button', { name: 'Open instance', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to Instances', exact: true })).toBeVisible();
});

test('launch log: a real blank line has height and empty EOF adds no row', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Launch', exact: true }).first().click();
  const log = page.getByRole('dialog', { name: 'Game Log' });
  await expect(log).toBeVisible();
  const rows = log.locator('[data-slot="launch-log-line"]');
  const expectedRows = ['[mock core] launch session connected', '[mock] starting', '[mock] ready', '', '[mock] warning'];
  await expect(rows).toHaveText(expectedRows);
  const blank = rows.nth(3);
  expect(await blank.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(0);
  expect(await blank.evaluate(element => getComputedStyle(element).minHeight)).toBe('20px');
  await expect(log).toContainText('Exited with code 0');
  await log.screenshot({ path: 'test-results/launch-blank-line.png' });
  await page.keyboard.press('Escape');
  await expect(log).toHaveCount(0);
  // Closing the sheet does not delete/replay the completed launch output.
  await page.getByRole('button', { name: 'Log', exact: true }).first().click();
  await expect(rows).toHaveText(expectedRows);
  expect(errors).toEqual([]);
});
