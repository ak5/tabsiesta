import { defineBackground } from 'wxt/utils/define-background';
import { createDiscardEngine, type DiscardTrigger } from '../lib/engine';
import { guardProtection, idleExpired, tabProtection, type GuardStatus } from '../lib/policy';
import { activateTab, collapsedTransition, emptySession, removeTab, type SessionState } from '../lib/session';
import { defaultSettings, SETTINGS_KEY, updateRecommendations, validateSettings, type Settings } from '../lib/settings';

const SESSION_KEY = 'session';
const ALARM = 'idle-sweep';
const MENU = 'keep-awake';
const UNKNOWN: GuardStatus = { ready: false, complete: false, dirty: false, phrase: false };

function validStatus(value: unknown): value is GuardStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Record<string, unknown>;
  return ['ready', 'complete', 'dirty', 'phrase'].every((key) => typeof status[key] === 'boolean');
}

// Copy the permitted fields rather than retaining an entire message or result.
function safetyStatus(status: GuardStatus, settings: Settings): GuardStatus {
  const candidates = new Set(status.phrase && Array.isArray(status.phraseIds) ? status.phraseIds.slice(0, 500).filter((id) => typeof id === 'string' && id.length <= 100) : []);
  const phraseIds = settings.phrases.filter((phrase) => candidates.has(phrase.id)).map((phrase) => phrase.id);
  return { ready: status.ready, complete: status.complete, dirty: status.dirty, phrase: status.phrase, ...(phraseIds.length ? { phraseIds } : {}) };
}

function timeout<T>(promise: Promise<T>, milliseconds = 2500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Page safety check timed out.')), milliseconds);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}

export default defineBackground(() => {
  let settings: Settings = defaultSettings();
  let state = emptySession();
  const versions = new Map<number, number>();
  const discardTriggers = new Map<number, DiscardTrigger>();
  let queue = Promise.resolve();

  const persist = () => chrome.storage.session.set({ [SESSION_KEY]: state });
  const enqueue = (job: () => Promise<unknown>) => {
    const result = queue.then(() => ready).then(job);
    queue = result.then(() => {}, () => { console.warn('TabSiesta: operation failed.'); });
    return result;
  };

  async function framesFor(id: number) {
    return (await chrome.webNavigation.getAllFrames({ tabId: id })) ?? [];
  }

  async function checkGuards(id: number, currentSettings: Settings): Promise<GuardStatus[]> {
    try {
      const before = await framesFor(id);
      if (!before.length) return [UNKNOWN];
      const probe = () => chrome.scripting.executeScript({
        target: { tabId: id, allFrames: true },
        func: (config: Settings) => {
          // This function is serialized by Chrome: do not reference outer variables.
          const guard = (globalThis as typeof globalThis & {
            __tabSiestaGuard?: { configure: (settings: Settings) => void; status: () => GuardStatus };
          }).__tabSiestaGuard;
          if (!guard) return { ready: false, complete: false, dirty: false, phrase: false, missing: true };
          guard.configure(config);
          return guard.status();
        },
        args: [currentSettings],
      });
      let results = await timeout(probe());
      const missingFrames = results.filter((result) => result.result && 'missing' in result.result && result.result.missing).map((result) => result.frameId);
      if (missingFrames.length) {
        const files = chrome.runtime.getManifest().content_scripts?.flatMap((script) => script.js ?? []) ?? [];
        if (!files.length) return [UNKNOWN];
        // Reinjecting WXT content scripts invalidates their previous context. Only
        // inject missing frames, so existing dirty/sticky protection is preserved.
        await timeout(chrome.scripting.executeScript({ target: { tabId: id, frameIds: missingFrames }, files }));
        results = await timeout(probe());
      }
      const after = await framesFor(id);
      const signature = (frames: typeof before) => JSON.stringify(frames.map((frame) => [frame.frameId, frame.documentId, frame.url]).sort((a, b) => Number(a[0]) - Number(b[0])));
      if (signature(before) !== signature(after) || results.length !== after.length) return [UNKNOWN];
      const cache: SessionState['guards'][string] = {};
      for (const frame of after) {
        const result = results.find((item) => item.frameId === frame.frameId && item.documentId === frame.documentId);
        if (!result || !validStatus(result.result)) return [UNKNOWN];
        cache[frame.frameId] = { documentId: frame.documentId, status: safetyStatus(result.result, currentSettings) };
      }
      state.guards[id] = cache;
      return Object.values(cache).map((frame) => frame.status);
    } catch { return [UNKNOWN]; }
  }

  const engine = createDiscardEngine({
    getTab: (id) => chrome.tabs.get(id), getSettings: () => settings,
    getIdleSince: (id) => state.idleSince[id], isManual: (id) => !!state.manual[id],
    groupCollapsed: async (id) => (await chrome.tabGroups.get(id)).collapsed,
    checkGuards, discard: async (id) => {
      const tab = await chrome.tabs.discard(id);
      if (tab?.id === undefined || !tab.discarded) throw new Error('Discard was not confirmed.');
      // Native discard can replace WebContents and assign a new extension tab ID.
      const trigger = discardTriggers.get(id);
      if (trigger) state.sleeps[tab.id] = { trigger: trigger.kind, at: Date.now() };
      return tab;
    }, now: Date.now,
    documentVersion: (id) => versions.get(id) ?? 0,
  });
  async function tryDiscard(id: number, trigger: DiscardTrigger) {
    discardTriggers.set(id, trigger);
    try { return await engine.tryDiscard(id, trigger); }
    finally { discardTriggers.delete(id); }
  }

  async function initialize(): Promise<void> {
    const [local, session, tabs] = await Promise.all([
      chrome.storage.local.get(SETTINGS_KEY), chrome.storage.session.get(SESSION_KEY),
      chrome.tabs.query({}),
    ]);
    // tabGroups.query requires a current window, even for an all-window query.
    // Resolve groups from the tab snapshot instead; Chrome may start windowless.
    const groupIds = [...new Set(tabs.map((tab) => tab.groupId).filter((id) => id >= 0))];
    const groups = await Promise.all(groupIds.map(async (id) => {
      try { return await chrome.tabGroups.get(id); }
      catch { return undefined; } // A group can close while initialization awaits Chrome.
    }));
    settings = local[SETTINGS_KEY] ? validateSettings(local[SETTINGS_KEY]) : defaultSettings();
    if (!local[SETTINGS_KEY]) await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    state = session[SESSION_KEY] ? { ...emptySession(), ...session[SESSION_KEY] } : emptySession();
    const ids = new Set(tabs.map((tab) => tab.id));
    for (const id of new Set([...Object.keys(state.idleSince), ...Object.keys(state.manual), ...Object.keys(state.guards), ...Object.keys(state.sleeps)])) {
      if (!ids.has(Number(id))) removeTab(state, Number(id));
    }
    state.activeByWindow = {};
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      if (!tab.discarded) delete state.sleeps[tab.id];
      if (tab.active) { state.activeByWindow[tab.windowId] = tab.id; delete state.idleSince[tab.id]; }
      else state.idleSince[tab.id] ??= Date.now();
    }
    // Unknown groups stay unknown: never infer an expanded-to-collapsed transition.
    state.groups = Object.fromEntries(groups.flatMap((group) => group ? [[group.id, group.collapsed]] : []));
    await persist();
    if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: MENU, title: 'Keep this tab awake', contexts: ['page'], type: 'checkbox', checked: false });
  }

  async function getStats() {
    const tabs = await chrome.tabs.query({});
    let protectedCount = 0;
    for (const tab of tabs) {
      if (tab.id === undefined || tab.discarded) continue;
      if (tabProtection(tab, settings, !!state.manual[tab.id])) { protectedCount++; continue; }
      // No page scans on popup open. Validate existing cached frame coverage instead.
      try {
        const frames = await framesFor(tab.id);
        const cache = state.guards[tab.id] ?? {};
        const statuses = frames.map((frame) => cache[frame.frameId]?.documentId === frame.documentId ? cache[frame.frameId]!.status : UNKNOWN);
        if (guardProtection(statuses, settings)) protectedCount++;
      } catch { protectedCount++; }
    }
    return { total: tabs.length, loaded: tabs.filter((tab) => !tab.discarded).length, discarded: tabs.filter((tab) => tab.discarded).length, protected: protectedCount };
  }

  async function getAudit() {
    const labels = {
      active: 'Selected tab in its window', audio: 'Playing audio', pinned: 'Pinned tab', manual: 'Keep this tab awake is enabled',
      site: 'Protected site', form: 'Unsaved form input detected', phrase: 'Sensitive warning phrase detected',
      unknown: 'Page safety has not been verified', frozen: 'Frozen by Chrome', loading: 'Page is loading', unsupported: 'Chrome does not allow safety checks on this page',
    };
    return Promise.all((await chrome.tabs.query({})).filter((tab) => tab.id !== undefined).map(async (tab) => {
      const id = tab.id!;
      let reason: string;
      let phrases: { id: string; text: string }[] = [];
      if (tab.discarded) {
        const sleep = state.sleeps[id];
        reason = sleep ? { idle: 'TabSiesta idle timer', collapse: 'TabSiesta group collapse', manual: 'Slept from Tab Audit' }[sleep.trigger] : 'Sleep reason unknown — Chrome, another extension, or an earlier session';
      } else {
        let protection = tabProtection(tab, settings, !!state.manual[id]);
        let unknown = labels.unknown;
        {
          try {
            const frames = await framesFor(id), cache = state.guards[id] ?? {};
            const statuses = frames.map((frame) => cache[frame.frameId]?.documentId === frame.documentId ? cache[frame.frameId]!.status : UNKNOWN);
            if (!frames.length) unknown = 'Chrome returned no inspectable page frames';
            else if (frames.some((frame) => cache[frame.frameId]?.documentId !== frame.documentId)) unknown = 'No safety result for the current page or one of its frames yet';
            else if (statuses.some((status) => !status.ready)) unknown = 'Page safety check is still initializing';
            else if (statuses.some((status) => !status.complete)) unknown = 'Page safety scan is incomplete; the page may exceed the scan size limit';
            protection ??= guardProtection(statuses, settings);
            if (settings.phraseGuard) {
              const ids = new Set(statuses.filter((status) => status.phrase).flatMap((status) => status.phraseIds ?? []));
              phrases = settings.phrases.filter((phrase) => ids.has(phrase.id)).map(({ id, text }) => ({ id, text }));
            }
          } catch { protection ??= 'unknown'; unknown = 'Chrome could not provide page frame information'; }
        }
        reason = protection === 'unknown' ? unknown : protection === 'phrase' ? phrases.length ? 'Warning phrase blocked sleep' : 'A previously detected warning phrase is keeping this page awake' : protection ? labels[protection] : idleExpired(state.idleSince[id], Date.now(), settings.idleMinutes)
          ? 'Idle threshold reached; awaiting the next sweep and safety checks'
          : `Idle threshold not reached (${settings.idleMinutes} minutes)`;
      }
      return { id, windowId: tab.windowId, title: tab.title || 'Untitled tab', url: tab.url ?? '', sleeping: !!tab.discarded, reason, phrases };
    }));
  }

  chrome.tabGroups.onUpdated.addListener((group) => {
    void enqueue(async () => {
      const collapsed = collapsedTransition(state, group.id, group.collapsed);
      await persist();
      if (!collapsed || !settings.collapseSleep) return;
      const tabs = await chrome.tabs.query({ groupId: group.id });
      for (const tab of tabs) if (tab.id !== undefined) await tryDiscard(tab.id, { kind: 'collapse', groupId: group.id });
      await persist();
    });
  });
  chrome.tabGroups.onCreated.addListener((group) => { void enqueue(async () => { state.groups[group.id] = group.collapsed; await persist(); }); });
  chrome.tabGroups.onRemoved.addListener((group) => { void enqueue(async () => { delete state.groups[group.id]; await persist(); }); });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM) return;
    void enqueue(async () => {
      for (const tab of await chrome.tabs.query({})) {
        if (tab.id !== undefined && !tab.active && idleExpired(state.idleSince[tab.id], Date.now(), settings.idleMinutes)) await tryDiscard(tab.id, { kind: 'idle' });
      }
      await persist();
    });
  });
  chrome.tabs.onActivated.addListener((event) => {
    const at = Date.now();
    void enqueue(async () => {
      activateTab(state, event.tabId, event.windowId, at);
      await chrome.contextMenus.update(MENU, { checked: !!state.manual[event.tabId] });
      await persist();
    });
  });
  chrome.tabs.onCreated.addListener((tab) => { void enqueue(async () => { if (tab.id !== undefined && !tab.active) state.idleSince[tab.id] = Date.now(); await persist(); }); });
  chrome.tabs.onRemoved.addListener((id) => { versions.delete(id); void enqueue(async () => { removeTab(state, id); await persist(); }); });
  chrome.tabs.onReplaced.addListener((added, removed) => {
    versions.delete(removed);
    versions.set(added, (versions.get(added) ?? 0) + 1);
    void enqueue(async () => {
      const manual = state.manual[removed];
      const since = state.idleSince[removed];
      const sleep = state.sleeps[removed];
      removeTab(state, removed);
      if (manual) state.manual[added] = true;
      const tab = await chrome.tabs.get(added);
      if (tab.discarded && sleep) state.sleeps[added] ??= sleep;
      if (!tab.discarded) delete state.sleeps[added];
      if (tab.active) activateTab(state, added, tab.windowId, Date.now()); else state.idleSince[added] = since ?? Date.now();
      await persist();
    });
  });
  chrome.tabs.onAttached.addListener((id) => { void enqueue(async () => { const tab = await chrome.tabs.get(id); if (tab.active) activateTab(state, id, tab.windowId, Date.now()); else state.idleSince[id] ??= Date.now(); await persist(); }); });
  chrome.tabs.onDetached.addListener((id, info) => { void enqueue(async () => { if (state.activeByWindow[info.oldWindowId] === id) delete state.activeByWindow[info.oldWindowId]; await persist(); }); });
  chrome.tabs.onUpdated.addListener((id, changes) => {
    if (changes.discarded === false || changes.status === 'loading' || changes.url) delete state.sleeps[id];
    if (changes.status === 'loading' || changes.url || changes.discarded !== undefined) {
      versions.set(id, (versions.get(id) ?? 0) + 1);
      delete state.guards[id];
      void enqueue(persist);
    }
  });
  chrome.webNavigation.onCommitted.addListener((event) => {
    versions.set(event.tabId, (versions.get(event.tabId) ?? 0) + 1);
    if (event.frameId === 0) delete state.guards[event.tabId];
    else if (state.guards[event.tabId]) delete state.guards[event.tabId]![event.frameId];
    void enqueue(persist);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY]?.newValue) {
      try { settings = validateSettings(changes[SETTINGS_KEY].newValue); }
      catch { /* Invalid externally-written settings will fail on next initialization. */ }
    }
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU || tab?.id === undefined) return;
    const id = tab.id;
    void enqueue(async () => { if (info.checked) state.manual[id] = true; else delete state.manual[id]; await persist(); });
  });
  chrome.runtime.onInstalled.addListener(() => {
    void enqueue(async () => {
      settings = updateRecommendations(settings);
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    });
  });
  chrome.runtime.onStartup.addListener(() => { void enqueue(async () => { if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 1 }); }); });
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return false;
    const request = message as { type: string; settings?: unknown; status?: unknown; tabId?: unknown; action?: unknown };
    // Content scripts can publish status only; settings/stats messages belong to extension pages.
    if (request.type === 'GUARD_STATUS') {
      if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || !sender.documentId || !validStatus(request.status)) return false;
      const id = sender.tab.id, frameId = sender.frameId ?? 0, documentId = sender.documentId;
      const incoming = request.status;
      void enqueue(async () => {
        const status = safetyStatus(incoming, settings);
        const frames = await framesFor(id);
        if (!frames.some((frame) => frame.frameId === frameId && frame.documentId === documentId)) return;
        state.guards[id] ??= {};
        state.guards[id]![frameId] = { documentId, status };
        await persist();
      });
      return false;
    }
    let senderPage = '';
    try {
      const url = new URL(sender.url ?? '');
      // URL.origin is "null" for extension URLs; compare protocol/host/path.
      senderPage = `${url.protocol}//${url.host}${url.pathname}`;
    }
    catch { return false; }
    if (sender.id !== chrome.runtime.id || !['options.html', 'popup.html', 'audit.html'].map((page) => chrome.runtime.getURL(page)).includes(senderPage)) return false;
    void enqueue(async () => {
      switch (request.type) {
        case 'GET_SETTINGS': return { settings };
        case 'SAVE_SETTINGS': {
          const next = validateSettings(request.settings);
          // Recommendation history is extension-owned, not editable by the UI.
          next.seenRecommendations = settings.seenRecommendations;
          await chrome.storage.local.set({ [SETTINGS_KEY]: next });
          settings = next;
          return { settings };
        }
        case 'GET_STATS': return { stats: await getStats() };
        case 'GET_AUDIT': return { tabs: await getAudit() };
        case 'AUDIT_ACTION': {
          if (senderPage !== chrome.runtime.getURL('audit.html') || typeof request.tabId !== 'number' || !Number.isInteger(request.tabId) || request.tabId < 0) throw new Error('Invalid audit action.');
          const id = request.tabId;
          if (request.action === 'sleep') {
            const result = await tryDiscard(id, { kind: 'manual' });
            await persist();
            return { result };
          }
          if (request.action === 'close') {
            await chrome.tabs.remove(id);
            removeTab(state, id); await persist();
            return { result: 'closed' };
          }
          if (request.action === 'focus') {
            // Activate the existing tab and its window without opening a duplicate.
            const tab = await chrome.tabs.update(id, { active: true });
            if (!tab) throw new Error('Tab is no longer available.');
            await chrome.windows.update(tab.windowId, { focused: true });
            return { result: 'focused' };
          }
          throw new Error('Unknown audit action.');
        }
        default: throw new Error('Unknown request.');
      }
    }).then(sendResponse, () => sendResponse({ error: request.type === 'AUDIT_ACTION' ? 'The tab action could not be completed. Refresh the audit and try again.' : 'Operation failed. Check your settings and try again.' }));
    return true;
  });

  const ready = initialize();
  void ready.catch(() => console.error('TabSiesta initialization failed.'));
});
