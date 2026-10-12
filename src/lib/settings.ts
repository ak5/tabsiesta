export const SETTINGS_KEY = 'settings';
export const IDLE_MINUTES = [5, 10, 30, 60] as const;

// Starter entries are ordinary editable settings, never hidden policy rules.
export const SUGGESTED_SITES = [
  'mail.google.com', 'docs.google.com', 'drive.google.com',
  'chat.google.com', 'meet.google.com',
  'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
  'app.slack.com', 'notion.so',
  'vault.bitwarden.com', 'vault.bitwarden.eu',
  'my.1password.com', 'my.1password.eu', 'my.1password.ca',
] as const;

export interface Phrase {
  id: string;
  text: string;
  enabled: boolean;
  recommended: boolean;
}

export interface Settings {
  idleMinutes: (typeof IDLE_MINUTES)[number];
  protectAudio: boolean;
  protectPinned: boolean;
  collapseSleep: boolean;
  phraseGuard: boolean;
  addRecommendations: boolean;
  phrases: Phrase[];
  seenRecommendations: string[];
  sites: string[];
}

// IDs are permanent. Add recommendations with NEW IDs; never recycle an ID.
export const RECOMMENDATIONS: ReadonlyArray<{ id: string; text: string }> = [
  { id: 'once-1', text: 'Only shown once' },
  { id: 'once-2', text: 'Shown only once' },
  { id: 'once-3', text: 'You won’t be able to view this again' },
  { id: 'once-4', text: 'Copy this key now' },
  { id: 'once-5', text: 'Save your recovery codes' },
  { id: 'once-6', text: 'This secret cannot be retrieved' },
  { id: 'once-7', text: 'You will not be able to see it again' },
  { id: 'crypto-1', text: 'Secret recovery phrase' },
  { id: 'crypto-2', text: 'Seed phrase' },
  { id: 'crypto-3', text: 'Recovery phrase' },
  { id: 'crypto-4', text: 'Mnemonic phrase' },
  { id: 'crypto-5', text: 'Back up your wallet' },
  { id: 'crypto-6', text: 'Save your private key' },
  { id: 'crypto-7', text: 'Write down these words' },
  { id: 'crypto-8', text: '12-word recovery phrase' },
  { id: 'crypto-9', text: '24-word recovery phrase' },
];

export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[‐‑–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function dedupePhrases(phrases: Phrase[]): Phrase[] {
  const seen = new Set<string>();
  return phrases.filter((phrase) => {
    const key = normalizeText(phrase.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function defaultSettings(): Settings {
  return {
    idleMinutes: 10, protectAudio: true, protectPinned: true, collapseSleep: true,
    phraseGuard: true, addRecommendations: true,
    phrases: RECOMMENDATIONS.map((phrase) => ({ ...phrase, enabled: true, recommended: true })),
    seenRecommendations: RECOMMENDATIONS.map((phrase) => phrase.id), sites: [...SUGGESTED_SITES],
  };
}

export function normalizeSite(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw || /[\s*]/.test(raw)) throw new Error('Enter a hostname such as example.com, without wildcards.');
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Enter a hostname only, without a port, path, or query.');
  }
  const host = url.hostname.replace(/\.$/, '');
  if (!host || (!host.includes('.') && host !== 'localhost' && !host.startsWith('['))) throw new Error('Enter a complete hostname.');
  return host;
}

export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings.');
  const input = value as Record<string, unknown>;
  if (!IDLE_MINUTES.includes(input.idleMinutes as Settings['idleMinutes'])) throw new Error('Choose a supported idle threshold.');
  for (const key of ['protectAudio', 'protectPinned', 'collapseSleep', 'phraseGuard', 'addRecommendations']) {
    if (typeof input[key] !== 'boolean') throw new Error(`Invalid setting: ${key}.`);
  }
  if (!Array.isArray(input.phrases) || input.phrases.length > 500) throw new Error('Use at most 500 phrases.');
  const ids = new Set<string>();
  const phrases = input.phrases.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid phrase.');
    const p = value as Record<string, unknown>;
    if (typeof p.id !== 'string' || !p.id || p.id.length > 100 || ids.has(p.id) || typeof p.text !== 'string' || !p.text.trim() || p.text.trim().length > 160 || typeof p.enabled !== 'boolean' || typeof p.recommended !== 'boolean') throw new Error('Phrases need unique IDs and 1–160 characters.');
    if (p.recommended && !RECOMMENDATIONS.some((r) => r.id === p.id && r.text === p.text)) throw new Error('Edited recommendations must be saved as custom phrases.');
    ids.add(p.id);
    return { id: p.id, text: p.text.trim(), enabled: p.enabled, recommended: p.recommended };
  });
  if (!Array.isArray(input.seenRecommendations) || input.seenRecommendations.length > 2000 || !input.seenRecommendations.every((id) => typeof id === 'string')) throw new Error('Invalid recommendation history.');
  if (!Array.isArray(input.sites) || input.sites.length > 500 || !input.sites.every((site) => typeof site === 'string')) throw new Error('Use at most 500 protected sites.');
  return {
    idleMinutes: input.idleMinutes as Settings['idleMinutes'],
    protectAudio: input.protectAudio as boolean, protectPinned: input.protectPinned as boolean,
    collapseSleep: input.collapseSleep as boolean, phraseGuard: input.phraseGuard as boolean,
    addRecommendations: input.addRecommendations as boolean,
    phrases: dedupePhrases(phrases), seenRecommendations: [...new Set(input.seenRecommendations as string[])],
    sites: [...new Set((input.sites as string[]).map(normalizeSite))],
  };
}

export function updateRecommendations(settings: Settings, catalog = RECOMMENDATIONS): Settings {
  const seen = new Set(settings.seenRecommendations);
  const additions = settings.addRecommendations
    ? catalog.filter((phrase) => !seen.has(phrase.id)).map((phrase) => ({ ...phrase, enabled: true, recommended: true }))
    : [];
  return {
    ...settings,
    phrases: dedupePhrases([...settings.phrases, ...additions]),
    seenRecommendations: [...new Set([...settings.seenRecommendations, ...catalog.map((phrase) => phrase.id)])],
  };
}

export function restoreRecommendations(settings: Settings): Settings {
  // Custom entries retain their exact text and enabled state, even if edited from a default.
  const custom = settings.phrases.filter((phrase) => !phrase.recommended);
  const defaults = RECOMMENDATIONS.map((phrase) => ({ ...phrase, enabled: true, recommended: true }));
  return { ...settings, phrases: dedupePhrases([...custom, ...defaults]), seenRecommendations: [...new Set([...settings.seenRecommendations, ...defaults.map((p) => p.id)])] };
}

export function restoreBehavior(settings: Settings): Settings {
  return { ...defaultSettings(), phrases: settings.phrases, sites: settings.sites, seenRecommendations: settings.seenRecommendations };
}

export function addSuggestedSites(settings: Settings): Settings {
  return { ...settings, sites: [...new Set([...settings.sites, ...SUGGESTED_SITES])] };
}

export function editPhrase(settings: Settings, id: string, text: string): Settings {
  return {
    ...settings,
    phrases: dedupePhrases(settings.phrases.map((phrase) => phrase.id === id
      ? { ...phrase, id: phrase.recommended ? `custom-${crypto.randomUUID()}` : phrase.id, text: text.trim(), recommended: false }
      : phrase)),
  };
}
