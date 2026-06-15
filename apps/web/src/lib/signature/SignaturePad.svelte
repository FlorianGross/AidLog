<!--
  SignaturePad.svelte — hand-rolled signature capture on an HTML <canvas>.

  No external dependency. Uses Pointer Events so finger, stylus and mouse all
  work with one code path. Exports the drawing as PNG bytes via the `onchange`
  callback (and on demand via the bound `export` ref). A Clear button resets it.

  The ink color follows the theme (`--text` CSS variable) so the stroke stays
  legible on the framed surface in BOTH light and dark mode.

  Accessibility: the canvas has a role/label; Clear is a large touch target.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import { Icon } from '$lib/ui';

  interface Props {
    /** explicit ink color; when omitted the theme text color is used. */
    color?: string;
    /** stroke width in CSS px. */
    lineWidth?: number;
    /** css height of the pad. */
    height?: number;
    /** label shown above/inside the pad. */
    label?: string;
    /** fired whenever the drawing changes (debounced to pointerup). null = cleared. */
    onchange?: (png: Uint8Array | null) => void;
  }

  let { color, lineWidth = 2.5, height = 200, label, onchange }: Props = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let ctx: CanvasRenderingContext2D | null = null;
  let drawing = $state(false);
  let hasInk = $state(false);
  let dpr = 1;

  /** Resolve the active ink color from the theme unless overridden. */
  function inkColor(): string {
    if (color) return color;
    if (canvas) {
      const v = getComputedStyle(canvas).getPropertyValue('--text').trim();
      if (v) return `rgb(${v})`;
    }
    return '#0f172a';
  }

  function setup(node: HTMLCanvasElement) {
    canvas = node;
    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  }

  function resize(): void {
    if (!canvas) return;
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    // Preserve existing ink across a resize by snapshotting.
    const prev = hasInk ? canvas.toDataURL('image/png') : null;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = inkColor();
    ctx.lineWidth = lineWidth;
    if (prev) {
      const img = new Image();
      img.onload = () => ctx && ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = prev;
    }
  }

  function pos(e: PointerEvent): { x: number; y: number } {
    const rect = canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: PointerEvent): void {
    if (!ctx || !canvas) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    ctx.strokeStyle = inkColor();
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: PointerEvent): void {
    if (!drawing || !ctx) return;
    e.preventDefault();
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasInk = true;
  }

  function end(e: PointerEvent): void {
    if (!drawing) return;
    drawing = false;
    try {
      canvas?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    void emit();
  }

  /** Export current canvas as PNG bytes, or null when empty. */
  export async function toPng(): Promise<Uint8Array | null> {
    if (!canvas || !hasInk) return null;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas!.toBlob((b) => resolve(b), 'image/png'),
    );
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function emit(): Promise<void> {
    onchange?.(await toPng());
  }

  export function clear(): void {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk = false;
    onchange?.(null);
  }
</script>

<div class="space-y-2">
  {#if label}
    <p class="text-base font-medium text-fg">{label}</p>
  {/if}
  <div
    class="relative rounded-xl border border-line-strong bg-surface-1"
    style={`height:${height}px`}
  >
    <canvas
      use:setup
      class="h-full w-full touch-none rounded-xl"
      style="touch-action:none"
      aria-label={label ?? $t('signature.drawHere')}
      onpointerdown={start}
      onpointermove={move}
      onpointerup={end}
      onpointercancel={end}
      onpointerleave={end}
    ></canvas>
    {#if !hasInk}
      <span
        class="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-subtle"
      >
        {$t('signature.drawHere')}
      </span>
    {/if}
  </div>
  <div class="flex justify-end">
    <button type="button" class="btn-ghost px-4 text-sm" onclick={clear} disabled={!hasInk}>
      <Icon name="x" size={18} />
      {$t('signature.clear')}
    </button>
  </div>
</div>
