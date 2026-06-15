<!-- Metric tile: muted label + large number, optional icon and link. -->
<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    value: string | number;
    icon?: string;
    tone?: 'default' | 'brand' | 'warning' | 'danger' | 'ok';
    href?: string;
  }
  let { label, value, icon, tone = 'default', href }: Props = $props();

  const valueTone = $derived(
    {
      default: 'text-fg',
      brand: 'text-brand',
      warning: 'text-warning',
      danger: 'text-danger',
      ok: 'text-ok',
    }[tone],
  );
</script>

{#snippet body()}
  <div class="flex items-start justify-between gap-3">
    <div>
      <div class="text-sm text-muted">{label}</div>
      <div class={`mt-1 text-2xl font-medium ${valueTone}`}>{value}</div>
    </div>
    {#if icon}
      <span class="text-subtle"><Icon name={icon} size={20} /></span>
    {/if}
  </div>
{/snippet}

{#if href}
  <a {href} class="tile block transition-colors hover:bg-surface-3">{@render body()}</a>
{:else}
  <div class="tile">{@render body()}</div>
{/if}
