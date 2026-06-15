/**
 * resus/format.ts — small pure formatting/util helpers for the resus feature.
 * No Svelte, no audio — trivially testable and shared by the panel + read view.
 */
import type { ResusEventType } from './types';

/** "HH:mm:ss" local clock from an ISO timestamp (empty/invalid → "—"). */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Elapsed "mm:ss" between two ISO timestamps (end defaults to now). */
export function formatDuration(startIso: string, endIso?: string): string {
  return formatElapsed(elapsedMs(startIso, endIso));
}

/** Milliseconds between start and end (end defaults to now). Never negative. */
export function elapsedMs(startIso: string, endIso?: string): number {
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return 0;
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return Math.max(0, end - start);
}

/** Format a millisecond duration as "mm:ss" (or "h:mm:ss" past an hour). */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Badge tone for an event type, so the log reads at a glance. */
export function eventTone(type: ResusEventType): 'brand' | 'ok' | 'warning' | 'danger' | 'muted' {
  switch (type) {
    case 'start':
      return 'brand';
    case 'shock':
      return 'warning';
    case 'adrenalin':
    case 'medication':
      return 'warning';
    case 'rosc':
      return 'ok';
    case 'abort':
      return 'danger';
    case 'rhythm':
    case 'note':
    default:
      return 'muted';
  }
}
