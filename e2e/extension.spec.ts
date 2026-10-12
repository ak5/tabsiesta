import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { defaultSettings, type Settings } from '../src/lib/settings';
import type { SessionState } from '../src/lib/session';

let context: BrowserContext;
let worker: Worker;
let origin: string;
let extensionId: string;
let profile: string;
const browserErrors: string[] = [];

test.beforeAll(async () => {
  origin = 'http://tabsiesta.test';
  profile = await mkdtemp(join(tmpdir(), 'tabsiesta-e2e-'));
  const extension = resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    executablePath: process.env.CHROME_TEST_EXECUTABLE || undefined,
    ignoreDefaultArgs: ['--disable-extensions', '--mute-audio'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'],
    viewport: { width: 1440, height: 1000 },
  });
  // In-memory fixture responses: no external sites or listening development server.
  await context.route(`${origin}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/audio' ? '<h1>Audio fixture</h1><button id="play">Play tone</button><script>document.getElementById("play").onclick = () => { const audio = new AudioContext(); const tone = audio.createOscillator(); const gain = audio.createGain(); gain.gain.value = 0.01; tone.connect(gain).connect(audio.destination); tone.start(); audio.resume(); globalThis.fixtureAudio = audio; };</script>'
      : path === '/secret' ? '<h1>Your seed phrase</h1><p>Only shown once</p>'
      : path === '/frame' ? '<h1>Frame page</h1><iframe src="/form"></iframe>'
      : path === '/form' ? '<h1>A draft</h1><form><label>Your note<input aria-label="Your note"></label></form>'
      : '<h1>Ordinary page</h1><p>No sensitive information here.</p>';
    await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Test page ${path}</title><link rel="icon" href="data:,"></head><body>${body}</body></html>` });
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).hostname;
  context.on('page', (page) => { page.on('pageerror', (error) => browserErrors.push(error.message)); });
  await expect.poll(async () => worker.evaluate(async () => ((await chrome.storage.local.get('settings')).settings as Settings | undefined)?.idleMinutes)).toBe(10);
});

test.beforeEach(async () => {
  await worker.evaluate((settings) => chrome.storage.local.set({ settings }), defaultSettings());
});

test.afterAll(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

test('full-tab options, saving, custom phrases, restoration, and lightweight popup', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole('heading', { name: 'Your tabs. Your rules.' })).toBeVisible();
  expect(await worker.evaluate(() => chrome.runtime.getManifest().options_ui?.open_in_tab)).toBe(true);
  await page.getByLabel('Sleep inactive tabs after').selectOption('30');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved. Your changes are now active.');
  expect(await worker.evaluate(async () => ((await chrome.storage.local.get('settings')).settings as Settings).idleMinutes)).toBe(30);
  await page.getByLabel('New sensitive phrase').fill('Keep this receipt open');
  await page.getByRole('button', { name: '+ Add phrase' }).click();
  await page.getByRole('button', { name: 'Restore recommended phrases' }).click();
  await expect.poll(() => page.getByRole('textbox', { name: 'Phrase text', exact: true }).evaluateAll((inputs) => inputs.some((input) => (input as HTMLInputElement).value === 'Keep this receipt open'))).toBe(true);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved. Your changes are now active.');
  await page.screenshot({ path: 'test-results/options-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/options-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'test-results/options-dark.png', fullPage: true });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByText('Total tabs', { exact: true })).toBeVisible();
  await expect(popup.getByText('Sleeping', { exact: true })).toBeVisible();
  await popup.screenshot({ path: 'test-results/popup.png' });
  await popup.close(); await page.close();
});

test('collapse discards a safe tab, preserves URL and reloads on selection', async () => {
  const page = await context.newPage(); await page.goto(`${origin}/ordinary`);
  const control = await context.newPage(); await control.goto(`${origin}/control`);
  const result = await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    if (!tab?.id) throw new Error('Fixture tab missing');
    const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, { collapsed: false });
    return { id: tab.id, groupId };
  }, `${origin}/ordinary`);
  await expect.poll(async () => worker.evaluate(async (id) => ((await chrome.storage.session.get('session')).session as SessionState).groups[id], result.groupId)).toBe(false);
  await worker.evaluate((id) => chrome.tabGroups.update(id, { collapsed: true }), result.groupId);
  await expect.poll(() => worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.discarded, `${origin}/ordinary`)).toBe(true);
  const discardedId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, `${origin}/ordinary`);
  expect(await worker.evaluate(async (id) => (await chrome.tabs.get(id)).url, discardedId)).toBe(`${origin}/ordinary`);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), discardedId);
  await expect.poll(() => worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.discarded, `${origin}/ordinary`)).toBe(false);
  // Native discard can replace both the tab ID and the renderer/DevTools target.
  await expect.poll(() => context.pages().some((candidate) => !candidate.isClosed() && candidate.url() === `${origin}/ordinary`)).toBe(true);
  const restored = context.pages().find((candidate) => !candidate.isClosed() && candidate.url() === `${origin}/ordinary`)!;
  await expect(restored.getByRole('heading', { name: 'Ordinary page' })).toBeVisible();
  await restored.close(); await control.close();
});

test('collapsed groups retain edited forms, dirty child frames, and one-time secret pages', async () => {
  const pages = await Promise.all(['/form', '/frame', '/secret'].map(async (path) => {
    const page = await context.newPage(); await page.goto(origin + path); return page;
  }));
  await pages[0]!.getByLabel('Your note').fill('A draft that must survive');
  await pages[1]!.frameLocator('iframe').getByLabel('Your note').fill('Unsaved child frame');
  const control = await context.newPage(); await control.goto(`${origin}/control`);
  const grouped = await worker.evaluate(async (urls) => {
    const tabs = await chrome.tabs.query({});
    const ids = tabs.filter((tab) => tab.id !== undefined && urls.includes(tab.url ?? '')).map((tab) => tab.id!);
    if (ids.length !== 3) throw new Error('Fixture tabs missing');
    const groupId = await chrome.tabs.group({ tabIds: ids as [number, ...number[]] });
    await chrome.tabGroups.update(groupId, { collapsed: false });
    return { groupId, ids };
  }, ['/form', '/frame', '/secret'].map((path) => origin + path));
  await expect.poll(async () => worker.evaluate(async (id) => ((await chrome.storage.session.get('session')).session as SessionState).groups[id], grouped.groupId)).toBe(false);
  await worker.evaluate((id) => chrome.tabGroups.update(id, { collapsed: true }), grouped.groupId);
  // Queue a stats message behind collapse evaluation, so the assertion is after the whole pass.
  const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByRole('button', { name: 'Save changes' })).toBeVisible();
  const stats = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATS' }));
  expect(stats.error).toBeUndefined();
  const discarded = await worker.evaluate(async (ids) => Promise.all(ids.map(async (id) => (await chrome.tabs.get(id)).discarded)), grouped.ids);
  expect(discarded).toEqual([false, false, false]);
  await expect(pages[0]!.getByLabel('Your note')).toHaveValue('A draft that must survive');
  expect(browserErrors).toEqual([]);
  await options.close(); await control.close(); for (const page of pages) await page.close();
});

test('native audio, pinned, selected, and protected-site tabs refuse audit sleep', async () => {
  const audio = await context.newPage(); await audio.goto(`${origin}/audio`);
  await audio.getByRole('button', { name: 'Play tone' }).click();
  await expect.poll(() => audio.evaluate(() => (globalThis as typeof globalThis & { fixtureAudio?: AudioContext }).fixtureAudio?.state)).toBe('running');
  const pinned = await context.newPage(); await pinned.goto(`${origin}/pinned`);
  const audit = await context.newPage(); await audit.goto(`chrome-extension://${extensionId}/audit.html`);
  const ids = await worker.evaluate(async ({ origin, auditUrl }) => {
    const tabs = await chrome.tabs.query({});
    const audio = tabs.find((tab) => tab.url === origin + '/audio')!.id!;
    const pinned = tabs.find((tab) => tab.url === origin + '/pinned')!.id!;
    const audit = tabs.find((tab) => tab.url === auditUrl)!.id!;
    await chrome.tabs.update(pinned, { pinned: true });
    await chrome.tabs.update(audit, { active: true });
    return { audio, pinned, audit };
  }, { origin, auditUrl: audit.url() });
  await expect.poll(() => worker.evaluate(async (id) => (await chrome.tabs.get(id)).audible, ids.audio), { timeout: 15_000 }).toBe(true);
  const sleep = (tabId: number) => audit.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'AUDIT_ACTION', tabId, action: 'sleep' }), tabId);
  expect((await sleep(ids.audio)).result).toBe('audio');
  expect((await sleep(ids.pinned)).result).toBe('pinned');
  expect((await sleep(ids.audit)).result).toBe('active');
  await worker.evaluate(async () => {
    const settings = (await chrome.storage.local.get('settings')).settings as Settings;
    settings.sites.push('tabsiesta.test'); await chrome.storage.local.set({ settings });
  });
  // Remove the earlier pinned exception so this attempt exercises the site rule.
  await worker.evaluate((id) => chrome.tabs.update(id, { pinned: false }), ids.pinned);
  expect((await sleep(ids.pinned)).result).toBe('site');
  expect(await worker.evaluate(async (ids) => Promise.all(ids.map(async (id) => (await chrome.tabs.get(id)).discarded)), [ids.audio, ids.pinned])).toEqual([false, false]);
  await audit.close(); await pinned.close(); await audio.close();
});

test('collapse targets its own group and leaves another group loaded', async () => {
  const target = await context.newPage(); await target.goto(`${origin}/target-group`);
  const other = await context.newPage(); await other.goto(`${origin}/other-group`);
  const audit = await context.newPage(); await audit.goto(`chrome-extension://${extensionId}/audit.html`);
  const grouped = await worker.evaluate(async (origin) => {
    const tabs = await chrome.tabs.query({});
    const targetId = tabs.find((tab) => tab.url === origin + '/target-group')!.id!;
    const otherId = tabs.find((tab) => tab.url === origin + '/other-group')!.id!;
    const targetGroup = await chrome.tabs.group({ tabIds: [targetId] });
    const otherGroup = await chrome.tabs.group({ tabIds: [otherId] });
    await chrome.tabGroups.update(targetGroup, { collapsed: false });
    await chrome.tabGroups.update(otherGroup, { collapsed: false });
    return { targetId, otherId, targetGroup };
  }, origin);
  await expect.poll(() => worker.evaluate(async (id) => ((await chrome.storage.session.get('session')).session as SessionState).groups[id], grouped.targetGroup)).toBe(false);
  await worker.evaluate((id) => chrome.tabGroups.update(id, { collapsed: true }), grouped.targetGroup);
  await audit.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_AUDIT' }));
  await expect.poll(() => worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.discarded, `${origin}/target-group`)).toBe(true);
  expect(await worker.evaluate(async (id) => (await chrome.tabs.get(id)).discarded, grouped.otherId)).toBe(false);
  await audit.close(); await other.close(); await target.close();
});

test('audit links keywords, sleeps safely, focuses the original tab, and closes only its row', async () => {
  const secret = await context.newPage(); await secret.goto(`${origin}/secret`);
  const ordinary = await context.newPage(); await ordinary.goto(`${origin}/audit-target`);
  const audit = await context.newPage(); await audit.goto(`chrome-extension://${extensionId}/audit.html`);
  await expect(audit.getByRole('heading', { name: 'Tab Audit' })).toBeVisible();
  const ids = await worker.evaluate(async (origin) => {
    const tabs = await chrome.tabs.query({});
    return { secret: tabs.find((tab) => tab.url === origin + '/secret')!.id!, ordinary: tabs.find((tab) => tab.url === origin + '/audit-target')!.id! };
  }, origin);
  expect((await audit.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'AUDIT_ACTION', action: 'sleep', tabId }), ids.secret)).result).toBe('phrase');
  await audit.getByRole('button', { name: 'Refresh', exact: true }).click();
  const link = audit.locator('a[href="options.html#phrase-crypto-2"]').first();
  await expect(link).toHaveText('“Seed phrase”');
  await link.click();
  await expect(audit.locator('#phrase-crypto-2')).toBeFocused();
  await audit.goto(`chrome-extension://${extensionId}/audit.html`);
  await audit.getByRole('button', { name: 'Refresh', exact: true }).click();
  const targetRow = audit.getByRole('row').filter({ hasText: 'Test page /audit-target' });
  await targetRow.getByRole('button', { name: 'Sleep Test page /audit-target', exact: true }).click();
  await expect(audit.getByRole('status')).toHaveText('Tab is now sleeping.');
  await expect(targetRow.getByText('Sleeping', { exact: true })).toBeVisible();
  await targetRow.getByRole('button', { name: 'Switch to Test page /audit-target', exact: true }).click();
  await expect.poll(() => worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.active, `${origin}/audit-target`)).toBe(true);
  expect(await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.discarded, `${origin}/audit-target`)).toBe(false);
  await audit.bringToFront();
  await audit.getByRole('button', { name: 'Refresh', exact: true }).click();
  await targetRow.getByRole('button', { name: 'Close Test page /audit-target', exact: true }).click();
  await expect(audit.getByRole('status')).toHaveText('Tab closed.');
  expect(await worker.evaluate(async (url) => (await chrome.tabs.query({ url })).length, `${origin}/audit-target`)).toBe(0);
  expect(await worker.evaluate(async (id) => (await chrome.tabs.get(id)).discarded, ids.secret)).toBe(false);
  expect(browserErrors).toEqual([]);
  await audit.close(); await secret.close();
});

test('the real alarm sleeps an inactive tab after the configured five-minute threshold', async () => {
  test.setTimeout(7 * 60_000);
  await worker.evaluate(async () => {
    const settings = (await chrome.storage.local.get('settings')).settings as Settings;
    settings.idleMinutes = 5; await chrome.storage.local.set({ settings });
  });
  const idle = await context.newPage(); await idle.goto(`${origin}/idle-timer`);
  const control = await context.newPage(); await control.goto(`${origin}/control`);
  await worker.evaluate(async (url) => { const [tab] = await chrome.tabs.query({ url }); await chrome.tabs.update(tab!.id!, { active: true }); }, control.url());
  const id = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, idle.url());
  await expect.poll(() => worker.evaluate(async (id) => ((await chrome.storage.session.get('session')).session as SessionState).idleSince[id], id)).toBeDefined();
  expect(await worker.evaluate(async (id) => (await chrome.tabs.get(id)).discarded, id)).toBe(false);
  const since = await worker.evaluate(async (id) => ((await chrome.storage.session.get('session')).session as SessionState).idleSince[id]!, id);
  await expect.poll(() => worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.discarded, `${origin}/idle-timer`), { timeout: 6 * 60_000 + 15_000, intervals: [1000, 5000, 15000] }).toBe(true);
  expect(Date.now() - since).toBeGreaterThanOrEqual(5 * 60_000);
  const sleptId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, `${origin}/idle-timer`);
  expect(await worker.evaluate(async (id) => ((await chrome.storage.session.get('session')).session as SessionState).sleeps[id]?.trigger, sleptId)).toBe('idle');
  await idle.close(); await control.close();
});
