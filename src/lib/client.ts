import type { Settings } from './settings';

export interface Stats { total: number; loaded: number; discarded: number; protected: number }
export interface AuditTab { id: number; windowId: number; title: string; url: string; sleeping: boolean; reason: string; phrases?: { id: string; text: string }[] }
export async function loadAudit(): Promise<AuditTab[]> {
  return (await request<{ tabs: AuditTab[] }>({ type: 'GET_AUDIT' })).tabs;
}
export async function auditAction(tabId: number, action: 'sleep' | 'close' | 'focus'): Promise<string> {
  return (await request<{ result: string }>({ type: 'AUDIT_ACTION', tabId, action })).result;
}

async function request<T>(message: object): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const response = await Promise.race([
    chrome.runtime.sendMessage(message),
    new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('The extension took too long to respond. Try again.')), 10_000); }),
  ]).finally(() => clearTimeout(timer));
  if (!response || response.error) throw new Error(response?.error ?? 'The extension did not respond. Try reloading it.');
  return response as T;
}
export async function loadSettings(): Promise<Settings> {
  return (await request<{ settings: Settings }>({ type: 'GET_SETTINGS' })).settings;
}
export async function saveSettings(settings: Settings): Promise<Settings> {
  return (await request<{ settings: Settings }>({ type: 'SAVE_SETTINGS', settings })).settings;
}
export async function loadStats(): Promise<Stats> {
  return (await request<{ stats: Stats }>({ type: 'GET_STATS' })).stats;
}
