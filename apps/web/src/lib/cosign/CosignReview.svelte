<!--
  CosignReview.svelte — read-only review of a record before co-signing.

  Renders EVERY schema section read-only via SectionView (mapping option values
  to labels, decrypting signature images with the record DEK). Enforces the
  "read before sign" UX: a Signieren button only enables after the reviewer has
  scrolled to the end of the record (or pressed "Geprüft").

  Sign / reject is delegated to the parent via callbacks; this component only
  presents and gates.
-->
<script lang="ts">
  import type { ProtocolRecord } from '@aidlog/contracts';
  import { abcdeSchema } from '$lib/schemas/abcde';
  import SectionView from '$lib/doc/SectionView.svelte';
  import SignaturePad from '$lib/signature/SignaturePad.svelte';
  import { Icon } from '$lib/ui';
  import { t } from '$lib/i18n';
  import type { OpenedRecord } from './cosignDecrypt';

  interface Props {
    record: ProtocolRecord;
    opened: OpenedRecord;
    busy?: boolean;
    onsign?: (signatureImage: Uint8Array | null) => void;
    onreject?: (reason: string) => void;
    onclose?: () => void;
  }

  let { record, opened, busy = false, onsign, onreject, onclose }: Props = $props();

  const schema = abcdeSchema;
  let read = $state(false);
  let rejecting = $state(false);
  let rejectReason = $state('');
  let myImage = $state<Uint8Array | null>(null);

  function onScroll(e: Event): void {
    const el = e.currentTarget as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) read = true;
  }
</script>

<div
  class="fixed inset-0 z-40 flex flex-col bg-surface"
  role="dialog"
  aria-modal="true"
  aria-label={$t('cosign.title')}
>
  <header class="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
    <div class="min-w-0">
      <h2 class="text-xl font-semibold text-fg">{$t('cosign.title')}</h2>
      <p class="flex items-center gap-1.5 text-sm text-muted">
        <span class="tabular-nums">#{record.seq}</span>
        <span aria-hidden="true">·</span>
        <Icon name="clock" size={14} />
        {new Date(record.createdAt).toLocaleString()}
      </p>
    </div>
    <button
      type="button"
      class="btn-ghost min-h-0 rounded-lg p-2"
      aria-label={$t('common.close')}
      onclick={() => onclose?.()}
    >
      <Icon name="x" size={20} />
    </button>
  </header>

  <!-- "Read before sign" callout -->
  <div
    class="flex items-center gap-2 bg-warning-soft px-4 py-2.5 text-sm font-medium text-warning-fg"
  >
    <Icon name="alert" size={18} class="flex-none" />
    <span>{$t('cosign.reviewBeforeSign')}</span>
  </div>

  <!-- Scrollable record body; reaching the end satisfies "read before sign". -->
  <div class="flex-1 space-y-4 overflow-y-auto px-4 py-4" onscroll={onScroll}>
    {#each schema.sections as sec (sec.key)}
      <section class="card">
        <h3
          class="mb-4 flex items-center gap-3 border-b border-line pb-3 text-lg font-semibold text-fg"
        >
          <span
            class="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-soft-fg"
            aria-hidden="true"
          >
            {sec.badge ?? sec.title.slice(0, 1)}
          </span>
          {sec.title}
        </h3>
        <SectionView
          section={sec}
          values={opened.values}
          dek={opened.dek}
          signatureBlobs={opened.signatureBlobs}
        />
      </section>
    {/each}
    <p class="text-center text-xs text-subtle">— {$t('cosign.end')} —</p>
  </div>

  <!-- Action bar -->
  <footer class="space-y-3 border-t border-line bg-surface-1 px-4 py-3">
    {#if rejecting}
      <label class="field-label" for="reject-reason">{$t('cosign.rejectReason')}</label>
      <textarea
        id="reject-reason"
        class="field-input min-h-touch py-3"
        rows="2"
        value={rejectReason}
        oninput={(e) => (rejectReason = e.currentTarget.value)}
      ></textarea>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary flex-1" onclick={() => (rejecting = false)}>
          {$t('common.cancel')}
        </button>
        <button
          type="button"
          class="btn-danger flex-1"
          disabled={busy || !rejectReason.trim()}
          onclick={() => onreject?.(rejectReason.trim())}
        >
          {$t('cosign.reject')}
        </button>
      </div>
    {:else}
      <details class="rounded-xl border border-line bg-surface-2 px-3 py-2">
        <summary class="flex min-h-touch cursor-pointer items-center gap-2 text-base text-fg">
          <Icon name="signature" size={18} />
          {$t('signature.title')} <span class="text-subtle">({$t('common.optional')})</span>
        </summary>
        <div class="mt-2">
          <SignaturePad label={$t('signature.sign')} onchange={(png) => (myImage = png)} />
        </div>
      </details>

      {#if !read}
        <p class="text-center text-sm text-muted">{$t('cosign.readBeforeSign')}</p>
      {/if}
      <div class="flex gap-2">
        <button
          type="button"
          class="btn-secondary flex-1"
          disabled={busy}
          onclick={() => (rejecting = true)}
        >
          {$t('cosign.reject')}
        </button>
        <button
          type="button"
          class="btn-primary flex-1"
          disabled={busy || !read}
          onclick={() => onsign?.(myImage)}
        >
          <Icon name="check" size={18} />
          {$t('cosign.approve')}
        </button>
      </div>
      {#if !read}
        <button type="button" class="btn-secondary w-full text-sm" onclick={() => (read = true)}>
          {$t('common.confirm')} — {$t('cosign.title')}
        </button>
      {/if}
    {/if}
  </footer>
</div>
