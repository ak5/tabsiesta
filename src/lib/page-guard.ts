import { normalizeText, type Settings } from './settings';
import type { GuardStatus } from './policy';

export const GUARD_KEY = '__tabSiestaGuard';
export interface PageGuard {
  status: () => GuardStatus;
  configure: (settings: Settings) => void;
  dispose: () => void;
}

function isVisible(element: Element, cache: WeakMap<Element, boolean>): boolean {
  const visited: Element[] = [];
  let visible = true;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const cached = cache.get(current);
    if (cached !== undefined) { visible = cached; break; }
    visited.push(current);
    const style = getComputedStyle(current);
    if (current.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') { visible = false; break; }
  }
  for (const current of visited) cache.set(current, visible);
  return visible;
}

/** Only status leaves this closure. Text and control values stay inside the page. */
export function createPageGuard(doc: Document, initial: Settings, publish: (status: GuardStatus) => void, lateInjection = false): PageGuard {
  let settings = initial;
  let configured = JSON.stringify([initial.phraseGuard, initial.phrases]);
  let stickyPhrase = false;
  const matchedPhrases = new Map<string, string>();
  let scanComplete = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPublished = '';
  const dirty = new Set<Element>();
  const known = new WeakSet<Element>();
  const editableBaselines = new WeakMap<Element, string>();
  const selector = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

  function inspectControl(element: Element, initialPass = false): void {
    if (element instanceof HTMLInputElement) {
      if (['button', 'submit', 'reset', 'hidden', 'image'].includes(element.type)) return;
      if (element.type === 'file') {
        if (element.files?.length) dirty.add(element);
      } else if (element.type === 'checkbox' || element.type === 'radio') {
        if (element.checked !== element.defaultChecked) dirty.add(element);
      } else if (element.value !== element.defaultValue || (lateInjection && initialPass && element.value.length > 0)) dirty.add(element);
    } else if (element instanceof HTMLTextAreaElement) {
      if (element.value !== element.defaultValue || (lateInjection && initialPass && element.value.length > 0)) dirty.add(element);
    } else if (element instanceof HTMLSelectElement) {
      const options = Array.from(element.options);
      const hasDefault = options.some((option) => option.defaultSelected);
      // Single selects implicitly select the first option when no default is marked.
      if (options.some((option, index) => option.selected !== (option.defaultSelected || (!element.multiple && !hasDefault && index === 0)))) dirty.add(element);
    } else {
      const text = element.textContent ?? '';
      const baseline = editableBaselines.get(element);
      if (baseline !== undefined && text !== baseline) dirty.add(element);
      if (lateInjection && initialPass && text.trim()) dirty.add(element);
      if (baseline === undefined) editableBaselines.set(element, text);
    }
    known.add(element);
  }

  function inspectForms(): void {
    doc.querySelectorAll(selector).forEach((element) => inspectControl(element, !known.has(element)));
    // Retain dirty state even when an SPA removes its editor. Only reset/navigation clears it.
  }

  function inspectPhrases(): void {
    if (!settings.phraseGuard || stickyPhrase) { scanComplete = true; return; }
    const phrases = settings.phrases.filter((p) => p.enabled);
    if (!phrases.length || !doc.body) { scanComplete = true; return; }
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const visibility = new WeakMap<Element, boolean>();
    let text = '';
    let nodes = 0;
    let complete = true;
    let node: Node | null;
    // Bound work on pathological pages. An incomplete scan protects the page.
    while ((node = walker.nextNode())) {
      if (++nodes > 20_000 || text.length > 250_000) { complete = false; break; }
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, noscript, template, input, textarea') || !node.textContent?.trim() || !isVisible(parent, visibility)) continue;
      const remaining = 250_000 - text.length;
      if (node.textContent.length + 1 > remaining) {
        text += node.textContent.slice(0, remaining);
        complete = false;
        break;
      }
      text += `${node.textContent} `;
    }
    const normalized = normalizeText(text);
    for (const phrase of phrases) {
      const wording = normalizeText(phrase.text);
      if (normalized.includes(wording)) matchedPhrases.set(phrase.id, wording);
    }
    stickyPhrase = matchedPhrases.size > 0;
    scanComplete = complete;
  }

  function status(): GuardStatus {
    if (!disposed) { inspectForms(); inspectPhrases(); }
    // Report configured IDs, never the page text or a matched excerpt. If a phrase
    // is edited/removed, retain protection without attributing it to new wording.
    const phraseIds = settings.phrases.filter((phrase) => matchedPhrases.get(phrase.id) === normalizeText(phrase.text)).map((phrase) => phrase.id);
    return { ready: !disposed && doc.readyState !== 'loading', dirty: dirty.size > 0, phrase: stickyPhrase, complete: scanComplete, ...(phraseIds.length ? { phraseIds } : {}) };
  }

  function emit(): void {
    const value = status();
    const fingerprint = JSON.stringify(value);
    if (fingerprint !== lastPublished) { lastPublished = fingerprint; publish(value); }
  }

  function schedule(): void {
    // Coalesce bursts without postponing indefinitely on animated pages.
    if (timer !== undefined || disposed) return;
    timer = setTimeout(() => { timer = undefined; emit(); }, 300);
  }

  function onInput(event: Event): void {
    const target = event.composedPath().find((node) => node instanceof Element && node.matches(selector));
    if (target instanceof Element) dirty.add(target);
    schedule();
  }

  function onReset(event: Event): void {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    // Wait until reset's default action finishes, and respect preventDefault().
    setTimeout(() => {
      if (event.defaultPrevented || disposed) return;
      for (const element of dirty) {
        if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) && element.form === form) dirty.delete(element);
      }
      emit();
    }, 0);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(doc, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'style', 'class', 'value', 'checked', 'selected', 'contenteditable'] });
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('change', onInput, true);
  doc.addEventListener('reset', onReset, true);
  doc.addEventListener('DOMContentLoaded', emit);
  emit();

  return {
    status,
    configure(next) {
      settings = next;
      const signature = JSON.stringify([next.phraseGuard, next.phrases]);
      if (signature !== configured) { configured = signature; emit(); }
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      clearTimeout(timer);
      doc.removeEventListener('input', onInput, true);
      doc.removeEventListener('change', onInput, true);
      doc.removeEventListener('reset', onReset, true);
      doc.removeEventListener('DOMContentLoaded', emit);
    },
  };
}
