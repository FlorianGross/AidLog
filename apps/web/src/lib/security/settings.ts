/**
 * security/settings.ts — NON-sensitive security preferences (localStorage).
 *
 * SECURITY BOUNDARY: this store holds ONLY non-sensitive UI preferences
 * (auto-lock timeout, lock-on-background toggle). It NEVER contains secret key
 * material, passwords, DEKs or tokens — those live in memory only (see
 * crypto/session.ts). localStorage is acceptable here exactly because the
 * payload is non-secret, mirroring the existing theme preference.
 */
import { writable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';

const KEY = 'aidlog-security';

/** Auto-lock idle timeout, in minutes. 0 = disabled ("Aus"). */
export type IdleMinutes = 0 | 1 | 2 | 5 | 10 | 15;

/** Selectable idle-timeout options surfaced in the settings UI. */
export const IDLE_OPTIONS: readonly IdleMinutes[] = [0, 1, 2, 5, 10, 15];

export interface SecuritySettings {
  /** Inactivity auto-lock timeout in minutes (0 = off). Default 5. */
  idleMinutes: IdleMinutes;
  /** Lock (after a short grace) when the tab is hidden/backgrounded. Default on. */
  lockOnBackground: boolean;
}

/** Grace period before a backgrounded tab is locked, in milliseconds. */
export const BACKGROUND_GRACE_MS = 30_000;

export const DEFAULT_SETTINGS: SecuritySettings = {
  idleMinutes: 5,
  lockOnBackground: true,
};

function isIdleMinutes(v: unknown): v is IdleMinutes {
  return typeof v === 'number' && (IDLE_OPTIONS as readonly number[]).includes(v);
}

function read(): SecuritySettings {
  if (!browser) return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SecuritySettings>;
    return {
      idleMinutes: isIdleMinutes(parsed.idleMinutes)
        ? parsed.idleMinutes
        : DEFAULT_SETTINGS.idleMinutes,
      lockOnBackground:
        typeof parsed.lockOnBackground === 'boolean'
          ? parsed.lockOnBackground
          : DEFAULT_SETTINGS.lockOnBackground,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const store = writable<SecuritySettings>(read());

/** Reactive, NON-sensitive security preferences. */
export const securitySettings: Readable<SecuritySettings> = store;

function persist(value: SecuritySettings): void {
  if (!browser) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(value)); // privacy-lint-allow: non-sensitive UI prefs only (idle timeout + toggle), no secret material
  } catch {
    /* storage full / disabled — preference is best-effort */
  }
}

/** Set the inactivity auto-lock timeout (persisted). */
export function setIdleMinutes(idleMinutes: IdleMinutes): void {
  store.update((s) => {
    const next = { ...s, idleMinutes };
    persist(next);
    return next;
  });
}

/** Toggle lock-on-background (persisted). */
export function setLockOnBackground(lockOnBackground: boolean): void {
  store.update((s) => {
    const next = { ...s, lockOnBackground };
    persist(next);
    return next;
  });
}

/** Snapshot the current settings synchronously (for the idle watcher). */
export function currentSettings(): SecuritySettings {
  let snapshot: SecuritySettings = { ...DEFAULT_SETTINGS };
  store.subscribe((s) => (snapshot = s))();
  return snapshot;
}

/** The localStorage key this module owns (exported for the wipe routine). */
export const SECURITY_SETTINGS_KEY = KEY;
