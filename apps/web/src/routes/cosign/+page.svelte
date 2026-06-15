<!--
  cosign/+page.svelte — co-signature INBOX + signing.

  Lists co-signature requests awaiting MY signature (GET ROUTES.cosignRequests).
  Opening one:
    - loads the referenced ProtocolRecord (local cache, else a sync pull),
    - opens the cosigner-sealed DEK and decrypts the payload + signature blobs,
    - shows the FULL record read-only (CosignReview) with "read before sign" UX,
    - then Signieren (Ed25519 sign the recordHash + optional own signature image)
      or Ablehnen with a reason.

  Degrades gracefully when the backend co-sign endpoints are not yet deployed:
  the list simply shows an error/empty state and the rest of the app is fine.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { getSession } from '$lib/crypto';
  import { getDeploymentRecords } from '$lib/store';
  import { api } from '$lib/api';
  import { pull } from '$lib/store';
  import CosignReview from '$lib/cosign/CosignReview.svelte';
  import { listMyCosignRequests } from '$lib/cosign/cosignApi';
  import { openRecordForReview, type OpenedRecord } from '$lib/cosign/cosignDecrypt';
  import { signCosign, rejectCosign } from '$lib/cosign/cosignSign';
  import { Icon, Badge, EmptyState } from '$lib/ui';
  import type { CosignatureRequest, ProtocolRecord } from '@aidlog/contracts';

  let requests = $state<CosignatureRequest[]>([]);
  let loading = $state(true);
  let listError = $state<string | null>(null);

  // Active review
  let active = $state<CosignatureRequest | null>(null);
  let activeRecord = $state<ProtocolRecord | null>(null);
  let opened = $state<OpenedRecord | null>(null);
  let reviewError = $state<string | null>(null);
  let busy = $state(false);

  const myKeyId = $derived(getSession()?.keyId ?? '');

  onMount(async () => {
    if (!getSession()) {
      await goto('/login/');
      return;
    }
    await loadRequests();
  });

  async function loadRequests(): Promise<void> {
    loading = true;
    listError = null;
    try {
      const all = await listMyCosignRequests();
      requests = all.filter(
        (r) =>
          (r.status === 'pending' || r.status === 'partially-signed') &&
          r.requestedSigners.includes(myKeyId),
      );
    } catch (e) {
      listError = e instanceof Error ? e.message : $t('errors.network');
      requests = [];
    } finally {
      loading = false;
    }
  }

  async function findRecord(req: CosignatureRequest): Promise<ProtocolRecord | undefined> {
    let recs = await getDeploymentRecords(req.deploymentId);
    let found = recs.find((r) => r.id === req.recordId);
    if (found) return found;
    // Not cached locally — try a sync pull, then look again.
    try {
      await pull(api);
    } catch {
      /* offline / endpoint missing */
    }
    recs = await getDeploymentRecords(req.deploymentId);
    return recs.find((r) => r.id === req.recordId);
  }

  async function open(req: CosignatureRequest): Promise<void> {
    busy = true;
    reviewError = null;
    try {
      const record = await findRecord(req);
      if (!record) throw new Error($t('errors.notFound'));
      const o = await openRecordForReview(record);
      active = req;
      activeRecord = record;
      opened = o;
    } catch (e) {
      reviewError = e instanceof Error ? e.message : $t('errors.generic');
    } finally {
      busy = false;
    }
  }

  function closeReview(): void {
    if (opened) {
      try {
        opened.dek.fill(0);
      } catch {
        /* ignore */
      }
    }
    active = null;
    activeRecord = null;
    opened = null;
  }

  async function doSign(signatureImage: Uint8Array | null): Promise<void> {
    if (!active || !activeRecord || !opened) return;
    busy = true;
    try {
      await signCosign({
        requestId: active.id,
        record: activeRecord,
        dek: opened.dek,
        signatureImage,
      });
      closeReview();
      await loadRequests();
    } catch (e) {
      reviewError = e instanceof Error ? e.message : $t('errors.generic');
    } finally {
      busy = false;
    }
  }

  async function doReject(reason: string): Promise<void> {
    if (!active || !activeRecord) return;
    busy = true;
    try {
      await rejectCosign({ requestId: active.id, record: activeRecord, reason });
      closeReview();
      await loadRequests();
    } catch (e) {
      reviewError = e instanceof Error ? e.message : $t('errors.generic');
    } finally {
      busy = false;
    }
  }
</script>

<section class="space-y-4">
  <header class="flex items-center justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold text-fg">{$t('cosign.myRequests')}</h1>
      <p class="text-sm text-muted">{$t('cosign.inbox')}</p>
    </div>
    <a href="/" class="btn-ghost px-3 text-sm">
      <Icon name="arrow-left" size={18} />
      {$t('common.back')}
    </a>
  </header>

  {#if reviewError}
    <p class="rounded-xl bg-danger-soft px-4 py-2 text-sm text-danger-fg" role="alert">
      {reviewError}
    </p>
  {/if}

  {#if loading}
    <p class="text-muted">{$t('common.loading')}</p>
  {:else if listError}
    <p class="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
      {listError}
    </p>
  {:else if requests.length === 0}
    <EmptyState
      icon="signature"
      title={$t('cosign.noRequests')}
      description={$t('cosign.noRequestsHint')}
    />
  {:else}
    <ul class="space-y-3">
      {#each requests as req (req.id)}
        <li class="card flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate font-medium text-fg">
              {$t('cosign.requestedBy', { name: req.requestedByKeyId.slice(0, 12) + '…' })}
            </p>
            <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span class="inline-flex items-center gap-1">
                <Icon name="clock" size={14} />
                {new Date(req.createdAt).toLocaleString()}
              </span>
              <Badge tone={req.status === 'partially-signed' ? 'brand' : 'warning'}>
                {$t(`cosign.${req.status === 'partially-signed' ? 'partiallySigned' : 'pending'}`)}
              </Badge>
            </p>
            {#if req.note}<p class="mt-2 text-sm text-fg">{req.note}</p>{/if}
          </div>
          <button
            type="button"
            class="btn-primary px-4 text-sm"
            disabled={busy}
            onclick={() => open(req)}
          >
            {$t('cosign.review')}
            <Icon name="chevron-right" size={18} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if active && activeRecord && opened}
  <CosignReview
    record={activeRecord}
    {opened}
    {busy}
    onsign={doSign}
    onreject={doReject}
    onclose={closeReview}
  />
{/if}
