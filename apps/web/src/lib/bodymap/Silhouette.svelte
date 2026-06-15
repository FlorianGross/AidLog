<!--
  Silhouette.svelte — an inline SVG human outline (front or back), theme-aware.

  Pure outline drawn with token colours (fill from a subtle surface, stroke from
  the line token) on a 100×220 viewBox so markers can be positioned with simple
  0..1 fractions. The `back` view differs only by a spine hint line, which is
  enough to read as a back silhouette without a second full drawing.

  Markers are rendered by the parent on top; this component only draws the body.
-->
<script lang="ts">
  import type { BodySide } from './types';

  interface Props {
    side: BodySide;
  }
  let { side }: Props = $props();

  // A simple, neutral, front-facing humanoid outline (head, torso, arms, legs).
  const BODY =
    'M50 6 C44 6 40 11 40 18 C40 25 44 30 50 30 C56 30 60 25 60 18 C60 11 56 6 50 6 Z ' + // head
    'M50 31 C42 31 36 35 33 42 L24 78 C23 82 26 85 30 84 L34 82 L31 120 ' + // left side down to hip
    'L27 170 C26 176 31 180 36 179 C40 178 42 174 42 170 L46 122 L48 122 ' + // left leg
    'L50 122 L52 122 L54 122 L58 170 C58 174 60 178 64 179 C69 180 74 176 73 170 ' + // right leg
    'L69 120 L66 82 L70 84 C74 85 77 82 76 78 L67 42 C64 35 58 31 50 31 Z'; // right side up
</script>

<svg
  viewBox="0 0 100 220"
  width="100%"
  height="100%"
  preserveAspectRatio="xMidYMid meet"
  aria-hidden="true"
  class="block"
>
  <path
    d={BODY}
    fill="rgb(var(--surface-2))"
    stroke="rgb(var(--line-strong))"
    stroke-width="1.5"
    stroke-linejoin="round"
  />
  {#if side === 'back'}
    <!-- spine hint to distinguish the back view -->
    <line
      x1="50"
      y1="34"
      x2="50"
      y2="118"
      stroke="rgb(var(--line-strong))"
      stroke-width="1"
      stroke-dasharray="3 3"
    />
  {/if}
</svg>
