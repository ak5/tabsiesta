import { afterEach, describe, expect, it, vi } from 'vitest';
import background from '../src/entrypoints/background';
import { defaultSettings, type Settings } from '../src/lib/settings';
import { emptySession, type SessionState } from '../src/lib/session';
import type { GuardStatus, TabSnapshot } from '../src/lib/policy';

type Listener = (...args: unknown[]) => unknown;
function event() {
  const listeners: Listener[] = [];
  return { addListener: (listener: Listener) => listeners.push(listener), emit: (...args: unknown[]) => listeners.forEach((listener) => listener(...args)), listeners };
}

function fixture(options: { session?: SessionState; settings?: Settings; collapsed?: boolean; tabs?: TabSnapshot[] } = {}) {
  const origin = 'chrome-extension://test-extension/';
  const local: Record<string, unknown> = { settings: options.settings ?? defaultSettings() };
  const session: Record<string, unknown> = options.session ? { session: structuredClone(options.session) } : {};
  const tabs: TabSnapshot[] = options.tabs ?? [
    { id: 1, url: 'https://example.test/', active: false, pinned: false, discarded: false, status: 'complete', groupId: 2, windowId: 1 },
    { id: 2, url: 'https://other.test/', active: true, pinned: false, discarded: false, status: 'complete', groupId: -1, windowId: 1 },
  ];
  const group = { id: 2, collapsed: options.collapsed ?? false, windowId: 1, color: 'blue' };
  const safe: GuardStatus = { ready: true, complete: true, dirty: false, phrase: false };
  let statuses = [safe];
  let frameCount = 1;
  const storage = (data: Record<string, unknown>) => ({
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(data[key]) })),
    set: vi.fn(async (patch: object) => { Object.assign(data, structuredClone(patch)); }),
  });
  const api = {
    runtime: {
      id: 'test-extension', getURL: (path: string) => origin + path,
      getManifest: () => ({ content_scripts: [{ js: ['content-scripts/form-guard.js'] }] }),
      onInstalled: event(), onStartup: event(), onMessage: event(),
    },
    tabs: {
      query: vi.fn(async (query: { groupId?: number }) => tabs.filter((tab) => query.groupId === undefined || tab.groupId === query.groupId).map((tab) => ({ ...tab }))),
      get: vi.fn(async (id: number) => { const tab = tabs.find((t) => t.id === id); if (!tab) throw new Error('No tab'); return { ...tab }; }),
      discard: vi.fn(async (id: number) => { const tab = tabs.find((t) => t.id === id)!; tab.discarded = true; return tab; }),
      remove: vi.fn(async (id: number) => { const index = tabs.findIndex((tab) => tab.id === id); if (index < 0) throw new Error('No tab'); tabs.splice(index, 1); }),
      update: vi.fn(async (id: number, changes: { active: boolean }) => { const tab = tabs.find((tab) => tab.id === id); if (!tab) throw new Error('No tab'); Object.assign(tab, changes); tab.discarded = false; return { ...tab }; }),
      onActivated: event(), onCreated: event(), onRemoved: event(), onReplaced: event(), onAttached: event(), onDetached: event(), onUpdated: event(),
    },
    tabGroups: { query: vi.fn(async () => [{ ...group }]), get: vi.fn(async () => ({ ...group })), onUpdated: event(), onCreated: event(), onRemoved: event() },
    alarms: { get: vi.fn(async () => undefined), create: vi.fn(async () => {}), onAlarm: event() },
    windows: { update: vi.fn(async () => {}) },
    storage: { local: storage(local), session: storage(session), onChanged: event() },
    contextMenus: { removeAll: vi.fn(async () => {}), create: vi.fn(), update: vi.fn(async () => {}), onClicked: event() },
    webNavigation: {
      getAllFrames: vi.fn(async ({ tabId }: { tabId: number }) => Array.from({ length: frameCount }, (_, frameId) => ({ frameId, documentId: `doc-${tabId}-${frameId}`, url: 'https://example.test/' }))),
      onCommitted: event(),
    },
    scripting: { executeScript: vi.fn(async ({ target }: { target: { tabId: number } }) => statuses.map((status, frameId) => ({ frameId, documentId: `doc-${target.tabId}-${frameId}`, result: status }))) },
  };
  vi.stubGlobal('chrome', api);
  background.main();
  function request(message: object, sender: object = { id: 'test-extension', url: origin + 'options.html' }): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const keptOpen = api.runtime.onMessage.listeners[0]!(message, sender, resolve);
      if (!keptOpen) reject(new Error('Request rejected'));
    });
  }
  const drain = () => request({ type: 'GET_SETTINGS' });
  return { api, tabs, group, session, local, request, drain, statuses: (next: GuardStatus[]) => { statuses = next; }, frames: (count: number) => { frameCount = count; } };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('worker integration', () => {
  it('records the tab ID returned by native discard and preserves it through replacement', async () => {
    const f = fixture(); await f.drain();
    const since = (f.session.session as SessionState).idleSince[1];
    f.api.tabs.discard.mockImplementationOnce(async () => {
      const replacement = { ...f.tabs[0]!, id: 3, discarded: true };
      f.tabs[0] = replacement;
      f.api.tabs.onReplaced.emit(3, 1);
      return replacement;
    });
    f.group.collapsed = true; f.api.tabGroups.onUpdated.emit({ ...f.group }); await f.drain();
    const audit = await f.request({ type: 'GET_AUDIT' });
    const state = f.session.session as SessionState;
    expect(state.sleeps[3]?.trigger).toBe('collapse');
    expect(state.sleeps[1]).toBeUndefined();
    expect(state.idleSince[3]).toBe(since);
    expect(state.guards[1]).toBeUndefined();
    expect(audit.tabs).toEqual(expect.arrayContaining([expect.objectContaining({ id: 3, sleeping: true, reason: 'TabSiesta group collapse' })]));
  });
  it('explains initializing, incomplete, and unavailable frame checks separately', async () => {
    const f = fixture(); await f.drain();
    for (const [ready, complete, wording] of [[false, false, 'still initializing'], [true, false, 'scan is incomplete']] as const) {
      f.api.runtime.onMessage.emit({ type: 'GUARD_STATUS', status: { ready, complete, dirty: false, phrase: false } }, { id: 'test-extension', tab: { id: 1 }, frameId: 0, documentId: 'doc-1-0' }, () => {});
      await f.drain();
      expect((await f.request({ type: 'GET_AUDIT' })).tabs).toEqual(expect.arrayContaining([expect.objectContaining({ id: 1, reason: expect.stringContaining(wording) })]));
    }
    f.api.webNavigation.getAllFrames.mockRejectedValueOnce(new Error('Unavailable'));
    expect((await f.request({ type: 'GET_AUDIT' })).tabs).toEqual(expect.arrayContaining([expect.objectContaining({ id: 1, reason: 'Chrome could not provide page frame information' })]));
  });
  it('allows audit sleep before the idle deadline but retains all safety checks', async () => {
    const f = fixture(); await f.drain();
    const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/audit.html' };
    expect(await f.request({ type: 'AUDIT_ACTION', tabId: 2, action: 'sleep' }, sender)).toEqual({ result: 'active' });
    expect(f.api.tabs.discard).not.toHaveBeenCalled();
    f.statuses([{ ready: true, complete: true, dirty: true, phrase: false }]);
    expect(await f.request({ type: 'AUDIT_ACTION', tabId: 1, action: 'sleep' }, sender)).toEqual({ result: 'form' });
    expect(f.api.tabs.discard).not.toHaveBeenCalled();
    f.statuses([{ ready: true, complete: true, dirty: false, phrase: false }]);
    expect(await f.request({ type: 'AUDIT_ACTION', tabId: 1, action: 'sleep' }, sender)).toEqual({ result: 'discarded' });
    expect((f.session.session as SessionState).sleeps[1]?.trigger).toBe('manual');
    expect((await f.request({ type: 'GET_AUDIT' })).tabs).toEqual(expect.arrayContaining([expect.objectContaining({ id: 1, reason: 'Slept from Tab Audit' })]));
  });
  it('restricts tab actions to the audit page and validates IDs', async () => {
    const f = fixture(); await f.drain();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await f.request({ type: 'AUDIT_ACTION', tabId: 1, action: 'close' })).toHaveProperty('error');
    expect(await f.request({ type: 'AUDIT_ACTION', tabId: '1', action: 'close' }, { id: 'test-extension', url: 'chrome-extension://test-extension/audit.html' })).toHaveProperty('error');
    expect(f.api.tabs.remove).not.toHaveBeenCalled(); warn.mockRestore();
  });
  it('focuses an existing tab from its audit title and closes only the requested tab', async () => {
    const f = fixture(); await f.drain();
    const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/audit.html' };
    expect(await f.request({ type: 'AUDIT_ACTION', tabId: 1, action: 'focus' }, sender)).toEqual({ result: 'focused' });
    expect(f.api.tabs.update).toHaveBeenCalledWith(1, { active: true });
    expect(f.api.windows.update).toHaveBeenCalledWith(1, { focused: true });
    expect(await f.request({ type: 'AUDIT_ACTION', tabId: 1, action: 'close' }, sender)).toEqual({ result: 'closed' });
    expect(f.tabs.map((tab) => tab.id)).toEqual([2]);
    expect((f.session.session as SessionState).idleSince[1]).toBeUndefined();
  });
  it('reports configured phrase IDs and rejects unknown IDs or extra page text', async () => {
    const f = fixture(); await f.drain();
    f.api.runtime.onMessage.emit({ type: 'GUARD_STATUS', status: { ready: true, complete: true, dirty: false, phrase: true, phraseIds: ['crypto-2', 'synthetic private secret'], text: 'synthetic private draft' } }, { id: 'test-extension', tab: { id: 1 }, frameId: 0, documentId: 'doc-1-0' }, () => {});
    await f.drain();
    expect((await f.request({ type: 'GET_AUDIT' })).tabs).toEqual(expect.arrayContaining([expect.objectContaining({ id: 1, reason: 'Warning phrase blocked sleep', phrases: [{ id: 'crypto-2', text: 'Seed phrase' }] })]));
    expect((f.session.session as SessionState).guards[1]?.[0]?.status.phraseIds).toEqual(['crypto-2']);
    expect(JSON.stringify(f.session)).not.toContain('synthetic private');
  });
  it('audits protection and tracks only TabSiesta sleep causes without storing URLs', async () => {
    const f = fixture(); await f.drain();
    const before = await f.request({ type: 'GET_AUDIT' }, { id: 'test-extension', url: 'chrome-extension://test-extension/audit.html' });
    expect(before.tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, sleeping: false, reason: 'No safety result for the current page or one of its frames yet' }),
      expect.objectContaining({ id: 2, sleeping: false, reason: 'Selected tab in its window' }),
    ]));
    expect(f.api.scripting.executeScript).not.toHaveBeenCalled();
    f.group.collapsed = true; f.api.tabGroups.onUpdated.emit({ ...f.group }); await f.drain();
    const after = await f.request({ type: 'GET_AUDIT' });
    expect(after.tabs).toEqual(expect.arrayContaining([expect.objectContaining({ id: 1, sleeping: true, reason: 'TabSiesta group collapse' })]));
    expect((f.session.session as SessionState).sleeps[1]).toEqual({ trigger: 'collapse', at: expect.any(Number) });
    expect(JSON.stringify(f.session)).not.toContain('https://');
    f.tabs[0]!.discarded = false;
    f.api.tabs.onUpdated.emit(1, { discarded: false }); await f.drain();
    expect((f.session.session as SessionState).sleeps[1]).toBeUndefined();
  });
  it('reports an unknown cause for tabs discarded outside TabSiesta', async () => {
    const f = fixture(); f.tabs[0]!.discarded = true; await f.drain();
    const audit = await f.request({ type: 'GET_AUDIT' });
    expect(audit.tabs).toEqual(expect.arrayContaining([expect.objectContaining({ id: 1, sleeping: true, reason: expect.stringContaining('Sleep reason unknown') })]));
    await expect(f.request({ type: 'GET_AUDIT' }, { id: 'test-extension', url: 'https://example.test/' })).rejects.toThrow('Request rejected');
  });
  it('retains an idle sleep cause across worker restarts', async () => {
    const state = emptySession(); state.idleSince[1] = Date.now() - 600001;
    const f = fixture({ session: state }); await f.drain();
    f.api.alarms.onAlarm.emit({ name: 'idle-sweep' }); await f.drain();
    const restored = fixture({ session: f.session.session as SessionState, tabs: structuredClone(f.tabs) }); await restored.drain();
    expect((await restored.request({ type: 'GET_AUDIT' })).tabs).toEqual(expect.arrayContaining([expect.objectContaining({ id: 1, reason: 'TabSiesta idle timer' })]));
  });
  it('initializes without a current window and handles groups created afterward', async () => {
    const f = fixture({ tabs: [] });
    f.api.tabGroups.query.mockRejectedValue(new Error('No current window'));
    await f.drain();
    expect(f.api.tabGroups.query).not.toHaveBeenCalled();
    expect(f.api.tabGroups.get).not.toHaveBeenCalled();
    expect(f.api.alarms.create).toHaveBeenCalledWith('idle-sweep', { periodInMinutes: 1 });
    expect(f.api.contextMenus.create).toHaveBeenCalled();
    expect((await f.request({ type: 'GET_STATS' })).stats).toEqual({ total: 0, loaded: 0, discarded: 0, protected: 0 });
    f.tabs.push({ id: 1, url: 'https://example.test/', active: false, pinned: false, discarded: false, status: 'complete', groupId: 2, windowId: 1 });
    f.api.tabs.onCreated.emit(f.tabs[0]);
    f.api.tabGroups.onCreated.emit({ ...f.group });
    await f.drain();
    f.group.collapsed = true;
    f.api.tabGroups.onUpdated.emit({ ...f.group });
    await f.drain();
    expect(f.api.tabs.discard).toHaveBeenCalledWith(1);
  });
  it('keeps initialization usable if a snapshotted group disappears', async () => {
    const f = fixture();
    f.api.tabGroups.get.mockRejectedValueOnce(new Error('No group'));
    await f.drain();
    expect((f.session.session as SessionState).groups[2]).toBeUndefined();
    f.group.collapsed = true;
    f.api.tabGroups.onUpdated.emit({ ...f.group });
    await f.drain();
    expect(f.api.tabs.discard).not.toHaveBeenCalled();
  });
  it('stores only safety booleans from content-script messages', async () => {
    const f = fixture(); await f.drain();
    const status = { ready: true, complete: true, dirty: true, phrase: false, text: 'synthetic private draft', url: 'https://private.test/' };
    f.api.runtime.onMessage.emit({ type: 'GUARD_STATUS', status }, { id: 'test-extension', tab: { id: 1 }, frameId: 0, documentId: 'doc-1-0' }, () => {});
    await f.drain();
    expect((f.session.session as SessionState).guards[1]?.[0]?.status).toEqual({ ready: true, complete: true, dirty: true, phrase: false });
    expect(JSON.stringify(f.session)).not.toContain(status.text);
    expect(JSON.stringify(f.session)).not.toContain(status.url);
  });
  it('stores only safety booleans from injected guard results', async () => {
    const f = fixture(); await f.drain();
    const status = { ready: true, complete: true, dirty: true, phrase: false, text: 'synthetic private draft' };
    f.statuses([status]);
    f.group.collapsed = true; f.api.tabGroups.onUpdated.emit({ ...f.group }); await f.drain();
    expect((f.session.session as SessionState).guards[1]?.[0]?.status).toEqual({ ready: true, complete: true, dirty: true, phrase: false });
    expect(JSON.stringify(f.session)).not.toContain(status.text);
  });
  it('does not log or return raw API error details', async () => {
    const f = fixture(); await f.drain();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.api.storage.local.set.mockRejectedValueOnce(new Error('synthetic private error content'));
    const response = await f.request({ type: 'SAVE_SETTINGS', settings: defaultSettings() });
    expect(response.error).toBe('Operation failed. Check your settings and try again.');
    expect(warning).toHaveBeenCalledWith('TabSiesta: operation failed.');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('synthetic private error content');
  });
  it('registers listeners synchronously and creates the periodic alarm', async () => {
    const f = fixture(); expect(f.api.alarms.onAlarm.listeners).toHaveLength(1);
    await f.drain(); expect(f.api.alarms.create).toHaveBeenCalledWith('idle-sweep', { periodInMinutes: 1 });
    expect(f.api.contextMenus.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'keep-awake', type: 'checkbox' }));
  });
  it('discards a safe tab on collapse but not on recoloring or startup', async () => {
    const f = fixture(); await f.drain(); expect(f.api.tabs.discard).not.toHaveBeenCalled();
    f.group.collapsed = true; f.api.tabGroups.onUpdated.emit({ ...f.group }); await f.drain();
    expect(f.api.tabs.discard).toHaveBeenCalledTimes(1);
    f.api.tabGroups.onUpdated.emit({ ...f.group, color: 'red' }); await f.drain();
    expect(f.api.tabs.discard).toHaveBeenCalledTimes(1);
  });
  it('does not immediately sleep groups already collapsed on initialization', async () => {
    const f = fixture({ collapsed: true }); await f.drain();
    f.api.tabGroups.onUpdated.emit({ ...f.group, title: 'Renamed' }); await f.drain();
    expect(f.api.tabs.discard).not.toHaveBeenCalled();
  });
  it('restores idle timestamps across worker initialization and handles the alarm', async () => {
    const state = emptySession(); state.idleSince[1] = Date.now() - 600001;
    const f = fixture({ session: state }); await f.drain();
    f.api.alarms.onAlarm.emit({ name: 'idle-sweep' }); await f.drain();
    expect(f.api.tabs.discard).toHaveBeenCalledWith(1);
    expect(f.api.tabs.discard).not.toHaveBeenCalledWith(2);
  });
  it('keeps tabs awake when one child frame was not inspected', async () => {
    const f = fixture(); f.frames(2); await f.drain();
    f.group.collapsed = true; f.api.tabGroups.onUpdated.emit({ ...f.group }); await f.drain();
    expect(f.api.tabs.discard).not.toHaveBeenCalled();
  });
  it('keeps dirty child frames awake through the actual worker pipeline', async () => {
    const f = fixture(); f.frames(2); f.statuses([
      { ready: true, complete: true, dirty: false, phrase: false },
      { ready: true, complete: true, dirty: true, phrase: false },
    ]); await f.drain();
    f.group.collapsed = true; f.api.tabGroups.onUpdated.emit({ ...f.group }); await f.drain();
    expect(f.api.tabs.discard).not.toHaveBeenCalled();
  });
  it('does not reinject an existing guard still initializing, preserving its state', async () => {
    const f = fixture(); f.statuses([{ ready: false, complete: false, dirty: false, phrase: false }]); await f.drain();
    f.group.collapsed = true; f.api.tabGroups.onUpdated.emit({ ...f.group }); await f.drain();
    expect(f.api.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(f.api.tabs.discard).not.toHaveBeenCalled();
  });
  it('injects only missing frames, retaining existing dirty frame guards', async () => {
    const f = fixture(); f.frames(2); await f.drain();
    let injected = false;
    f.api.scripting.executeScript.mockImplementation(async (request) => {
      if ('files' in request) { injected = true; return []; }
      return [
        { frameId: 0, documentId: 'doc-1-0', result: { ready: true, complete: true, dirty: true, phrase: false } },
        { frameId: 1, documentId: 'doc-1-1', result: injected
          ? { ready: true, complete: true, dirty: false, phrase: false }
          : { ready: false, complete: false, dirty: false, phrase: false, missing: true } },
      ];
    });
    f.group.collapsed = true; f.api.tabGroups.onUpdated.emit({ ...f.group }); await f.drain();
    expect(f.api.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 1, frameIds: [1] }, files: ['content-scripts/form-guard.js'] });
    expect(f.api.tabs.discard).not.toHaveBeenCalled();
  });
  it('per-tab context protection persists until close', async () => {
    const f = fixture(); await f.drain();
    f.api.contextMenus.onClicked.emit({ menuItemId: 'keep-awake', checked: true }, { id: 1 }); await f.drain();
    f.group.collapsed = true; f.api.tabGroups.onUpdated.emit({ ...f.group }); await f.drain();
    expect(f.api.tabs.discard).not.toHaveBeenCalled();
    expect((f.session.session as SessionState).manual[1]).toBe(true);
    f.tabs.splice(0, 1); f.api.tabs.onRemoved.emit(1); await f.drain();
    expect((f.session.session as SessionState).manual[1]).toBeUndefined();
  });
  it('saves validated settings and rejects page-origin requests', async () => {
    const f = fixture(); await f.drain();
    const next = { ...defaultSettings(), idleMinutes: 30 };
    expect(await f.request({ type: 'SAVE_SETTINGS', settings: next })).toEqual({ settings: next });
    expect((f.local.settings as Settings).idleMinutes).toBe(30);
    await expect(f.request({ type: 'SAVE_SETTINGS', settings: next }, { id: 'test-extension', url: 'https://example.test/', tab: { id: 1 } })).rejects.toThrow('Request rejected');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await f.request({ type: 'SAVE_SETTINGS', settings: { ...next, idleMinutes: -1 } })).toHaveProperty('error');
    expect(warning).toHaveBeenCalled();
  });
  it('counts current state without executing any page scripts', async () => {
    const f = fixture(); await f.drain();
    const response = await f.request({ type: 'GET_STATS' });
    expect(response.stats).toEqual({ total: 2, loaded: 2, discarded: 0, protected: 2 });
    expect(f.api.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('accepts settings messages after navigating between full-page sections', async () => {
    const f = fixture(); await f.drain();
    const response = await f.request({ type: 'SAVE_SETTINGS', settings: defaultSettings() }, { id: 'test-extension', url: 'chrome-extension://test-extension/options.html#phrases' });
    expect(response.error).toBeUndefined();
    expect(response.settings).toEqual(defaultSettings());
  });
  it('updates recommendations on installed/update event while preserving removals', async () => {
    const settings = defaultSettings(); settings.phrases = settings.phrases.filter((p) => p.id !== 'once-1');
    settings.seenRecommendations = settings.seenRecommendations.filter((id) => id !== 'crypto-9');
    settings.phrases = settings.phrases.filter((p) => p.id !== 'crypto-9');
    const f = fixture({ settings }); await f.drain();
    f.api.runtime.onInstalled.emit({ reason: 'update' }); await f.drain();
    const updated = f.local.settings as Settings;
    expect(updated.phrases.some((p) => p.id === 'once-1')).toBe(false);
    expect(updated.phrases.some((p) => p.id === 'crypto-9')).toBe(true);
  });
});
