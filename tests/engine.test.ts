import { describe, expect, it, vi } from 'vitest';
import { createDiscardEngine, type DiscardTrigger, type EngineDependencies } from '../src/lib/engine';
import { defaultSettings } from '../src/lib/settings';
import { isProtectedSite, type GuardStatus, type TabSnapshot } from '../src/lib/policy';

const safe: GuardStatus = { ready: true, complete: true, dirty: false, phrase: false };
function fixture() {
  const tab: TabSnapshot = { id: 1, url: 'https://example.com/', active: false, pinned: false, discarded: false, groupId: 2, windowId: 1, status: 'complete' };
  let settings = defaultSettings();
  const deps: EngineDependencies = {
    getTab: vi.fn(async () => ({ ...tab })), getSettings: () => settings,
    getIdleSince: () => 0, now: () => 600_000, isManual: () => false,
    groupCollapsed: vi.fn(async () => true), checkGuards: vi.fn(async () => [{ ...safe }]),
    discard: vi.fn(async () => tab), documentVersion: () => 0,
  };
  return { tab, deps, engine: createDiscardEngine(deps), settings, replaceSettings: () => { settings = { ...settings }; } };
}
const triggers: DiscardTrigger[] = [{ kind: 'idle' }, { kind: 'collapse', groupId: 2 }];
describe.each(triggers)('$kind safety pipeline', (trigger) => {
  it('discards a safe tab using its explicit ID', async () => {
    const { engine, deps } = fixture(); expect(await engine.tryDiscard(1, trigger)).toBe('discarded');
    expect(deps.discard).toHaveBeenCalledWith(1);
  });
  it.each([
    ['active', { active: true }], ['audio', { audible: true }], ['pinned', { pinned: true }],
    ['frozen', { frozen: true }], ['loading', { status: 'loading' }], ['unsupported', { url: 'chrome://settings' }],
    ['already-discarded', { discarded: true }],
  ] as const)('protects %s', async (reason, changes) => {
    const { tab, engine, deps } = fixture(); Object.assign(tab, changes);
    expect(await engine.tryDiscard(1, trigger)).toBe(reason); expect(deps.discard).not.toHaveBeenCalled();
  });
  it.each(['dirty', 'phrase', 'incomplete', 'missing'] as const)('protects %s frame state', async (state) => {
    const { engine, deps } = fixture();
    deps.checkGuards = vi.fn(async () => state === 'missing' ? [] : [safe, { ...safe, dirty: state === 'dirty', phrase: state === 'phrase', complete: state !== 'incomplete' }]);
    const result = await engine.tryDiscard(1, trigger);
    expect(result).toBe(state === 'dirty' ? 'form' : state === 'phrase' ? 'phrase' : 'unknown');
    expect(deps.discard).not.toHaveBeenCalled();
  });
  it('supports disabling audio and pinned exceptions', async () => {
    const { tab, engine, settings } = fixture(); tab.audible = true; tab.pinned = true;
    settings.protectAudio = false; settings.protectPinned = false;
    expect(await engine.tryDiscard(1, trigger)).toBe('discarded');
  });
  it('protects manually excluded tabs and sites', async () => {
    const { deps, engine, settings } = fixture(); deps.isManual = () => true;
    expect(await engine.tryDiscard(1, trigger)).toBe('manual');
    deps.isManual = () => false; settings.sites = ['example.com'];
    expect(await engine.tryDiscard(1, trigger)).toBe('site');
  });
  it('rechecks activation while safety inspection runs', async () => {
    const { deps, engine, tab } = fixture(); deps.checkGuards = async () => { tab.active = true; return [safe]; };
    expect(await engine.tryDiscard(1, trigger)).toBe('active'); expect(deps.discard).not.toHaveBeenCalled();
  });
  it('rejects same-URL navigation during safety inspection', async () => {
    const { deps, engine } = fixture(); let version = 0; deps.documentVersion = () => version;
    deps.checkGuards = async () => { version++; return [safe]; };
    expect(await engine.tryDiscard(1, trigger)).toBe('unknown');
  });
  it('rejects a settings change during inspection', async () => {
    const { deps, engine, replaceSettings } = fixture(); deps.checkGuards = async () => { replaceSettings(); return [safe]; };
    expect(await engine.tryDiscard(1, trigger)).toBe('unknown');
  });
  it('handles a closed tab or discard rejection without throwing', async () => {
    const { deps, engine } = fixture(); deps.discard = async () => { throw new Error('Tab closed'); };
    expect(await engine.tryDiscard(1, trigger)).toBe('failed');
  });
});
describe('trigger coordination', () => {
  it('does not discard before the idle deadline', async () => {
    const { deps, engine } = fixture(); deps.now = () => 599999;
    expect(await engine.tryDiscard(1, { kind: 'idle' })).toBe('not-due');
  });
  it('collapse bypasses the idle deadline but respects settings and membership', async () => {
    const { deps, engine, settings, tab } = fixture(); deps.now = () => 0;
    expect(await engine.tryDiscard(1, { kind: 'collapse', groupId: 2 })).toBe('discarded');
    settings.collapseSleep = false;
    expect(await engine.tryDiscard(1, { kind: 'collapse', groupId: 2 })).toBe('group-changed');
    settings.collapseSleep = true; tab.groupId = 3;
    expect(await engine.tryDiscard(1, { kind: 'collapse', groupId: 2 })).toBe('group-changed');
  });
  it('cancels collapse sleeping if the group expands during inspection', async () => {
    const { deps, engine } = fixture(); deps.checkGuards = async () => { deps.groupCollapsed = async () => false; return [safe]; };
    expect(await engine.tryDiscard(1, { kind: 'collapse', groupId: 2 })).toBe('group-changed');
  });
  it('deduplicates overlapping collapse and idle requests', async () => {
    const { deps, engine } = fixture(); let release!: (statuses: GuardStatus[]) => void;
    deps.checkGuards = () => new Promise((resolve) => { release = resolve; });
    const first = engine.tryDiscard(1, { kind: 'idle' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await engine.tryDiscard(1, { kind: 'collapse', groupId: 2 })).toBe('busy');
    release([safe]); expect(await first).toBe('discarded'); expect(deps.discard).toHaveBeenCalledTimes(1);
  });
  it('uses hostname boundaries for site exceptions', () => {
    expect(isProtectedSite('https://sub.example.com/', ['example.com'])).toBe(true);
    expect(isProtectedSite('https://notexample.com/', ['example.com'])).toBe(false);
    expect(isProtectedSite('https://example.com.evil.test/', ['example.com'])).toBe(false);
  });
});
