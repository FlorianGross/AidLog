<!--
  Avatar.svelte — flat initials avatar (teal-soft circle). Derives up to two
  initials from a name; falls back to a user icon when no name is available.
-->
<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    name?: string | null;
    size?: number;
    class?: string;
  }
  let { name, size = 36, class: cls = '' }: Props = $props();

  const initials = $derived(
    (name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join(''),
  );
</script>

<span
  class={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-medium text-brand-soft-fg ${cls}`}
  style={`width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px`}
  aria-hidden="true"
>
  {#if initials}
    {initials}
  {:else}
    <Icon name="user" size={Math.round(size * 0.55)} />
  {/if}
</span>
