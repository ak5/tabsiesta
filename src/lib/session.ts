import type { GuardStatus } from './policy';

export interface SessionState {
  idleSince: Record<string, number>;
  activeByWindow: Record<string, number>;
  groups: Record<string, boolean>;
  manual: Record<string, boolean>;
  guards: Record<string, Record<string, { documentId: string; status: GuardStatus }>>;
  sleeps: Record<string, { trigger: 'idle' | 'collapse' | 'manual'; at: number }>;
}

export function emptySession(): SessionState {
  return { idleSince: {}, activeByWindow: {}, groups: {}, manual: {}, guards: {}, sleeps: {} };
}

export function activateTab(state: SessionState, tabId: number, windowId: number, now: number): void {
  const previous = state.activeByWindow[windowId];
  if (previous !== undefined && previous !== tabId) state.idleSince[previous] = now;
  state.activeByWindow[windowId] = tabId;
  delete state.idleSince[tabId];
}

export function removeTab(state: SessionState, tabId: number): void {
  delete state.idleSince[tabId];
  delete state.manual[tabId];
  delete state.guards[tabId];
  delete state.sleeps[tabId];
  for (const [windowId, active] of Object.entries(state.activeByWindow)) {
    if (active === tabId) delete state.activeByWindow[windowId];
  }
}

export function collapsedTransition(state: SessionState, id: number, collapsed: boolean): boolean {
  const previous = state.groups[id];
  state.groups[id] = collapsed;
  return previous === false && collapsed;
}
