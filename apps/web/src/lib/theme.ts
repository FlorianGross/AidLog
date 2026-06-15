/**
 * Theme preference: 'light' | 'dark' | 'system'.
 *
 * 'system' applies no attribute and lets the `prefers-color-scheme` media query
 * in app.css decide (so the system default paints with no flash and no JS). An
 * explicit choice sets `data-theme` on <html> and is persisted. The theme
 * preference is non-sensitive UI state, so localStorage is fine here.
 */
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'aidlog-theme';

function read(): ThemePref {
  if (!browser) return 'system';
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

function apply(pref: ThemePref): void {
  if (!browser) return;
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export const themePref = writable<ThemePref>(read());

export function setTheme(pref: ThemePref): void {
  if (browser) {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  }
  apply(pref);
  themePref.set(pref);
}

/** Cycle light → dark → system. */
export function cycleTheme(current: ThemePref): ThemePref {
  const next: ThemePref = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
  setTheme(next);
  return next;
}

/** Apply the persisted preference. Call once on client start. */
export function initTheme(): void {
  apply(read());
}

/** Whether dark is currently effective (system resolves via matchMedia). */
export function resolveDark(pref: ThemePref): boolean {
  if (pref === 'dark') return true;
  if (pref === 'light') return false;
  return browser && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
