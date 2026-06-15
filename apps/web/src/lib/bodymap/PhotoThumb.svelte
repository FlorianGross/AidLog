<!--
  PhotoThumb.svelte — render an in-memory photo (decrypted bytes) as a thumbnail.

  The bytes are already plaintext IN MEMORY (downscaled on capture, or decrypted
  locally for an existing record). We wrap them in an object URL purely for
  display and revoke it on teardown — nothing is written to disk or the network.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Icon } from '$lib/ui';
  import { t } from '$lib/i18n';

  interface Props {
    data: Uint8Array;
    mediaType?: string;
    /** show a remove button (editor only). */
    onremove?: () => void;
    height?: number;
  }
  let { data, mediaType = 'image/jpeg', onremove, height = 96 }: Props = $props();

  let url = $state<string | null>(null);

  function revoke(): void {
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
  }

  $effect(() => {
    revoke();
    const blob = new Blob([data.slice().buffer], { type: mediaType || 'image/jpeg' });
    url = URL.createObjectURL(blob);
  });

  onDestroy(revoke);
</script>

<figure class="relative overflow-hidden rounded-xl border border-line bg-surface-1">
  {#if url}
    <img
      src={url}
      alt={$t('bodymap.photo')}
      class="w-full object-cover"
      style={`height:${height}px`}
    />
  {:else}
    <span class="block text-center text-xs text-subtle" style={`line-height:${height}px`}
      >{$t('common.loading')}</span
    >
  {/if}
  {#if onremove}
    <button
      type="button"
      class="absolute right-1 top-1 rounded-lg bg-surface/90 p-1.5 text-danger shadow-sm hover:bg-surface"
      aria-label={$t('common.delete')}
      onclick={onremove}
    >
      <Icon name="trash" size={16} />
    </button>
  {/if}
</figure>
