<!--
  EcgStripThumb.svelte — render a stored ECG strip (base64 image bytes) as a
  thumbnail with a tap-to-zoom affordance and an optional remove button.

  The strip bytes live (base64) inside the encrypted `ekg` payload; here we decode
  them to an object URL purely for display and revoke it on teardown — nothing is
  written to disk or the network. Tapping opens the full-screen zoom/pan viewer.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { crypto } from '@aidlog/crypto-core';
  import { Icon } from '$lib/ui';
  import { t } from '$lib/i18n';
  import EcgImageViewer from './EcgImageViewer.svelte';

  interface Props {
    /** base64 of the downscaled image bytes. */
    data: string;
    mediaType?: string;
    /** show a remove button (editor only). */
    onremove?: () => void;
    height?: number;
  }
  let { data, mediaType = 'image/jpeg', onremove, height = 112 }: Props = $props();

  let url = $state<string | null>(null);
  let bytes = $state<Uint8Array | null>(null);
  let viewing = $state(false);

  function revoke(): void {
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
  }

  $effect(() => {
    revoke();
    try {
      const b = crypto.fromBase64(data);
      bytes = b;
      url = URL.createObjectURL(new Blob([b.slice().buffer], { type: mediaType || 'image/jpeg' }));
    } catch {
      bytes = null;
      url = null;
    }
  });

  onDestroy(revoke);
</script>

<figure class="relative overflow-hidden rounded-xl border border-line bg-surface-1">
  {#if url}
    <button
      type="button"
      class="block w-full"
      aria-label={$t('ecg.viewer.open')}
      onclick={() => (viewing = true)}
    >
      <img
        src={url}
        alt={$t('ecg.strip')}
        class="w-full object-cover"
        style={`height:${height}px`}
      />
      <span
        class="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded-lg bg-surface/90 px-1.5 py-1 text-xs text-fg shadow-sm"
      >
        <Icon name="search" size={14} />
      </span>
    </button>
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

{#if viewing && bytes}
  <EcgImageViewer data={bytes} {mediaType} onclose={() => (viewing = false)} />
{/if}
