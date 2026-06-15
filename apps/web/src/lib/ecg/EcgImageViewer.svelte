<!--
  EcgImageViewer.svelte — full-screen zoom + pan viewer for a decrypted ECG strip.

  ECG detail matters: a 12-lead trace must be inspectable closely. This is a
  hand-rolled viewer (no deps) built on Pointer Events:
    - wheel / +- buttons zoom around the pointer (desktop)
    - one-finger / mouse drag pans
    - two-finger pinch zooms around the pinch midpoint (touch)
    - double-tap / double-click toggles fit ↔ 2×
  The image bytes are already plaintext IN MEMORY (decrypted by the caller); we
  wrap them in an object URL for display and revoke it on teardown. Rendered in a
  <Modal> so it overlays the editor. Design-system tokens only, both themes.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Icon, Modal } from '$lib/ui';
  import { t } from '$lib/i18n';

  interface Props {
    /** decrypted image bytes (in memory). */
    data: Uint8Array;
    mediaType?: string;
    onclose: () => void;
  }
  let { data, mediaType = 'image/jpeg', onclose }: Props = $props();

  const MIN_SCALE = 1;
  const MAX_SCALE = 8;

  let url = $state<string | null>(null);
  let scale = $state(1);
  let tx = $state(0);
  let ty = $state(0);

  // Active pointers for pan / pinch tracking.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let lastTapAt = 0;

  function revoke(): void {
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
  }

  $effect(() => {
    revoke();
    url = URL.createObjectURL(new Blob([data.slice().buffer], { type: mediaType || 'image/jpeg' }));
  });

  onDestroy(revoke);

  function clampScale(s: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  }

  function reset(): void {
    scale = 1;
    tx = 0;
    ty = 0;
  }

  /** Zoom around a point (local px relative to the stage centre). */
  function zoomAround(nextScale: number, px: number, py: number): void {
    const next = clampScale(nextScale);
    if (next === scale) return;
    const ratio = next / scale;
    // Keep the content point under (px,py) stationary.
    tx = px - (px - tx) * ratio;
    ty = py - (py - ty) * ratio;
    scale = next;
    if (scale === 1) {
      tx = 0;
      ty = 0;
    }
  }

  function stagePoint(
    e: { clientX: number; clientY: number },
    host: HTMLElement,
  ): { x: number; y: number } {
    const rect = host.getBoundingClientRect();
    return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const host = e.currentTarget as HTMLElement;
    const p = stagePoint(e, host);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAround(scale * factor, p.x, p.y);
  }

  function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e: PointerEvent): void {
    const host = e.currentTarget as HTMLElement;
    host.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (a && b) {
        pinchStartDist = dist(a, b);
        pinchStartScale = scale;
      }
    } else if (pointers.size === 1) {
      // Double-tap / double-click → toggle fit ↔ 2×.
      const now = Date.now();
      if (now - lastTapAt < 300) {
        if (scale > 1) reset();
        else {
          const p = stagePoint(e, host);
          zoomAround(2, p.x, p.y);
        }
        lastTapAt = 0;
      } else {
        lastTapAt = now;
      }
    }
  }

  function onPointerMove(e: PointerEvent): void {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const host = e.currentTarget as HTMLElement;
    const cur = { x: e.clientX, y: e.clientY };

    if (pointers.size === 2) {
      pointers.set(e.pointerId, cur);
      const [a, b] = [...pointers.values()];
      if (a && b && pinchStartDist > 0) {
        const d = dist(a, b);
        const mid = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
        const p = stagePoint(mid, host);
        zoomAround((pinchStartScale * d) / pinchStartDist, p.x, p.y);
      }
      return;
    }

    // Single-pointer pan (only meaningful when zoomed in).
    if (scale > 1) {
      tx += cur.x - prev.x;
      ty += cur.y - prev.y;
    }
    pointers.set(e.pointerId, cur);
  }

  function endPointer(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = 0;
  }
</script>

<Modal open title={$t('ecg.viewer.title')} onClose={onclose}>
  <div class="space-y-3">
    <div
      class="relative h-[60vh] w-full touch-none select-none overflow-hidden rounded-xl border border-line-strong bg-surface-1"
      role="presentation"
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={endPointer}
      onpointercancel={endPointer}
    >
      {#if url}
        <img
          src={url}
          alt={$t('ecg.strip')}
          draggable="false"
          class="pointer-events-none absolute left-1/2 top-1/2 max-h-full max-w-full origin-center"
          style={`transform: translate(-50%,-50%) translate(${tx}px,${ty}px) scale(${scale});`}
        />
      {:else}
        <span class="absolute inset-0 grid place-items-center text-sm text-subtle"
          >{$t('common.loading')}</span
        >
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        class="btn-secondary px-4 text-sm"
        aria-label={$t('ecg.viewer.zoomOut')}
        onclick={() => zoomAround(scale / 1.4, 0, 0)}
      >
        <Icon name="search" size={18} /> −
      </button>
      <span class="min-w-[3.5rem] text-center text-sm tabular-nums text-muted"
        >{Math.round(scale * 100)}%</span
      >
      <button
        type="button"
        class="btn-secondary px-4 text-sm"
        aria-label={$t('ecg.viewer.zoomIn')}
        onclick={() => zoomAround(scale * 1.4, 0, 0)}
      >
        <Icon name="search" size={18} /> +
      </button>
      <button type="button" class="btn-ghost px-4 text-sm" onclick={reset}
        >{$t('ecg.viewer.reset')}</button
      >
    </div>
    <p class="text-center text-xs text-subtle">{$t('ecg.viewer.hint')}</p>
  </div>
</Modal>
