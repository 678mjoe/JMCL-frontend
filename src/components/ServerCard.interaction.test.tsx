import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsProvider } from '@/lib/settings';
import { ServerCard } from './ServerCard';
import type { ServerManifest } from '@/lib/types';
const dom = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, { window: dom, document: dom.document, localStorage: dom.localStorage, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event, IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
const server: ServerManifest = { id: 'demo', name: 'Demo', version_id: '1.21.4', fabric_loader: null, neoforge_version: null, forge_version: null, source: 'official', accept_eula: false, java_path: null, installed: true };
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; dom.document.body.replaceChildren(); localStorage.clear(); });

test('status refresh never bubbles into detail navigation and pending disables repeated refresh', async () => {
  localStorage.setItem('jmcl.settings.v1', JSON.stringify({ language: 'en' }));
  const host = dom.document.createElement('div'); dom.document.body.append(host);
  root = createRoot(host as unknown as HTMLElement);
  let opened = 0, refreshed = 0;
  const render = async (pending: boolean) => act(async () => root!.render(<SettingsProvider><ServerCard server={server} pending={pending} onOpen={() => opened++} onRefreshStatus={() => refreshed++} /></SettingsProvider>));
  await render(false);
  const button = (name: string) => [...dom.document.querySelectorAll('button')].find(b => b.textContent?.includes(name))!;
  await act(async () => button('Refresh status').click());
  expect(refreshed).toBe(1); expect(opened).toBe(0);
  await render(true);
  expect(button('Checking').disabled).toBe(true);
  await act(async () => button('Checking').click());
  expect(refreshed).toBe(1); expect(opened).toBe(0);
  await act(async () => button('Demo').click());
  expect(opened).toBe(1);
});

test('status failure does not convert an unchecked server into stopped or running', async () => {
  localStorage.setItem('jmcl.settings.v1', JSON.stringify({ language: 'en' }));
  const host = dom.document.createElement('div'); dom.document.body.append(host); root = createRoot(host as unknown as HTMLElement);
  await act(async () => root!.render(<SettingsProvider><ServerCard server={server} pending={false} statusError="Failed to refresh server status" onOpen={() => {}} onRefreshStatus={() => {}} /></SettingsProvider>));
  expect(dom.document.body.textContent).toContain('Unknown (not checked)');
  expect(dom.document.body.textContent).toContain('Failed to refresh server status');
  expect(dom.document.body.textContent).not.toContain('Last known: stopped');
  expect(dom.document.body.textContent).not.toContain('Last known: running');
});
