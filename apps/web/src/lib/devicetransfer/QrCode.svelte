<!--
  QrCode.svelte — render a transfer code as a scannable QR (SVG), dependency-free.

  Uses the from-scratch `encodeQr` encoder. If the payload is too large for a
  version-40 QR, `matrix` is null and the parent shows the copyable code block
  fallback instead (this component renders nothing in that case).
-->
<script lang="ts">
  import { encodeQr } from './qr';

  interface Props {
    value: string;
    /** Rendered pixel size of the QR square. */
    size?: number;
    /** Quiet-zone modules around the symbol (spec recommends 4). */
    quiet?: number;
  }
  let { value, size = 220, quiet = 4 }: Props = $props();

  const matrix = $derived(encodeQr(value));
  const dim = $derived(matrix ? matrix.length + quiet * 2 : 0);
  // One <path> of all dark modules keeps the DOM tiny.
  const path = $derived.by(() => {
    if (!matrix) return '';
    let d = '';
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix.length; c++) {
        if (matrix[r]![c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
      }
    }
    return d;
  });
</script>

{#if matrix}
  <svg
    width={size}
    height={size}
    viewBox={`0 0 ${dim} ${dim}`}
    role="img"
    aria-label="QR"
    class="rounded-xl bg-white p-2"
    shape-rendering="crispEdges"
  >
    <rect width={dim} height={dim} fill="white" />
    <path d={path} fill="black" />
  </svg>
{/if}
