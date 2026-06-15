<!--
  admin/material/+page.svelte — Material-/Verbrauchsmaterial-Verwaltung (admin/lead).

  A plain consumables/equipment catalog: name, category, unit, stock, minimum
  stock, expiry and storage location. Visual badges flag LOW STOCK (stock ≤ min)
  and EXPIRING SOON / EXPIRED, computed client-side from the raw fields via the
  pure $lib/material helpers (the reference `now` is captured here in the
  component, never in a pure module).

  OPERATIONAL LOGISTICS only — NEVER patient/health data. This is a normal
  inventory, NOT a Betäubungsmittel (BtM) register.

  Gated to admin/lead, mirroring the server's requireRole('admin','lead'); other
  roles are redirected away.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { session, isLeadOrAdmin } from '$lib/store';
  import { api } from '$lib/api';
  import { Modal, Badge, EmptyState, Icon } from '$lib/ui';
  import { materialStatus } from '$lib/material';
  import { MATERIAL_UNITS } from '@aidlog/contracts';
  import type { MaterialItem, UpsertMaterialItemRequest } from '@aidlog/contracts';

  // Reference "now" for client-side expiry derivation (impure -> stays here).
  const now = new Date();

  let items = $state<MaterialItem[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  // --- create/edit modal -----------------------------------------------------
  let editOpen = $state(false);
  let editId = $state<string | null>(null); // null = create
  let fName = $state('');
  let fCategory = $state('');
  let fUnit = $state<string>('Stk');
  let fStock = $state(0);
  let fMin = $state<number | null>(null);
  let fExpiry = $state(''); // YYYY-MM-DD or ''
  let fLocation = $state('');
  let fActive = $state(true);
  let saving = $state(false);

  let deleteTarget = $state<MaterialItem | null>(null);

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    if (!$isLeadOrAdmin) {
      await goto('/');
      return;
    }
    await refresh();
  });

  async function refresh(): Promise<void> {
    loadError = null;
    loading = true;
    try {
      const res = await api.listMaterial();
      items = res.items;
    } catch {
      loadError = $t('material.loadFailed');
    } finally {
      loading = false;
    }
  }

  function openCreate(): void {
    actionError = null;
    editId = null;
    fName = '';
    fCategory = '';
    fUnit = 'Stk';
    fStock = 0;
    fMin = null;
    fExpiry = '';
    fLocation = '';
    fActive = true;
    editOpen = true;
  }

  function openEdit(item: MaterialItem): void {
    actionError = null;
    editId = item.id;
    fName = item.name;
    fCategory = item.category ?? '';
    fUnit = item.unit;
    fStock = item.stockQuantity;
    fMin = item.minQuantity ?? null;
    fExpiry = item.expiresAt ?? '';
    fLocation = item.location ?? '';
    fActive = item.active;
    editOpen = true;
  }

  function buildRequest(): UpsertMaterialItemRequest {
    return {
      name: fName.trim(),
      category: fCategory.trim() || null,
      unit: fUnit,
      stockQuantity: Number.isFinite(fStock) ? Math.max(0, Math.trunc(fStock)) : 0,
      minQuantity: fMin == null || !Number.isFinite(fMin) ? null : Math.max(0, Math.trunc(fMin)),
      expiresAt: fExpiry || null,
      location: fLocation.trim() || null,
      active: fActive,
    };
  }

  async function save(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!fName.trim()) return;
    actionError = null;
    saving = true;
    try {
      const req = buildRequest();
      if (editId) await api.updateMaterialItem(editId, req);
      else await api.createMaterialItem(req);
      editOpen = false;
      await refresh();
    } catch {
      actionError = $t('material.saveFailed');
    } finally {
      saving = false;
    }
  }

  async function confirmDelete(): Promise<void> {
    const item = deleteTarget;
    deleteTarget = null;
    if (!item) return;
    actionError = null;
    try {
      await api.deleteMaterialItem(item.id);
      await refresh();
    } catch {
      actionError = $t('material.deleteFailed');
    }
  }

  function unitLabel(unit: string): string {
    // Known presets map to a localized long label; unknown free units pass through.
    return (MATERIAL_UNITS as readonly string[]).includes(unit)
      ? $t(`material.units.${unit}`)
      : unit;
  }
</script>

<section class="space-y-6">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-1">
      <div class="flex items-center gap-2">
        <a class="btn-ghost px-2" href="/" aria-label={$t('common.back')}>
          <Icon name="arrow-left" size={20} />
        </a>
        <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('material.title')}</h1>
      </div>
      <p class="text-muted">{$t('material.subtitle')}</p>
      <p class="text-xs text-subtle">{$t('material.privacyNote')}</p>
    </div>
    <button type="button" class="btn-primary px-5" onclick={openCreate}>
      <Icon name="plus" size={20} />
      {$t('material.add')}
    </button>
  </header>

  {#if loadError}
    <p class="field-error" role="alert">{loadError}</p>
  {/if}
  {#if actionError}
    <p class="field-error" role="alert">{actionError}</p>
  {/if}

  {#if loading}
    <p class="text-muted">{$t('common.loading')}</p>
  {:else if items.length === 0}
    <EmptyState
      icon="clipboard"
      title={$t('material.empty')}
      description={$t('material.emptyHint')}
    />
  {:else}
    <ul class="space-y-2.5">
      {#each items as item (item.id)}
        {@const s = materialStatus(item, now)}
        <li class="card flex flex-wrap items-center justify-between gap-3 py-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="truncate font-medium text-fg">{item.name}</span>
              {#if item.category}<Badge tone="muted">{item.category}</Badge>{/if}
              {#if !item.active}<Badge tone="muted">{$t('material.inactive')}</Badge>{/if}
              {#if s.lowStock}<Badge tone="warning">{$t('material.lowStock')}</Badge>{/if}
              {#if s.expired}
                <Badge tone="danger">{$t('material.expired')}</Badge>
              {:else if s.expiringSoon}
                <Badge tone="warning">{$t('material.expiringSoon')}</Badge>
              {/if}
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <span>{$t('material.stock')}: {item.stockQuantity} {unitLabel(item.unit)}</span>
              {#if item.minQuantity != null}
                <span>· {$t('material.minStock')}: {item.minQuantity}</span>
              {/if}
              {#if item.expiresAt}
                <span>· {$t('material.expiry')}: {item.expiresAt}</span>
              {/if}
              {#if item.location}<span>· {item.location}</span>{/if}
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="btn-secondary px-4 text-sm" onclick={() => openEdit(item)}>
              <Icon name="edit" size={16} />
              {$t('common.edit')}
            </button>
            <button
              type="button"
              class="btn-danger px-4 text-sm"
              onclick={() => (deleteTarget = item)}
            >
              <Icon name="trash" size={16} />
              {$t('common.delete')}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<!-- Create / edit modal -->
<Modal
  open={editOpen}
  title={editId ? $t('material.edit') : $t('material.create')}
  onClose={() => (editOpen = false)}
>
  <form class="space-y-4" onsubmit={save}>
    <div>
      <label class="field-label" for="mat-name">{$t('material.name')}</label>
      <input id="mat-name" class="field-input" bind:value={fName} required />
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="field-label" for="mat-cat">{$t('material.category')}</label>
        <input
          id="mat-cat"
          class="field-input"
          placeholder={$t('material.categoryPlaceholder')}
          bind:value={fCategory}
        />
      </div>
      <div>
        <label class="field-label" for="mat-unit">{$t('material.unit')}</label>
        <select id="mat-unit" class="field-input" bind:value={fUnit}>
          {#each MATERIAL_UNITS as u (u)}
            <option value={u}>{$t(`material.units.${u}`)}</option>
          {/each}
        </select>
      </div>
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="field-label" for="mat-stock">{$t('material.stock')}</label>
        <input id="mat-stock" class="field-input" type="number" min="0" bind:value={fStock} />
      </div>
      <div>
        <label class="field-label" for="mat-min">{$t('material.minStock')}</label>
        <input id="mat-min" class="field-input" type="number" min="0" bind:value={fMin} />
        <p class="mt-1 text-xs text-subtle">{$t('material.minStockHint')}</p>
      </div>
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="field-label" for="mat-exp">{$t('material.expiry')}</label>
        <input id="mat-exp" class="field-input" type="date" bind:value={fExpiry} />
      </div>
      <div>
        <label class="field-label" for="mat-loc">{$t('material.location')}</label>
        <input
          id="mat-loc"
          class="field-input"
          placeholder={$t('material.locationPlaceholder')}
          bind:value={fLocation}
        />
      </div>
    </div>
    <label class="flex items-center gap-2 text-sm text-fg">
      <input type="checkbox" class="h-5 w-5 rounded border-line-strong" bind:checked={fActive} />
      {$t('material.active')}
    </label>
    {#if actionError}
      <p class="field-error" role="alert">{actionError}</p>
    {/if}
    <button type="submit" class="btn-primary w-full" disabled={saving}>
      {saving ? $t('common.loading') : $t('common.save')}
    </button>
  </form>
</Modal>

<!-- Delete confirm modal -->
<Modal
  open={deleteTarget !== null}
  title={$t('common.delete')}
  onClose={() => (deleteTarget = null)}
>
  {#if deleteTarget}
    <div class="space-y-4">
      <p class="text-sm text-fg">
        {$t('material.deleteConfirm')}
        <span class="font-medium">{deleteTarget.name}</span>
      </p>
      <p class="text-sm text-muted">{$t('material.deleteExplain')}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-ghost px-4" onclick={() => (deleteTarget = null)}>
          {$t('common.cancel')}
        </button>
        <button type="button" class="btn-danger px-4" onclick={confirmDelete}>
          <Icon name="trash" size={16} />{$t('common.delete')}
        </button>
      </div>
    </div>
  {/if}
</Modal>
