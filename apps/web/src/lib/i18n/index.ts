/**
 * Lightweight i18n. German is the default and source-of-truth locale; every
 * other locale provides its own dictionary and falls back PER KEY to German for
 * any string it is missing or leaves empty (so a partial translation never
 * shows a raw key).
 *
 * Usage in components:
 *   import { t } from '$lib/i18n';
 *   <h1>{$t('dashboard.title')}</h1>
 *   <p>{$t('users.invitedBy', { name })}</p>
 *
 * Outside components: `translate(get(locale), key, params)` or just `tr(key)`.
 *
 * Switching the active locale: `setLocale('ar')` (persists to localStorage and
 * updates `<html lang/dir>` reactively via the layout). `initLocale()` restores
 * the persisted choice on client start.
 */
import { writable, derived, get, type Readable } from 'svelte/store';
import { browser } from '$app/environment';
import { de } from './de';
import { en } from './en';
import { tr as trMessages } from './tr';
import { ar } from './ar';
import { ru } from './ru';
import { uk } from './uk';
import { fr } from './fr';

// Responder UI locales. `de` is the source of truth and the ultimate per-key
// fallback for every other locale.
export type Locale = 'de' | 'en' | 'tr' | 'ar' | 'ru' | 'uk' | 'fr';

// The catalogue shape is defined by German. Other locales are authored as a
// DeepPartial of it: they may omit keys (those fall back to German) but may not
// introduce keys German does not have. This keeps the dictionaries structurally
// consistent and type-checked against the source of truth.
export type Messages = typeof de;

// A locale dictionary mirrors the German structure but (a) may omit any
// key — omitted keys fall back to German at runtime — and (b) widens the
// `as const` string LITERALS of `de` to plain `string`, so a translated value
// is accepted instead of being forced to equal the exact German text.
type DeepPartialWiden<T> = {
  [K in keyof T]?: T[K] extends string
    ? string
    : T[K] extends object
      ? DeepPartialWiden<T[K]>
      : T[K];
};
export type LocaleMessages = DeepPartialWiden<Messages>;

const dictionaries: Record<Locale, LocaleMessages> = {
  de,
  en,
  tr: trMessages,
  ar,
  ru,
  uk,
  fr,
};

export const SUPPORTED_LOCALES: readonly Locale[] = ['de', 'en', 'tr', 'ar', 'ru', 'uk', 'fr'];

/** Native display names for the language selector. */
export const LOCALE_NAMES: Record<Locale, string> = {
  de: 'Deutsch',
  en: 'English',
  tr: 'Türkçe',
  ar: 'العربية',
  ru: 'Русский',
  uk: 'Українська',
  fr: 'Français',
};

/** Locales whose script is right-to-left. */
const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['ar']);

/** Text direction for a locale. */
export function dirFor(loc: Locale): 'rtl' | 'ltr' {
  return RTL_LOCALES.has(loc) ? 'rtl' : 'ltr';
}

const KEY = 'aidlog-locale';

function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

function readPersisted(): Locale {
  if (!browser) return 'de';
  try {
    const v = localStorage.getItem(KEY);
    return isLocale(v) ? v : 'de';
  } catch {
    return 'de';
  }
}

// `de` is the ultimate default and the initial locale. The persisted choice is
// applied via initLocale() on client start so SSR/first paint stays German.
export const locale = writable<Locale>('de');

function lookup(dict: LocaleMessages, path: string): string | undefined {
  const node = path
    .split('.')
    .reduce<unknown>(
      (n, key) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[key] : undefined),
      dict,
    );
  // Only non-empty strings count as a real translation; empty strings fall back.
  return typeof node === 'string' && node.length > 0 ? node : undefined;
}

function interpolate(msg: string, params?: Record<string, string | number>): string {
  if (!params) return msg;
  let out = msg;
  for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/**
 * Pure translate. Resolves against the selected locale's dictionary, falling
 * back PER KEY to the German catalogue, then to the raw key as a last resort.
 */
export function translate(
  loc: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = dictionaries[loc] ?? de;
  const msg = lookup(dict, key) ?? lookup(de, key) ?? key;
  return interpolate(msg, params);
}

/** Non-reactive helper for use outside Svelte components. */
export function tr(key: string, params?: Record<string, string | number>): string {
  return translate(get(locale), key, params);
}

/** Reactive translator: `$t('some.key')`. */
export const t: Readable<(key: string, params?: Record<string, string | number>) => string> =
  derived(
    locale,
    (loc) => (key: string, params?: Record<string, string | number>) => translate(loc, key, params),
  );

/** Change the active locale and persist the choice. */
export function setLocale(loc: Locale): void {
  if (browser) {
    try {
      if (loc === 'de') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, loc); // privacy-lint-allow: non-sensitive UI locale preference (no secret material)
    } catch {
      /* storage unavailable — keep the in-memory choice */
    }
  }
  locale.set(loc);
}

/** Apply the persisted locale. Call once on client start. */
export function initLocale(): void {
  locale.set(readPersisted());
}

export { de };
