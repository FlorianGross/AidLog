<!--
  SignatureView.svelte — decrypt + display a stored signature image.

  Given an `EncryptedBlobRef` (header + mediaType), the raw blob CIPHERTEXT, and
  the record DEK, decrypts the image IN MEMORY via crypto-core and renders it as
  an object URL. Used for `type: 'signature'` fields and co-signatures.

  The DEK and plaintext bytes never leave memory; the object URL is revoked on
  teardown.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { crypto } from '@aidlog/crypto-core';
  import type { EncryptedBlobRef } from '@aidlog/contracts';
  import { t } from '$lib/i18n';

  interface Props {
    blob: EncryptedBlobRef;
    /** the raw encrypted blob body (from storage). */
    ciphertext: Uint8Array;
    /** the record DEK (in-memory). */
    dek: Uint8Array;
    label?: string;
    /** optional signer name / timestamp caption. */
    caption?: string;
    height?: number;
  }

  let { blob, ciphertext, dek, label, caption, height = 160 }: Props = $props();

  let url = $state<string | null>(null);
  let error = $state(false);

  function revoke(): void {
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
  }

  $effect(() => {
    // Re-decrypt whenever inputs change.
    revoke();
    error = false;
    (async () => {
      try {
        await crypto.ready();
        const data = crypto.decryptBlob(crypto.fromBase64(blob.header), ciphertext, dek);
        const out = new Blob([data.slice().buffer], { type: blob.mediaType || 'image/png' });
        url = URL.createObjectURL(out);
      } catch {
        error = true;
      }
    })();
  });

  onDestroy(revoke);
</script>

<figure class="space-y-1.5">
  {#if label}
    <figcaption class="text-base font-medium text-fg">{label}</figcaption>
  {/if}
  <div
    class="flex items-center justify-center rounded-xl border border-line-strong bg-surface-1 p-2"
    style={`min-height:${height}px`}
  >
    {#if error}
      <span class="text-sm text-danger">{$t('errors.generic')}</span>
    {:else if url}
      <img
        src={url}
        alt={label ?? $t('signature.title')}
        class="max-h-full max-w-full"
        style={`max-height:${height}px`}
      />
    {:else}
      <span class="text-sm text-subtle">{$t('common.loading')}</span>
    {/if}
  </div>
  {#if caption}
    <figcaption class="text-sm text-muted">{caption}</figcaption>
  {/if}
</figure>
