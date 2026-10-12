import type { Settings } from './settings';

export type ProtectionReason = 'active' | 'audio' | 'pinned' | 'manual' | 'site' | 'form' | 'phrase' | 'unknown' | 'frozen' | 'loading' | 'unsupported';
export interface GuardStatus {
  phraseIds?: string[];
  ready: boolean;
  dirty: boolean;
  phrase: boolean;
  complete: boolean;
}
export interface TabSnapshot {
  id?: number;
  url?: string;
  pendingUrl?: string;
  active: boolean;
  audible?: boolean;
  pinned: boolean;
  discarded: boolean;
  frozen?: boolean;
  status?: string;
  groupId: number;
  windowId: number;
}

export function isProtectedSite(url: string, sites: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    return sites.some((site) => host === site || host.endsWith(`.${site}`));
  } catch { return false; }
}

export function tabProtection(tab: TabSnapshot, settings: Settings, manual: boolean): ProtectionReason | null {
  if (tab.active) return 'active';
  if (manual) return 'manual';
  if (settings.protectAudio && tab.audible) return 'audio';
  if (settings.protectPinned && tab.pinned) return 'pinned';
  if (tab.frozen) return 'frozen';
  if (tab.status === 'loading' || tab.pendingUrl) return 'loading';
  if (!tab.url || !/^https?:\/\//i.test(tab.url)) return 'unsupported';
  if (isProtectedSite(tab.url, settings.sites)) return 'site';
  return null;
}

export function guardProtection(statuses: GuardStatus[], settings: Settings): ProtectionReason | null {
  if (!statuses.length || statuses.some((status) => !status.ready || !status.complete)) return 'unknown';
  if (statuses.some((status) => status.dirty)) return 'form';
  if (settings.phraseGuard && statuses.some((status) => status.phrase)) return 'phrase';
  return null;
}

export function idleExpired(since: number | undefined, now: number, minutes: number): boolean {
  return since !== undefined && now >= since && now - since >= minutes * 60_000;
}
