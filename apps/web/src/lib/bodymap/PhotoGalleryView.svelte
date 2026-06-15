<!--
  PhotoGalleryView.svelte — READ-ONLY grid of record photos (decrypted in memory).
  Used by the record / print view. Bytes are passed in already decrypted.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import PhotoThumb from './PhotoThumb.svelte';
  import type { DraftPhoto } from './types';

  interface Props {
    photos: DraftPhoto[];
    height?: number;
  }
  let { photos, height = 120 }: Props = $props();
</script>

{#if photos.length === 0}
  <p class="text-sm text-muted">{$t('bodymap.noPhotos')}</p>
{:else}
  <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
    {#each photos as p (p.id)}
      <PhotoThumb data={p.data} mediaType={p.mediaType} {height} />
    {/each}
  </div>
{/if}
