import { guardProtection, idleExpired, tabProtection, type GuardStatus, type ProtectionReason, type TabSnapshot } from './policy';
import type { Settings } from './settings';

export type DiscardTrigger = { kind: 'idle' } | { kind: 'collapse'; groupId: number } | { kind: 'manual' };
export type DiscardResult = 'discarded' | 'already-discarded' | 'not-due' | 'group-changed' | 'busy' | 'failed' | ProtectionReason;
export interface EngineDependencies {
  getTab: (id: number) => Promise<TabSnapshot>;
  getSettings: () => Settings;
  getIdleSince: (id: number) => number | undefined;
  isManual: (id: number) => boolean;
  groupCollapsed: (id: number) => Promise<boolean>;
  checkGuards: (id: number, settings: Settings) => Promise<GuardStatus[]>;
  discard: (id: number) => Promise<unknown>;
  now: () => number;
  documentVersion: (id: number) => number;
}

/** Both automatic triggers use this exact policy. Chrome's final call has no atomic guard API. */
export function createDiscardEngine(deps: EngineDependencies) {
  const inFlight = new Set<number>();
  async function evaluate(id: number, trigger: DiscardTrigger): Promise<DiscardResult | null> {
    const tab = await deps.getTab(id);
    const settings = deps.getSettings();
    if (tab.discarded) return 'already-discarded';
    const protection = tabProtection(tab, settings, deps.isManual(id));
    if (protection) return protection;
    if (trigger.kind === 'idle' && !idleExpired(deps.getIdleSince(id), deps.now(), settings.idleMinutes)) return 'not-due';
    if (trigger.kind === 'collapse' && (!settings.collapseSleep || tab.groupId !== trigger.groupId || !await deps.groupCollapsed(trigger.groupId))) return 'group-changed';
    return null;
  }
  return {
    async tryDiscard(id: number, trigger: DiscardTrigger): Promise<DiscardResult> {
      if (inFlight.has(id)) return 'busy';
      inFlight.add(id);
      try {
        const first = await evaluate(id, trigger);
        if (first) return first;
        const before = await deps.getTab(id);
        const documentVersion = deps.documentVersion(id);
        const checkedSettings = deps.getSettings();
        const guards = await deps.checkGuards(id, checkedSettings);
        const reason = guardProtection(guards, deps.getSettings());
        if (reason) return reason;
        // A settings write or navigation while inspecting invalidates the inspection.
        if (deps.getSettings() !== checkedSettings) return 'unknown';
        if (deps.documentVersion(id) !== documentVersion) return 'unknown';
        const after = await deps.getTab(id);
        if (before.url !== after.url || before.pendingUrl !== after.pendingUrl) return 'unknown';
        const final = await evaluate(id, trigger);
        if (final) return final;
        if (deps.documentVersion(id) !== documentVersion) return 'unknown';
        await deps.discard(id);
        return 'discarded';
      } catch { return 'failed'; }
      finally { inFlight.delete(id); }
    },
  };
}
