<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    tone?: 'brand' | 'ok' | 'warning' | 'danger' | 'muted';
    children: Snippet;
  }
  let { tone = 'muted', children }: Props = $props();

  const cls = $derived(
    {
      brand: 'badge-brand',
      ok: 'badge-ok',
      warning: 'badge-warning',
      danger: 'badge-danger',
      muted: 'badge-muted',
    }[tone],
  );
</script>

<span class={cls}>{@render children()}</span>
