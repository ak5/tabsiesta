import { describe, expect, it } from 'vitest';
import { addSuggestedSites, defaultSettings, editPhrase, normalizeSite, normalizeText, RECOMMENDATIONS, restoreBehavior, restoreRecommendations, SUGGESTED_SITES, updateRecommendations, validateSettings } from '../src/lib/settings';

describe('phrase settings', () => {
  it('includes one-time and crypto language enabled by default', () => {
    const settings = defaultSettings();
    expect(settings.addRecommendations).toBe(true);
    expect(settings.phrases.find((p) => p.text === 'Seed phrase')?.enabled).toBe(true);
    expect(settings.phrases.some((p) => normalizeText(p.text) === 'wallet')).toBe(false);
  });
  it('adds only new recommendations, respecting removals, disabled entries and custom edits', () => {
    let settings = defaultSettings();
    settings.phrases = settings.phrases.filter((p) => p.id !== 'once-1');
    settings.phrases[0]!.enabled = false;
    settings = editPhrase(settings, 'crypto-1', 'Never reload this wallet backup');
    const next = updateRecommendations(settings, [...RECOMMENDATIONS, { id: 'next-1', text: 'Download your backup codes' }]);
    expect(next.phrases.some((p) => p.id === 'once-1')).toBe(false);
    expect(next.phrases.some((p) => p.id === 'crypto-1')).toBe(false);
    expect(next.phrases.some((p) => p.text === 'Never reload this wallet backup' && !p.recommended)).toBe(true);
    expect(next.phrases.find((p) => p.id === settings.phrases[0]!.id)?.enabled).toBe(false);
    expect(next.phrases.find((p) => p.id === 'next-1')?.enabled).toBe(true);
  });
  it('does not catch up skipped recommendations after re-enabling automatic additions', () => {
    const catalog = [...RECOMMENDATIONS, { id: 'next-1', text: 'New phrase' }];
    const skipped = updateRecommendations({ ...defaultSettings(), addRecommendations: false }, catalog);
    const enabled = updateRecommendations({ ...skipped, addRecommendations: true }, catalog);
    expect(enabled.phrases.some((p) => p.id === 'next-1')).toBe(false);
    expect(enabled.seenRecommendations).toContain('next-1');
  });
  it('restores defaults without losing custom phrases or edits', () => {
    const settings = editPhrase(defaultSettings(), 'once-1', 'A special warning');
    settings.phrases.push({ id: 'my-phrase', text: 'Do not close this receipt', recommended: false, enabled: false });
    settings.phrases = settings.phrases.filter((p) => p.id !== 'crypto-1');
    settings.protectAudio = false;
    const next = restoreRecommendations(settings);
    expect(next.phrases.find((p) => p.id === 'once-1')?.enabled).toBe(true);
    expect(next.phrases.find((p) => p.id === 'crypto-1')?.enabled).toBe(true);
    expect(next.phrases.find((p) => p.id === 'my-phrase')?.enabled).toBe(false);
    expect(next.phrases.some((p) => p.text === 'A special warning')).toBe(true);
    expect(next.protectAudio).toBe(false);
  });
  it('deduplicates equivalent custom and recommended text without losing custom state', () => {
    const settings = defaultSettings();
    settings.phrases.push({ id: 'mine', text: '  ONLY   SHOWN ONCE ', enabled: false, recommended: false });
    const restored = restoreRecommendations(settings);
    expect(restored.phrases.filter((p) => normalizeText(p.text) === 'only shown once')).toHaveLength(1);
    expect(restored.phrases.find((p) => p.id === 'mine')?.enabled).toBe(false);
  });
  it('restores behavioral settings while preserving lists', () => {
    const settings = { ...defaultSettings(), idleMinutes: 60 as const, sites: ['example.com'] };
    const restored = restoreBehavior(settings);
    expect(restored.idleMinutes).toBe(10);
    expect(restored.sites).toEqual(['example.com']);
    expect(restored.phrases).toEqual(settings.phrases);
  });
  it('normalizes punctuation, case and whitespace without interpreting regex', () => {
    expect(normalizeText('You WON’T   see\nthis')).toBe("you won't see this");
    expect(normalizeText('24‑word recovery phrase')).toBe('24-word recovery phrase');
  });
  it('rejects invalid settings and edited defaults masquerading as recommendations', () => {
    expect(() => validateSettings({ ...defaultSettings(), idleMinutes: 0 })).toThrow();
    expect(() => validateSettings({ ...defaultSettings(), protectAudio: 'yes' })).toThrow();
    const settings = defaultSettings(); settings.phrases[0]!.text = 'changed';
    expect(() => validateSettings(settings)).toThrow();
  });
});

describe('site input', () => {
  it('seeds new installs with valid sites as ordinary independent settings', () => {
    const first = defaultSettings();
    expect(validateSettings(first).sites).toEqual([...SUGGESTED_SITES]);
    first.sites.pop();
    expect(defaultSettings().sites).toEqual([...SUGGESTED_SITES]);
  });
  it('preserves removed sites and existing lists during updates and behavior resets', () => {
    const saved = { ...defaultSettings(), sites: ['custom.example'] };
    expect(updateRecommendations(validateSettings(saved)).sites).toEqual(['custom.example']);
    expect(restoreBehavior(saved).sites).toEqual(['custom.example']);
    expect(validateSettings({ ...saved, sites: [] }).sites).toEqual([]);
  });
  it('adds suggestions explicitly without removing custom sites or adding duplicates', () => {
    const saved = { ...defaultSettings(), sites: ['custom.example', 'mail.google.com'] };
    const next = addSuggestedSites(saved);
    expect(next.sites).toContain('custom.example');
    expect(next.sites.filter((site) => site === 'mail.google.com')).toHaveLength(1);
    expect(addSuggestedSites(next)).toEqual(next);
    expect(saved.sites).toEqual(['custom.example', 'mail.google.com']);
  });
  it('normalizes hostnames, URLs and international hostnames', () => {
    expect(normalizeSite('https://EXAMPLE.com/')).toBe('example.com');
    expect(normalizeSite('bücher.de')).toBe('xn--bcher-kva.de');
    expect(normalizeSite('localhost')).toBe('localhost');
  });
  it.each(['example.com/path', '*.example.com', 'https://user:pass@example.com', 'example.com:123', 'file:///tmp/a', 'hello world'])('rejects %s', (input) => {
    expect(() => normalizeSite(input)).toThrow();
  });
});
