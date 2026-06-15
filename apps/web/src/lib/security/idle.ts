/**
 * security/idle.ts — inactivity auto-lock + lock-on-background watcher.
 *
 * While a session is unlocked this watches for user activity (pointer/keyboard/
 * touch) and, after the configured idle timeout, calls the existing `lock()`
 * (which wipes in-memory key material), clears the auth token, and navigates to
 * the login route. It also optionally locks shortly after the tab is
 * backgrounded (with a grace period so quick app-switches don't nuke the
 * session).
 *
 * The watcher reacts to settings changes live and re-arms automatically when a
 * new session is unlocked, so it is safe to start once in the app shell.
 *
 * SECURITY: locking here is a REAL wipe of secret material via crypto `lock()`,
 * not merely a navigation. No secrets are read or stored by this module.
 */
import { goto } from '$app/navigation';
import { lock, isUnlocked, onSessionChange } from '$lib/crypto';
import { api } from '$lib/api';
import { securitySettings, BACKGROUND_GRACE_MS, type SecuritySettings } from './settings';

/** Activity events that reset the idle timer. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/** Coalesce bursts of activity so we re-arm the timer at most this often. */
const ACTIVITY_DEBOUNCE_MS = 1_000;

let running = false;
let teardown: (() => void) | null = null;

let settings: SecuritySettings = { idleMinutes: 5, lockOnBackground: true };
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivity = 0;

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function clearBackgroundTimer(): void {
  if (backgroundTimer !== null) {
    clearTimeout(backgroundTimer);
    backgroundTimer = null;
  }
}

/** Perform the actual lock: wipe keys, drop token, go to login. */
function doLock(): void {
  clearIdleTimer();
  clearBackgroundTimer();
  if (!isUnlocked()) return;
  lock();
  api.setToken(null);
  void goto('/login/');
}

/** (Re)arm the inactivity timer per the current settings + lock state. */
function armIdleTimer(): void {
  clearIdleTimer();
  if (!isUnlocked()) return;
  if (settings.idleMinutes <= 0) return; // "Aus" — auto-lock disabled.
  idleTimer = setTimeout(doLock, settings.idleMinutes * 60_000);
}

function onActivity(): void {
  if (!isUnlocked()) return;
  const now = Date.now();
  // A foreground interaction also cancels any pending background lock.
  clearBackgroundTimer();
  if (now - lastActivity < ACTIVITY_DEBOUNCE_MS && idleTimer !== null) return;
  lastActivity = now;
  armIdleTimer();
}

function onVisibilityChange(): void {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') {
    if (!isUnlocked() || !settings.lockOnBackground) return;
    clearBackgroundTimer();
    backgroundTimer = setTimeout(doLock, BACKGROUND_GRACE_MS);
  } else {
    // Back in foreground within the grace window — cancel the pending lock and
    // treat the return as activity.
    clearBackgroundTimer();
    onActivity();
  }
}

/**
 * Start the idle watcher. Idempotent: calling again while running is a no-op.
 * Returns a stop function (same as `stopIdleWatch`).
 */
export function startIdleWatch(): () => void {
  if (running) return stopIdleWatch;
  if (typeof window === 'undefined') return () => {};
  running = true;

  const unsubSettings = securitySettings.subscribe((s) => {
    settings = s;
    // Re-arm against the new timeout if currently unlocked.
    if (running) armIdleTimer();
  });

  // Re-arm whenever the lock state flips (e.g. after a fresh login) and clear
  // pending timers the moment the session is locked elsewhere.
  const unsubSession = onSessionChange((s) => {
    if (!running) return;
    if (s) {
      lastActivity = Date.now();
      armIdleTimer();
    } else {
      clearIdleTimer();
      clearBackgroundTimer();
    }
  });

  const activityHandler = (): void => onActivity();
  for (const ev of ACTIVITY_EVENTS) {
    window.addEventListener(ev, activityHandler, { passive: true });
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Arm immediately if a session is already unlocked (e.g. after login).
  lastActivity = Date.now();
  armIdleTimer();

  teardown = () => {
    unsubSettings();
    unsubSession();
    for (const ev of ACTIVITY_EVENTS) {
      window.removeEventListener(ev, activityHandler);
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    clearIdleTimer();
    clearBackgroundTimer();
  };

  return stopIdleWatch;
}

/** Stop the idle watcher and remove all listeners/timers. Idempotent. */
export function stopIdleWatch(): void {
  if (!running) return;
  running = false;
  teardown?.();
  teardown = null;
}

/**
 * Notify the watcher that the lock state may have changed (e.g. right after a
 * successful login) so it re-arms the idle timer. Safe to call any time.
 */
export function rearmIdleWatch(): void {
  if (!running) return;
  lastActivity = Date.now();
  armIdleTimer();
}
