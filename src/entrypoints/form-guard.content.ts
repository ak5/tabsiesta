import { defineContentScript } from 'wxt/utils/define-content-script';
import { createPageGuard, GUARD_KEY, type PageGuard } from '../lib/page-guard';
import { defaultSettings, SETTINGS_KEY, validateSettings } from '../lib/settings';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  main(ctx) {
    const page = globalThis as typeof globalThis & { [GUARD_KEY]?: PageGuard };
    if (page[GUARD_KEY]) return;
    // Publish an unknown state until local settings have loaded successfully.
    let initialized = false;
    let guard: PageGuard | undefined;
    const late = document.readyState !== 'loading';
    page[GUARD_KEY] = {
      status: () => guard?.status() ?? { ready: false, dirty: false, phrase: false, complete: false },
      configure: (settings) => guard?.configure(settings),
      dispose: () => guard?.dispose(),
    };
    const publish = (status: ReturnType<PageGuard['status']>) => {
      if (!initialized) return;
      void chrome.runtime.sendMessage({ type: 'GUARD_STATUS', status }).catch(() => { /* Worker may be reloading. */ });
    };
    void chrome.storage.local.get(SETTINGS_KEY).then((stored) => {
      if (ctx.isInvalid) return;
      const settings = stored[SETTINGS_KEY] ? validateSettings(stored[SETTINGS_KEY]) : defaultSettings();
      initialized = true;
      guard = createPageGuard(document, settings, publish, late);
    }).catch(() => { /* Failed initialization remains unknown and prevents discards. */ });
    const onSettings = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]?.newValue || !guard) return;
      try { guard.configure(validateSettings(changes[SETTINGS_KEY].newValue)); }
      catch { guard.dispose(); guard = undefined; }
    };
    chrome.storage.onChanged.addListener(onSettings);
    ctx.onInvalidated(() => {
      chrome.storage.onChanged.removeListener(onSettings);
      page[GUARD_KEY]?.dispose();
      delete page[GUARD_KEY];
    });
  },
});
