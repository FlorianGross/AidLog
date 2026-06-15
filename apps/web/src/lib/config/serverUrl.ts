/**
 * config/serverUrl.ts — runtime-configurable API base URL (single source of truth).
 *
 * The API base URL is resolved in priority order:
 *   1. RUNTIME: a value the user enters on first start (or changes later),
 *      persisted to localStorage. This lets ONE pre-built binary — notably the
 *      native Android/iOS app — point at ANY self-hosted server with NO
 *      per-server rebuild. The operator no longer has to bake `VITE_API_BASE_URL`
 *      into the build.
 *   2. BUILD-TIME: the `VITE_API_BASE_URL` env baked at `vite build` (legacy
 *      path; still honoured so existing same-origin/native deployments are
 *      byte-for-byte unchanged when nothing is stored).
 *   3. SAME-ORIGIN: neither set ⇒ '' ⇒ fetch hits the same host that served the
 *      app (the normal web/PWA deployment).
 *
 * The stored value is NON-SECRET operational config (a server hostname). It must
 * never hold key material — only the URL — so localStorage is appropriate.
 *
 * SECURITY / CSP: a runtime-chosen origin cannot be known at build time, so a
 * build that opts into runtime config widens CSP `connect-src` to accept any
 * HTTPS origin (see svelte.config.js, keyed on `VITE_RUNTIME_API_CONFIG`). The
 * plain same-origin web build keeps its strict `connect-src 'self'` and never
 * shows the first-start gate.
 */
import { browser } from '$app/environment';

/** localStorage key for the runtime-chosen API base URL (non-secret). */
const STORAGE_KEY = 'aidlog.api-base-url';

/** Build-time fallback (legacy path). Empty string ⇒ same-origin. */
function buildTimeBase(): string {
  return (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? '';
}

/** Whether this build opted INTO runtime server-URL configuration (CSP widened). */
function buildFlagEnabled(): boolean {
  const v = (import.meta as { env?: { VITE_RUNTIME_API_CONFIG?: string } }).env
    ?.VITE_RUNTIME_API_CONFIG;
  return v === '1' || v === 'true';
}

/** True when running inside a Capacitor native shell (local origin, no same-origin API). */
function isCapacitorNative(): boolean {
  return (
    browser &&
    typeof (globalThis as { Capacitor?: unknown }).Capacitor !== 'undefined' &&
    (
      globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor?.isNativePlatform?.() === true
  );
}

/**
 * Whether runtime server-URL configuration is active for this build/context.
 * Enabled by the build flag OR automatically when running natively (where there
 * is no same-origin API to fall back to, so the user MUST point at a server).
 */
export function isServerConfigEnabled(): boolean {
  return buildFlagEnabled() || isCapacitorNative();
}

/** Normalise a URL: trim and drop trailing slash(es). '' stays ''. */
function normalize(raw: string): string {
  const s = raw.trim();
  return s ? s.replace(/\/+$/, '') : '';
}

/**
 * Validate a candidate base URL: must be an absolute http(s) URL so a typo can't
 * silently break every request. Returns the normalised value, or null if invalid.
 */
export function validateServerUrl(raw: string): string | null {
  const s = normalize(raw);
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return s;
}

/** The persisted runtime value, or '' if none/invalid/non-browser. */
function storedBase(): string {
  if (!browser) return '';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? (validateServerUrl(v) ?? '') : '';
  } catch {
    return '';
  }
}

/**
 * The effective API base URL every fetch uses: the runtime value if set, else
 * the build-time value, else '' (same-origin). Never has a trailing slash.
 */
export function getApiBase(): string {
  return storedBase() || normalize(buildTimeBase());
}

/** Whether the user has explicitly stored a runtime server URL on this device. */
export function hasStoredServerUrl(): boolean {
  return storedBase() !== '';
}

/**
 * Persist the runtime API base URL (or clear it with null/''). Throws on an
 * invalid URL so callers can surface the error. No-op outside the browser.
 */
export function setApiBase(raw: string | null): void {
  if (!browser) return;
  if (!raw || !raw.trim()) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — ignore */
    }
    return;
  }
  const valid = validateServerUrl(raw);
  if (!valid) throw new Error('invalid server URL');
  try {
    // Non-secret operational config (a server hostname); never key material.
    localStorage.setItem(STORAGE_KEY, valid);
  } catch {
    /* storage unavailable — ignore */
  }
}

/**
 * Whether the FIRST-START server gate must block onboarding: runtime config is
 * enabled for this build/context AND nothing usable is configured yet (no stored
 * value and no build-time fallback ⇒ getApiBase() is '').
 */
export function isServerConfigRequired(): boolean {
  return isServerConfigEnabled() && getApiBase() === '';
}
