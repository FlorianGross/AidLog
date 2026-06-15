<!--
  deployment/[id]/material/+page.svelte — MATERIALVERBRAUCH (per-deployment).

  Quick field logging of consumed material for this deployment: pick an item +
  quantity + optional note → log. The server decrements the item's stock
  (clamped at 0). Below, this deployment's consumption list is shown; an
  admin/lead may remove an entry (which restores stock).

  PRIVACY: consumption is a PER-DEPLOYMENT AGGREGATE ("3× Mullbinde used in event
  X") — NEVER linked to an individual patient or protocol record. OPERATIONAL
  logistics only, no patient/health data.

  Everyone may log consumption; removing an entry is gated to admin/lead (the
  server enforces this too).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { session, isLeadOrAdmin, getDeployment, type DeploymentMeta } from '$lib/store';
  import { api } from '$lib/api';
  import { isLowStock } from '$lib/material';
  import { Icon, Badge, EmptyState, Spinner } from '$lib/ui';
  import { MATERIAL_UNITS } from '@aidlog/contracts';
  import type { ConsumptionEntry, MaterialItem } from '@aidlog/contracts';

  const deploymentId = $derived($page.params.id ?? '');

  let meta = $state<DeploymentMeta | undefined>(undefined);
  let items = $state<MaterialItem[]>([]);
  let entries = $state<ConsumptionEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let status = $state<string | null>(null);

  const canManage = $derived($isLeadOrAdmin);

  // Log form state.
  let fItemId = $state('');
  let fQuantity = $state(1);
  let fNote = $state('');
  let logging = $state(false);

  // Only active items are pickable (inactive items remain only in history).
  const activeItems = $derived(items.filter((i) => i.active));
  const selectedItem = $derived(items.find((i) => i.id === fItemId));

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    meta = await getDeployment(deploymentId);
    await refresh();
  });

  async function refresh(): Promise<void> {
    error = null;
    loading = true;
    try {
      const [matRes, consRes] = await Promise.all([
        api.listMaterial(),
        api.listConsumption(deploymentId),
      ]);
      items = matRes.items;
      entries = consRes.entries;
      if (!fItemId && activeItems.length > 0) fItemId = activeItems[0]!.id;
    } catch {
      error = $t('material.loadFailed');
    } finally {
      loading = false;
    }
  }

  function unitLabel(unit: string): string {
    return (MATERIAL_UNITS as readonly string[]).includes(unit)
      ? $t(`material.units.${unit}`)
      : unit;
  }

  async function logConsumption(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!fItemId || !Number.isFinite(fQuantity) || fQuantity <= 0) return;
    actionError = null;
    status = null;
    logging = true;
    try {
      await api.logConsumption(deploymentId, {
        itemId: fItemId,
        quantity: Math.trunc(fQuantity),
        note: fNote.trim() || null,
      });
      fQuantity = 1;
      fNote = '';
      status = $t('material.consumption.logged');
      await refresh();
    } catch {
      actionError = $t('material.logFailed');
    } finally {
      logging = false;
    }
  }

  async function remove(entry: ConsumptionEntry): Promise<void> {
    if (!confirm($t('material.consumption.removeConfirm'))) return;
    actionError = null;
    try {
      await api.deleteConsumption(deploymentId, entry.id);
      await refresh();
    } catch {
      actionError = $t('material.deleteFailed');
    }
  }

  function fmt(iso: string): string {
    return new Date(iso).toLocaleString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  }
</script>

<section class="space-y-6">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight text-fg">
        {$t('material.consumption.title')}
      </h1>
      <p class="text-muted">{meta?.title ?? $t('material.consumption.subtitle')}</p>
    </div>
    <a href={`/deployment/${deploymentId}/`} class="btn-ghost px-3 text-sm">
      {$t('common.back')}
    </a>
  </header>

  {#if error}
    <p class="field-error" role="alert">{error}</p>
  {/if}
  {#if actionError}
    <p class="field-error" role="alert">{actionError}</p>
  {/if}
  {#if status}
    <p class="rounded-xl bg-brand-soft px-4 py-2 text-sm text-brand-soft-fg" aria-live="polite">
      {status}
    </p>
  {/if}

  {#if loading}
    <div class="flex justify-center py-10"><Spinner /></div>
  {:else}
    <!-- Log form -->
    <div class="card">
      <h2 class="mb-3 text-lg font-semibold text-fg">{$t('material.consumption.logTitle')}</h2>
      {#if activeItems.length === 0}
        <p class="text-sm text-muted">{$t('material.consumption.noItems')}</p>
      {:else}
        <form
          class="grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end"
          onsubmit={logConsumption}
        >
          <div>
            <label class="field-label" for="cons-item">{$t('material.consumption.item')}</label>
            <select id="cons-item" class="field-input" bind:value={fItemId}>
              {#each activeItems as i (i.id)}
                <option value={i.id}>{i.name} ({i.stockQuantity} {unitLabel(i.unit)})</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="field-label" for="cons-qty">{$t('material.consumption.quantity')}</label>
            <input id="cons-qty" class="field-input" type="number" min="1" bind:value={fQuantity} />
          </div>
          <div>
            <label class="field-label" for="cons-note">{$t('material.consumption.note')}</label>
            <input
              id="cons-note"
              class="field-input"
              placeholder={$t('material.consumption.notePlaceholder')}
              bind:value={fNote}
            />
          </div>
          <button type="submit" class="btn-primary px-5" disabled={logging}>
            <Icon name="plus" size={18} />
            {$t('material.consumption.log')}
          </button>
        </form>
        {#if selectedItem && isLowStock(selectedItem)}
          <p class="mt-2 text-xs text-warning">{$t('material.lowStock')}</p>
        {/if}
      {/if}
    </div>

    <!-- Consumption list -->
    {#if entries.length === 0}
      <EmptyState
        icon="clipboard"
        title={$t('material.consumption.empty')}
        description={$t('material.consumption.emptyHint')}
      />
    {:else}
      <ul class="space-y-2.5">
        {#each entries as e (e.id)}
          <li class="card flex flex-wrap items-center justify-between gap-3 py-4">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{e.quantity}×</Badge>
                <span class="truncate font-medium text-fg">{e.itemName}</span>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span>{$t('material.consumption.recordedAt')}: {fmt(e.recordedAt)}</span>
                {#if e.note}<span>· {e.note}</span>{/if}
              </div>
            </div>
            {#if canManage}
              <button type="button" class="btn-secondary px-4 text-sm" onclick={() => remove(e)}>
                <Icon name="trash" size={16} />
                {$t('material.consumption.remove')}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>
