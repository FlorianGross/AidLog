/**
 * Display mode preference: 'normal' | 'glove'.
 *
 * 'glove' (Handschuh-/Großschrift-Modus) enlarges the base font scale and touch
 * targets so the app stays usable with gloves or for low-vision users. It sets
 * `data-display="glove"` on <html> (see the rules in app.css) and is persisted.
 * Like the theme, this is non-sensitive UI state, so localStorage is fine.
 *
 * Mirrors the shape of $lib/theme.ts deliberately.
 */
import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type DisplayMode = 'normal' | 'glove';

const KEY = 'aidlog-display';

function read(): DisplayMode {
  if (!browser) return 'normal';
  try {
    return localStorage.getItem(KEY) === 'glove' ? 'glove' : 'normal';
  } catch {
    return 'normal';
  }
}

function apply(mode: DisplayMode): void {
  if (!browser) return;
  const root = document.documentElement;
  if (mode === 'glove') root.setAttribute('data-display', 'glove');
  else root.removeAttribute('data-display');
}

export const displayMode = writable<DisplayMode>(read());

export function setDisplayMode(mode: DisplayMode): void {
  if (browser) {
    try {
      if (mode === 'normal') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode); // privacy-lint-allow: non-sensitive UI display preference (no secret material)
    } catch {
      /* storage unavailable — keep the in-memory choice */
    }
  }
  apply(mode);
  displayMode.set(mode);
}

/** Toggle between normal and glove modes; returns the new value. */
export function toggleDisplayMode(current: DisplayMode): DisplayMode {
  const next: DisplayMode = current === 'glove' ? 'normal' : 'glove';
  setDisplayMode(next);
  return next;
}

/** Apply the persisted preference. Call once on client start. */
export function initDisplayMode(): void {
  apply(read());
}
