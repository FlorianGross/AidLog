<!--
  RequestCosign.svelte — request a co-signature on a FINALISED record.

  Flow:
   1. Fetch the org user list (cosignApi.listUsers) and let the requester pick
      one or more OTHER users to counter-sign.
   2. Re-open the record DEK locally (from a sealed key we can open with our own
      identity), then seal it to EACH chosen signer's X25519 box key
      (crypto.sealDek) as a `SealedKey` with recipientType 'cosigner'.
   3. POST CreateCosignatureRequest (incl. those sealed keys) to ROUTES.cosignRequests.

  Shows the cosign.grantsRead notice: chosen signers gain read access.

  Only PUBLIC keys + sealed (ciphertext) DEKs are sent.
-->
<script lang="ts">
  import { crypto } from '@aidlog/crypto-core';
  import type {
    CreateCosignatureRequest,
    ProtocolRecord,
    SealedKey,
    UserAccount,
  } from '@aidlog/contracts';
  import { getSession } from '$lib/crypto';
  import { t } from '$lib/i18n';
  import { Icon } from '$lib/ui';
  import { listUsers, createCosignRequest } from './cosignApi';

  interface Props {
    record: ProtocolRecord;
    onclose?: () => void;
  }

  let { record, onclose }: Props = $props();

  let users = $state<UserAccount[]>([]);
  let selected = $state<Set<string>>(new Set());
  let note = $state('');
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let done = $state(false);

  const myKeyId = $derived(getSession()?.keyId ?? '');

  $effect(() => {
    (async () => {
      loading = true;
      error = null;
      try {
        const all = await listUsers();
        // Exclude myself and disabled accounts; only signers (helper/lead) need apply.
        users = all.filter((u) => u.identity.keyId !== myKeyId && u.status === 'active');
      } catch (e) {
        error = e instanceof Error ? e.message : $t('errors.network');
      } finally {
        loading = false;
      }
    })();
  });

  function toggle(keyId: string): void {
    const next = new Set(selected);
    if (next.has(keyId)) next.delete(keyId);
    else next.add(keyId);
    selected = next;
  }

  /** Open the record DEK using a sealed key we (org/helper) can unwrap. */
  function openDek(): Uint8Array {
    const s = getSession();
    if (!s) throw new Error('locked');
    const mine = record.sealedKeys.find((k) => k.recipientKeyId === s.publicIdentity.keyId);
    if (!mine) throw new Error('Cannot open record DEK with this identity.');
    return crypto.openSealedDek(crypto.fromBase64(mine.ciphertext), s.identity.box);
  }

  async function send(): Promise<void> {
    if (busy || selected.size === 0) return;
    busy = true;
    error = null;
    let dek: Uint8Array | null = null;
    try {
      await crypto.ready();
      dek = openDek();

      const chosen = users.filter((u) => selected.has(u.identity.keyId));
      const sealedKeys: SealedKey[] = chosen.map((u) => ({
        recipientType: 'cosigner',
        recipientKeyId: u.identity.keyId,
        alg: 'x25519-sealedbox',
        ciphertext: crypto.toBase64(
          crypto.sealDek(dek as Uint8Array, crypto.fromBase64(u.identity.boxPublicKey)),
        ),
      }));

      const req: CreateCosignatureRequest = {
        recordId: record.id,
        deploymentId: record.deploymentId,
        requestedSigners: chosen.map((u) => u.identity.keyId),
        sealedKeys,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      await createCosignRequest(req);
      done = true;
    } catch (e) {
      error = e instanceof Error ? e.message : $t('errors.generic');
    } finally {
      if (dek) {
        try {
          dek.fill(0);
        } catch {
          /* ignore */
        }
      }
      busy = false;
    }
  }
</script>

<div
  class="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
>
  <button
    type="button"
    class="absolute inset-0"
    aria-label={$t('common.close')}
    onclick={() => onclose?.()}
  ></button>
  <div
    class="relative w-full max-w-lg rounded-t-2xl border border-line bg-surface-1 p-5 shadow-2xl sm:rounded-2xl"
    role="dialog"
    aria-modal="true"
    aria-label={$t('cosign.requestTitle')}
  >
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2 class="text-xl font-semibold text-fg">{$t('cosign.requestTitle')}</h2>
      <button
        type="button"
        class="btn-ghost min-h-0 rounded-lg p-2"
        aria-label={$t('common.close')}
        onclick={() => onclose?.()}
      >
        <Icon name="x" size={20} />
      </button>
    </div>

    <p
      class="mb-4 flex items-start gap-2 rounded-xl bg-brand-soft px-3 py-2.5 text-sm text-brand-soft-fg"
    >
      <Icon name="shield" size={18} class="mt-0.5 flex-none" />
      <span>{$t('cosign.grantsRead')}</span>
    </p>

    {#if done}
      <p class="flex items-center gap-2 rounded-xl bg-ok-soft px-3 py-2.5 text-sm text-ok-fg">
        <Icon name="check" size={18} />
        {$t('cosign.requestSent')}
      </p>
      <button type="button" class="btn-primary mt-4 w-full" onclick={() => onclose?.()}>
        {$t('common.close')}
      </button>
    {:else}
      {#if error}
        <p class="mb-3 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger-fg" role="alert">
          {error}
        </p>
      {/if}

      <fieldset class="space-y-2">
        <legend class="field-label">{$t('cosign.chooseSigners')}</legend>
        {#if loading}
          <p class="text-muted">{$t('common.loading')}</p>
        {:else if users.length === 0}
          <p class="text-muted">{$t('cosign.noSigners')}</p>
        {:else}
          <div class="flex max-h-64 flex-wrap gap-2 overflow-y-auto">
            {#each users as u (u.identity.keyId)}
              {@const on = selected.has(u.identity.keyId)}
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                class={`flex min-h-touch items-center gap-2 rounded-full border px-4 text-left text-base transition-colors ${
                  on
                    ? 'border-brand bg-brand text-brand-fg'
                    : 'border-line-strong bg-surface-1 text-fg hover:bg-surface-2'
                }`}
                onclick={() => toggle(u.identity.keyId)}
              >
                {#if on}<Icon name="check" size={16} class="flex-none" />{/if}
                <span class="leading-tight">
                  <span class="block font-medium">{u.displayName}</span>
                  <span class={`block text-xs ${on ? 'text-brand-fg/80' : 'text-subtle'}`}
                    >{$t(`roles.${u.role}`)}</span
                  >
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </fieldset>

      <div class="mt-4">
        <label class="field-label" for="cosign-note">{$t('cosign.note')}</label>
        <textarea
          id="cosign-note"
          class="field-input min-h-touch py-3"
          rows="2"
          value={note}
          oninput={(e) => (note = e.currentTarget.value)}
        ></textarea>
      </div>

      <button
        type="button"
        class="btn-primary mt-4 w-full"
        disabled={busy || selected.size === 0}
        onclick={send}
      >
        <Icon name="signature" size={18} />
        {$t('cosign.send')}
      </button>
    {/if}
  </div>
</div>
