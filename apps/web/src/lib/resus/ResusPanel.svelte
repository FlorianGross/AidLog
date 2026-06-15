<!--
  ResusPanel.svelte — the interactive "Reanimation" (CPR) assistant.

  Controls (glove-friendly, large touch targets):
   - Metronome: Web-Audio click at a selectable 100–120/min, start/stop, with a
     visual pulsing beat indicator. Audio starts from the user gesture only and
     the AudioContext is disposed on unmount (autoplay policy).
   - Elapsed timer since CPR start, a 2-min cycle counter with a soft cue, a
     shock counter (+1) and a configurable 3–5 min adrenaline reminder.
   - Event log: timestamped entries added by buttons + a manual note.

  The whole record is owned by the parent via `log` + `onchange` (so it persists
  into the encrypted draft like any other payload value and survives refresh).
  This component never touches storage directly.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Icon, Badge } from '$lib/ui';
  import { t } from '$lib/i18n';
  import {
    type ResusLog,
    type ResusEvent,
    type ResusEventType,
    newResusEventId,
    clampBpm,
    clampInterval,
  } from './types';
  import { Metronome } from './metronome';
  import { elapsedMs, formatElapsed, formatClock, eventTone } from './format';

  interface Props {
    log: ResusLog;
    readonly?: boolean;
    onchange: (next: ResusLog) => void;
  }
  let { log, readonly = false, onchange }: Props = $props();

  // --- Metronome (audio is transient UI state, not persisted) ---
  // Constructed once; tempo is kept in sync from the persisted setting below.
  const metro = new Metronome();
  $effect(() => {
    metro.setBpm(log.settings.bpm);
  });
  let metroRunning = $state(false);
  let pulse = $state(false);
  let pulseTimer: ReturnType<typeof setTimeout> | null = null;

  metro.onBeat = () => {
    pulse = true;
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => (pulse = false), 90);
  };

  async function toggleMetro(): Promise<void> {
    if (metroRunning) {
      metro.stop();
      metroRunning = false;
    } else {
      // Called from the click handler → satisfies the autoplay user-gesture rule.
      await metro.start();
      metroRunning = metro.running;
    }
  }

  // --- Live elapsed clock: tick once a second while CPR is running ---
  let now = $state(Date.now());
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  $effect(() => {
    const active = log.startedAt !== null && log.endedAt === null;
    if (active && !clockTimer) {
      clockTimer = setInterval(() => (now = Date.now()), 1000);
    } else if (!active && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  });

  const running = $derived(log.startedAt !== null && log.endedAt === null);
  const elapsed = $derived(
    log.startedAt ? elapsedMs(log.startedAt, log.endedAt ?? new Date(now).toISOString()) : 0,
  );
  const elapsedText = $derived(formatElapsed(elapsed));

  // 2-minute cycles. The "current cycle" is 1-based; a soft cue fires at each
  // boundary while CPR is running.
  const CYCLE_MS = 2 * 60 * 1000;
  const cycle = $derived(log.startedAt ? Math.floor(elapsed / CYCLE_MS) + 1 : 0);
  const cycleProgress = $derived(log.startedAt ? (elapsed % CYCLE_MS) / CYCLE_MS : 0);

  // Adrenaline reminder: due when time since the last dose (or CPR start)
  // exceeds the configured interval.
  const lastAdrenalinAt = $derived(
    log.events
      .filter((e) => e.type === 'adrenalin')
      .reduce<
        string | null
      >((latest, e) => (latest === null || e.at > latest ? e.at : latest), null),
  );
  const adrenalinSince = $derived(lastAdrenalinAt ?? log.startedAt);
  const adrenalinElapsed = $derived(
    running && adrenalinSince ? elapsedMs(adrenalinSince, new Date(now).toISOString()) : 0,
  );
  const adrenalinDue = $derived(
    running && adrenalinElapsed >= log.settings.adrenalinIntervalMin * 60 * 1000,
  );
  const adrenalinRemaining = $derived(
    Math.max(0, log.settings.adrenalinIntervalMin * 60 * 1000 - adrenalinElapsed),
  );

  // Soft cue (Web Audio is muted? still vibrate). Fire on cycle boundary.
  let lastCueCycle = 0;
  $effect(() => {
    if (running && cycle > lastCueCycle && lastCueCycle > 0) {
      softCue();
    }
    lastCueCycle = cycle;
  });

  function softCue(): void {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([120, 60, 120]);
    }
  }

  // --- Manual note ---
  let noteText = $state('');

  // --- Mutation helpers (parent owns the data) ---
  function emit(next: ResusLog): void {
    onchange(next);
  }

  function addEvent(type: ResusEventType, note?: string): ResusEvent {
    return {
      id: newResusEventId(),
      type,
      at: new Date().toISOString(),
      note: note?.trim() || undefined,
    };
  }

  function logEvent(type: ResusEventType, note?: string): void {
    if (readonly) return;
    emit({ ...log, events: [...log.events, addEvent(type, note)] });
  }

  function startCpr(): void {
    if (readonly || log.startedAt) return;
    const at = new Date().toISOString();
    emit({
      ...log,
      startedAt: at,
      endedAt: null,
      events: [...log.events, { id: newResusEventId(), type: 'start', at }],
    });
  }

  function addShock(): void {
    if (readonly) return;
    emit({ ...log, shocks: log.shocks + 1, events: [...log.events, addEvent('shock')] });
  }

  function addAdrenalin(): void {
    if (readonly) return;
    emit({
      ...log,
      adrenalinDoses: log.adrenalinDoses + 1,
      events: [...log.events, addEvent('adrenalin')],
    });
  }

  function endCpr(type: 'rosc' | 'abort'): void {
    if (readonly || !log.startedAt) return;
    const at = new Date().toISOString();
    emit({ ...log, endedAt: at, events: [...log.events, { id: newResusEventId(), type, at }] });
  }

  function addNote(): void {
    if (readonly || !noteText.trim()) return;
    logEvent('note', noteText);
    noteText = '';
  }

  function setBpm(v: number): void {
    const bpm = clampBpm(v);
    metro.setBpm(bpm);
    emit({ ...log, settings: { ...log.settings, bpm } });
  }

  function setInterval2(v: number): void {
    emit({ ...log, settings: { ...log.settings, adrenalinIntervalMin: clampInterval(v) } });
  }

  const sortedEvents = $derived([...log.events].sort((a, b) => b.at.localeCompare(a.at)));

  onDestroy(() => {
    metro.dispose();
    if (pulseTimer) clearTimeout(pulseTimer);
    if (clockTimer) clearInterval(clockTimer);
  });
</script>

<div class="space-y-5">
  <!-- Top row: elapsed timer + start/stop CPR -->
  <div class="grid gap-4 sm:grid-cols-2">
    <!-- Elapsed / cycle -->
    <div class="tile flex flex-col gap-2">
      <span class="text-xs font-medium uppercase tracking-wide text-subtle"
        >{$t('resus.elapsed')}</span
      >
      <span class="font-mono text-4xl font-semibold tabular-nums text-fg">{elapsedText}</span>
      <div class="flex items-center gap-2 text-sm text-muted">
        <span>{$t('resus.cycle')}: {cycle || '—'}</span>
        {#if running}
          <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <span
              class="block h-full rounded-full bg-brand transition-all"
              style={`width:${Math.round(cycleProgress * 100)}%`}
            ></span>
          </span>
        {/if}
      </div>
      {#if !log.startedAt}
        <button
          type="button"
          class="btn-primary mt-1 min-h-touch text-base"
          disabled={readonly}
          onclick={startCpr}
        >
          <Icon name="heart" size={20} />
          {$t('resus.startCpr')}
        </button>
      {:else if running}
        <div class="mt-1 flex gap-2">
          <button
            type="button"
            class="btn-secondary flex-1 min-h-touch text-base"
            disabled={readonly}
            onclick={() => endCpr('rosc')}
          >
            {$t('resus.rosc')}
          </button>
          <button
            type="button"
            class="btn-secondary flex-1 min-h-touch text-base"
            disabled={readonly}
            onclick={() => endCpr('abort')}
          >
            {$t('resus.abort')}
          </button>
        </div>
      {:else}
        <Badge tone="ok">{$t('resus.ended')}: {formatClock(log.endedAt)}</Badge>
      {/if}
    </div>

    <!-- Metronome -->
    <div class="tile flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium uppercase tracking-wide text-subtle"
          >{$t('resus.metronome')}</span
        >
        <span class="font-mono text-sm tabular-nums text-muted">{log.settings.bpm}/min</span>
      </div>
      <div class="flex items-center gap-4">
        <!-- Visual beat -->
        <span
          class={`flex h-14 w-14 flex-none items-center justify-center rounded-full transition-all duration-75 ${
            pulse ? 'scale-110 bg-brand text-brand-fg' : 'bg-surface-3 text-muted'
          }`}
          aria-hidden="true"
        >
          <Icon name="heart" size={26} />
        </span>
        <button
          type="button"
          class={`flex-1 min-h-touch text-base ${metroRunning ? 'btn-secondary' : 'btn-primary'}`}
          onclick={toggleMetro}
        >
          {metroRunning ? $t('resus.metroStop') : $t('resus.metroStart')}
        </button>
      </div>
      <label class="field-label flex items-center gap-3 text-sm">
        <span class="w-10 text-subtle">100</span>
        <input
          type="range"
          min="100"
          max="120"
          step="1"
          value={log.settings.bpm}
          disabled={readonly}
          class="flex-1 accent-brand"
          oninput={(e) => setBpm(Number(e.currentTarget.value))}
          aria-label={$t('resus.bpm')}
        />
        <span class="w-10 text-right text-subtle">120</span>
      </label>
    </div>
  </div>

  <!-- Counters + actions -->
  <div class="grid gap-3 sm:grid-cols-3">
    <div class="tile flex flex-col items-center gap-2 text-center">
      <span class="text-xs font-medium uppercase tracking-wide text-subtle"
        >{$t('resus.shocks')}</span
      >
      <span class="font-mono text-3xl font-semibold tabular-nums text-fg">{log.shocks}</span>
      <button
        type="button"
        class="btn-secondary w-full min-h-touch text-base"
        disabled={readonly}
        onclick={addShock}
      >
        <Icon name="plus" size={20} />
        {$t('resus.addShock')}
      </button>
    </div>

    <div
      class={`tile flex flex-col items-center gap-2 text-center ${adrenalinDue ? 'ring-2 ring-ring' : ''}`}
    >
      <span class="text-xs font-medium uppercase tracking-wide text-subtle"
        >{$t('resus.adrenalin')}</span
      >
      <span class="font-mono text-3xl font-semibold tabular-nums text-fg">{log.adrenalinDoses}</span
      >
      {#if running}
        {#if adrenalinDue}
          <Badge tone="danger">{$t('resus.adrenalinDue')}</Badge>
        {:else}
          <span class="text-xs text-muted"
            >{$t('resus.nextIn')}: {formatElapsed(adrenalinRemaining)}</span
          >
        {/if}
      {/if}
      <button
        type="button"
        class="btn-secondary w-full min-h-touch text-base"
        disabled={readonly}
        onclick={addAdrenalin}
      >
        <Icon name="plus" size={20} />
        {$t('resus.addAdrenalin')}
      </button>
    </div>

    <div class="tile flex flex-col gap-2">
      <span class="text-xs font-medium uppercase tracking-wide text-subtle"
        >{$t('resus.quickEvents')}</span
      >
      <button
        type="button"
        class="btn-ghost w-full min-h-touch justify-start text-base"
        disabled={readonly}
        onclick={() => logEvent('rhythm')}
      >
        {$t('resus.eventType.rhythm')}
      </button>
      <button
        type="button"
        class="btn-ghost w-full min-h-touch justify-start text-base"
        disabled={readonly}
        onclick={() => logEvent('medication')}
      >
        {$t('resus.eventType.medication')}
      </button>
    </div>
  </div>

  <!-- Adrenaline interval config -->
  <div class="tile flex flex-wrap items-center gap-3">
    <span class="text-sm font-medium text-fg">{$t('resus.adrenalinInterval')}</span>
    <div class="flex gap-1">
      {#each [3, 4, 5] as m (m)}
        <button
          type="button"
          class={`min-h-touch rounded-lg border px-4 text-base font-medium transition-colors ${
            log.settings.adrenalinIntervalMin === m
              ? 'border-line-strong bg-brand text-brand-fg'
              : 'border-line bg-surface-1 text-muted hover:bg-surface-2'
          }`}
          disabled={readonly}
          onclick={() => setInterval2(m)}
        >
          {m} min
        </button>
      {/each}
    </div>
  </div>

  <!-- Manual note -->
  {#if !readonly}
    <div class="flex flex-col gap-2 sm:flex-row">
      <input
        type="text"
        class="field-input flex-1"
        placeholder={$t('resus.notePlaceholder')}
        bind:value={noteText}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addNote();
          }
        }}
      />
      <button
        type="button"
        class="btn-secondary min-h-touch px-5 text-base"
        disabled={!noteText.trim()}
        onclick={addNote}
      >
        <Icon name="plus" size={20} />
        {$t('resus.addNote')}
      </button>
    </div>
  {/if}

  <!-- Event log (newest first) -->
  <div>
    <h3 class="mb-2 text-sm font-semibold text-fg">{$t('resus.logTitle')}</h3>
    {#if sortedEvents.length === 0}
      <p class="text-sm text-muted">{$t('resus.noEvents')}</p>
    {:else}
      <ul class="space-y-1">
        {#each sortedEvents as e (e.id)}
          <li class="flex items-center gap-3 rounded-lg border border-line bg-surface-1 px-3 py-2">
            <span class="font-mono text-sm tabular-nums text-muted">{formatClock(e.at)}</span>
            <Badge tone={eventTone(e.type)}>{$t(`resus.eventType.${e.type}`)}</Badge>
            {#if e.note}<span class="min-w-0 flex-1 truncate text-sm text-fg">{e.note}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
