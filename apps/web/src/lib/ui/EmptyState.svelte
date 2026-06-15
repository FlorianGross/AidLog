<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    icon?: string;
    title: string;
    description?: string;
    children?: Snippet;
  }
  let { icon = 'file-text', title, description, children }: Props = $props();
</script>

<div
  class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center"
>
  <span class="mb-3 text-subtle"><Icon name={icon} size={28} /></span>
  <p class="text-base font-medium text-fg">{title}</p>
  {#if description}
    <p class="mt-1 max-w-sm text-sm text-muted">{description}</p>
  {/if}
  {#if children}
    <div class="mt-4">{@render children()}</div>
  {/if}
</div>
