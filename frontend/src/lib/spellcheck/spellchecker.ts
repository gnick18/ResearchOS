// Lazy-loaded spell-checker built on nspell (MIT) + dictionary-en (the Hunspell
// en_US wordlist, MIT/BSD). The dictionary is ~555 KB so it is NOT bundled. The
// .aff/.dic live under public/spellcheck/ and are fetched on first use, then the
// checker is cached for the page lifetime.
//
// On top of the base English dictionary we seed:
//   1. SCIENTIFIC_WORDLIST  (the curated bench vocabulary)
//   2. words the caller supplies (the user's inventory names, method terms, and
//      frequently-used words harvested from their own notes)
// so common lab words are not flagged and suggestions stay on-vocabulary.
//
// We never invent a spelling algorithm. nspell does the edit-distance work; we
// only decide which tokens to check and when a correction is "confident".

import { SCIENTIFIC_WORDLIST } from "./scientific-wordlist";
import type { NSpell as NSpellInstance } from "nspell";

let checkerPromise: Promise<NSpellInstance | null> | null = null;
// Words added after the checker is built (e.g. once user data has loaded). We
// keep the set so a later rebuild is not needed and dedupe is cheap.
const seededExtra = new Set<string>();

const AFF_URL = "/spellcheck/en.aff";
const DIC_URL = "/spellcheck/en.dic";

// localStorage keys. The enabled flag is mirrored from settings.json so the
// editor can read it synchronously at mount (same pattern as editorWidthPreset).
// User words are the durable "Add to dictionary" list, separate from the
// transient seededExtra so they survive reloads.
const ENABLED_KEY = "ros.spellcheck.enabled";
const USER_WORDS_KEY = "ros.spellcheck.userWords";

function readLocalUserWords(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(USER_WORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((w) => typeof w === "string") : [];
  } catch {
    return [];
  }
}

async function build(): Promise<NSpellInstance | null> {
  if (typeof window === "undefined") return null; // SSR: no checker
  try {
    const nspell = (await import("nspell")).default;
    const [affRes, dicRes] = await Promise.all([fetch(AFF_URL), fetch(DIC_URL)]);
    if (!affRes.ok || !dicRes.ok) return null;
    const [aff, dic] = await Promise.all([affRes.text(), dicRes.text()]);
    const checker = nspell(aff, dic);
    for (const w of SCIENTIFIC_WORDLIST) checker.add(w);
    for (const w of readLocalUserWords()) {
      const t = w.trim();
      if (t) checker.add(t);
    }
    for (const w of seededExtra) checker.add(w);
    return checker;
  } catch {
    return null; // never let spell-check break the page
  }
}

/** Load (or return the cached) spell-checker. Returns null if it cannot load. */
export function getSpellChecker(): Promise<NSpellInstance | null> {
  if (!checkerPromise) checkerPromise = build();
  return checkerPromise;
}

/**
 * Add extra known-good words (user inventory, method terms, note vocabulary).
 * Safe to call before or after the checker has loaded; new words apply to the
 * existing instance and to any future rebuild.
 */
export async function seedWords(words: Iterable<string>): Promise<void> {
  let added = false;
  for (const raw of words) {
    const w = raw.trim();
    if (w.length < 2 || w.length > 40) continue;
    const key = w.toLowerCase();
    if (seededExtra.has(key)) continue;
    seededExtra.add(key);
    added = true;
  }
  if (!added || !checkerPromise) return;
  const checker = await checkerPromise;
  if (checker) for (const w of seededExtra) checker.add(w);
}

/**
 * Add a word to the durable user dictionary (the editor's "Add to dictionary"
 * action). Persists to localStorage and applies to the live checker. Returns
 * true if the word was new. SSR/parse failures are swallowed.
 */
export function addUserWord(word: string): boolean {
  const w = word.trim();
  if (!w || typeof window === "undefined") return false;
  const existing = readLocalUserWords();
  const key = w.toLowerCase();
  if (existing.some((e) => e.toLowerCase() === key)) return false;
  try {
    window.localStorage.setItem(USER_WORDS_KEY, JSON.stringify([...existing, w]));
  } catch {
    // ignore quota / disabled storage
  }
  void seedWords([w]);
  return true;
}

/** Whether spell-check is enabled (mirrored from settings.json). Default off. */
export function isSpellCheckEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mirror the enabled flag to localStorage so the editor reads it synchronously. */
export function setSpellCheckEnabledLocal(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

const URL_RE = /^(https?:\/\/|www\.)/i;
const HAS_DIGIT_RE = /\d/;
const HAS_LETTER_RE = /[a-zA-Z]/;

/**
 * Whether a raw token is worth spell-checking. We skip anything that is not
 * plain prose: short tokens, URLs, anything containing a digit (counts, conc.,
 * catalog numbers, gene names like CDK4), and ALL-CAPS acronyms (PCR, EDTA).
 */
export function shouldCheckToken(token: string): boolean {
  if (token.length < 3 || token.length > 40) return false;
  if (!HAS_LETTER_RE.test(token)) return false;
  if (HAS_DIGIT_RE.test(token)) return false;
  if (URL_RE.test(token)) return false;
  if (token === token.toUpperCase() && token.length <= 6) return false; // acronym
  return true;
}

/**
 * Grant's conservative auto-correct rule, for cleaning OCR output. Return a
 * replacement ONLY when the checker is confident: the word is wrong AND there is
 * exactly one suggestion. Ambiguous misspellings are left as-is on purpose, a
 * single wrong "confident" correction is worse for downstream fuzzy search than
 * leaving a recognizable typo. Returns null when nothing confident applies.
 */
export function confidentCorrection(
  checker: NSpellInstance,
  word: string,
): string | null {
  if (!shouldCheckToken(word)) return null;
  if (checker.correct(word)) return null;
  const suggestions = checker.suggest(word);
  if (suggestions.length !== 1) return null;
  const fix = suggestions[0];
  // Guard against case-only or trivial differences and runaway length changes.
  if (fix.toLowerCase() === word.toLowerCase()) return null;
  if (Math.abs(fix.length - word.length) > 2) return null;
  return matchCase(word, fix);
}

/** Apply the original token's capitalization pattern to the replacement. */
function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
