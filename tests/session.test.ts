import { describe, expect, it } from 'vitest';
import { activateTab, collapsedTransition, emptySession, removeTab } from '../src/lib/session';
import { idleExpired } from '../src/lib/policy';

describe('tab lifecycle', () => {
  it('times inactivity from deactivation and resets when selected', () => {
    const state = emptySession();
    activateTab(state, 1, 1, 0);
    activateTab(state, 2, 1, 1000);
    expect(state.idleSince[1]).toBe(1000);
    expect(idleExpired(state.idleSince[1], 600999, 10)).toBe(false);
    expect(idleExpired(state.idleSince[1], 601000, 10)).toBe(true);
    activateTab(state, 1, 1, 700000);
    expect(state.idleSince[1]).toBeUndefined();
    expect(state.idleSince[2]).toBe(700000);
  });
  it('keeps separate active tabs for each window and survives serialization', () => {
    const state = emptySession(); activateTab(state, 1, 1, 0); activateTab(state, 2, 2, 0);
    const restored = JSON.parse(JSON.stringify(state));
    activateTab(restored, 3, 1, 100);
    expect(restored.activeByWindow[2]).toBe(2);
    expect(restored.idleSince[1]).toBe(100);
    expect(restored.idleSince[2]).toBeUndefined();
  });
  it('triggers only on expanded-to-collapsed transitions', () => {
    const state = emptySession();
    expect(collapsedTransition(state, 1, true)).toBe(false);
    expect(collapsedTransition(state, 1, true)).toBe(false);
    expect(collapsedTransition(state, 1, false)).toBe(false);
    expect(collapsedTransition(state, 1, true)).toBe(true);
    expect(collapsedTransition(state, 1, true)).toBe(false);
  });
  it('cleans up manual protection and frame status on close', () => {
    const state = emptySession(); state.manual[1] = true; state.idleSince[1] = 0; state.guards[1] = {};
    activateTab(state, 1, 1, 1); removeTab(state, 1);
    expect(state.manual[1]).toBeUndefined(); expect(state.guards[1]).toBeUndefined();
    expect(state.activeByWindow[1]).toBeUndefined();
  });
});
