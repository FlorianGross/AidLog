/**
 * Public surface of the device-security layer:
 *   - inactivity auto-lock + lock-on-background watcher (idle.ts)
 *   - non-sensitive security preferences store (settings.ts)
 *   - local device wipe / panic offboarding (wipe.ts)
 *
 * Nothing here ever persists secret material; locking always goes through the
 * crypto session's `lock()` so in-memory keys are wiped, not merely hidden.
 */
export * from './settings';
export * from './idle';
export * from './wipe';
