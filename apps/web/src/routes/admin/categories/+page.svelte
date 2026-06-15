<!--
  admin/categories/+page.svelte — Protokoll-Kategorien (admin only).

  An admin defines protocol CATEGORIES (Sanitätsdienst / HvO / EGB …). Each
  carries its OWN protocol schema (a DocSchema) and a `createPermission` deciding
  who may create a deployment ("Veranstaltung"/"Einsatz") under it.

  This page:
   - lists categories (name, deploymentLabel, permission badge, color, active),
   - creates / edits the category meta in a modal,
   - soft-deletes (sets active=false) or restores,
   - and offers "Schema bearbeiten" which swaps in the SHARED <SchemaBuilder>
     scoped to THIS category, saving via upsertCategory({ id, schema }) instead of
     the global saveActiveSchema. The org-active schema is the fallback when a
     category has no schema yet.

  Admin-only: this client guard mirrors the server's requireAdmin on the
  categories route. Non-admins are redirected away.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { session, isAdmin } from '$lib/store';
  import { Modal, Badge, EmptyState, Icon } from '$lib/ui';
  import type {
    CategoryCreatePermission,
    ProtocolCategory,
    UpsertCategoryRequest,
  } from '@aidlog/contracts';
  import {
    categories,
    loadCategories,
    categoryById,
    upsertCategory,
    deleteCategory,
    schemaForCategory,
  } from '$lib/categories';
  import SchemaBuilder from '$lib/schemas/SchemaBuilder.svelte';
  import type { DocSchema } from '$lib/schemas/types';
  import { validateSchema } from '$lib/schemas/editor';

  const PERMISSIONS: readonly CategoryCreatePermission[] = ['all', 'lead', 'admin'];

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  // --- meta create/edit modal ------------------------------------------------
  let editOpen = $state(false);
  let editId = $state<string | null>(null); // null = create
  let fName = $state('');
  let fDescription = $state('');
  let fDeploymentLabel = $state('');
  let fPermission = $state<CategoryCreatePermission>('all');
  let fColor = $state('#2563eb');
  let fSortOrder = $state(0);
  let fActive = $state(true);
  let saving = $state(false);

  // --- schema-builder mode ---------------------------------------------------
  // When set, the page swaps the list for the shared <SchemaBuilder> scoped to
  // this category. Driven by ?category=<id> so admin/schema can deep-link here.
  let schemaCategoryId = $state<string | null>(null);
  let schemaDraft = $state<DocSchema | null>(null);
  let schemaSaving = $state(false);
  let schemaSaved = $state(false);
  let schemaError = $state<string | null>(null);

  const schemaCategory = $derived(categoryById(schemaCategoryId ?? undefined));
  const schemaValidation = $derived(schemaDraft ? validateSchema(schemaDraft) : null);

  function clone(s: DocSchema): DocSchema {
    return structuredClone(s);
  }

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    if (!$isAdmin) {
      await goto('/');
      return;
    }
    try {
      await loadCategories();
    } catch {
      loadError = $t('categories.loadFailed');
    } finally {
      loading = false;
    }
    // Deep-link: /admin/categories?category=<id> opens the schema builder.
    const deepId = $page.url.searchParams.get('category');
    if (deepId) openSchema(deepId);
  });

  // --- meta modal ------------------------------------------------------------
  function openCreate(): void {
    actionError = null;
    editId = null;
    fName = '';
    fDescription = '';
    fDeploymentLabel = '';
    fPermission = 'all';
    fColor = '#2563eb';
    fSortOrder = $categories.length;
    fActive = true;
    editOpen = true;
  }

  function openEdit(c: ProtocolCategory): void {
    actionError = null;
    editId = c.id;
    fName = c.name;
    fDescription = c.description ?? '';
    fDeploymentLabel = c.deploymentLabel ?? '';
    fPermission = c.createPermission;
    fColor = c.color ?? '#2563eb';
    fSortOrder = c.sortOrder;
    fActive = c.active;
    editOpen = true;
  }

  async function saveMeta(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const name = fName.trim();
    if (!name) return;
    actionError = null;
    saving = true;
    try {
      const req: UpsertCategoryRequest = {
        ...(editId ? { id: editId } : {}),
        name,
        description: fDescription.trim() || undefined,
        deploymentLabel: fDeploymentLabel.trim() || undefined,
        createPermission: fPermission,
        color: fColor || undefined,
        sortOrder: Number.isFinite(fSortOrder) ? fSortOrder : 0,
        active: fActive,
      };
      await upsertCategory(req);
      editOpen = false;
    } catch {
      actionError = $t('categories.saveFailed');
    } finally {
      saving = false;
    }
  }

  // --- soft delete / restore -------------------------------------------------
  let deleteTarget = $state<ProtocolCategory | null>(null);

  async function confirmDelete(): Promise<void> {
    const c = deleteTarget;
    deleteTarget = null;
    if (!c) return;
    actionError = null;
    try {
      // Soft-delete: keep the record but deactivate it (so existing deployments
      // that reference it still resolve their schema). A future hard-delete could
      // call deleteCategory(c.id) — wired but not the default action.
      await upsertCategory({
        id: c.id,
        name: c.name,
        description: c.description,
        deploymentLabel: c.deploymentLabel,
        createPermission: c.createPermission,
        color: c.color,
        sortOrder: c.sortOrder,
        active: false,
      });
    } catch {
      actionError = $t('categories.deleteFailed');
    }
  }

  async function restore(c: ProtocolCategory): Promise<void> {
    actionError = null;
    try {
      await upsertCategory({
        id: c.id,
        name: c.name,
        description: c.description,
        deploymentLabel: c.deploymentLabel,
        createPermission: c.createPermission,
        color: c.color,
        sortOrder: c.sortOrder,
        active: true,
      });
    } catch {
      actionError = $t('categories.saveFailed');
    }
  }

  // --- schema builder --------------------------------------------------------
  function openSchema(id: string): void {
    const c = categoryById(id);
    if (!c) return;
    schemaError = null;
    schemaSaved = false;
    schemaCategoryId = id;
    // Seed from the category's own schema, falling back to org-active / ABCDE so
    // the admin starts from a sensible template rather than a blank form.
    schemaDraft = clone(schemaForCategory(c));
  }

  function closeSchema(): void {
    schemaCategoryId = null;
    schemaDraft = null;
  }

  function touchSchema(): void {
    schemaSaved = false;
    schemaError = null;
  }

  async function saveSchema(): Promise<void> {
    if (!schemaDraft || !schemaCategory) return;
    schemaError = null;
    schemaSaved = false;
    const v = validateSchema(schemaDraft);
    if (!v.ok) {
      schemaError = v.errors.map((e) => $t(`schemaEditor.errors.${e}`)).join(' ');
      return;
    }
    schemaSaving = true;
    try {
      // Persist via upsertCategory({ id, schema }) — NOT saveActiveSchema, so this
      // updates only THIS category's schema.
      await upsertCategory({
        id: schemaCategory.id,
        name: schemaCategory.name,
        description: schemaCategory.description,
        deploymentLabel: schemaCategory.deploymentLabel,
        createPermission: schemaCategory.createPermission,
        color: schemaCategory.color,
        sortOrder: schemaCategory.sortOrder,
        active: schemaCategory.active,
        schema: $state.snapshot(schemaDraft),
      });
      schemaSaved = true;
    } catch {
      schemaError = $t('categories.saveFailed');
    } finally {
      schemaSaving = false;
    }
  }

  function permTone(p: CategoryCreatePermission): 'ok' | 'warning' | 'danger' {
    return p === 'all' ? 'ok' : p === 'lead' ? 'warning' : 'danger';
  }
</script>

<section class="space-y-6">
  {#if schemaCategoryId && schemaDraft}
    <!-- Schema-builder mode, scoped to one category -->
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn-ghost px-2"
            aria-label={$t('common.back')}
            onclick={closeSchema}
          >
            <Icon name="arrow-left" size={20} />
          </button>
          <h1 class="text-2xl font-semibold tracking-tight text-fg">
            {$t('categories.schemaTitle', { name: schemaCategory?.name ?? '' })}
          </h1>
        </div>
        <p class="text-muted">{$t('categories.schemaSubtitle')}</p>
      </div>
      <button
        type="button"
        class="btn-primary px-5 text-sm"
        onclick={saveSchema}
        disabled={schemaSaving}
      >
        <Icon name="check" size={18} />
        {schemaSaving ? $t('schemaEditor.saving') : $t('schemaEditor.save')}
      </button>
    </header>

    {#if schemaError}
      <p class="field-error" role="alert">{schemaError}</p>
    {/if}
    {#if schemaSaved}
      <div class="flex gap-3 rounded-xl border border-line bg-ok-soft/40 p-3" role="status">
        <span class="shrink-0 text-ok-fg"><Icon name="check" size={18} /></span>
        <p class="text-sm text-ok-fg">{$t('categories.schemaSaved')}</p>
      </div>
    {/if}

    <SchemaBuilder bind:schema={schemaDraft} onchange={touchSchema} />
  {:else}
    <!-- List mode -->
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <a class="btn-ghost px-2" href="/admin/users/" aria-label={$t('common.back')}>
            <Icon name="arrow-left" size={20} />
          </a>
          <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('categories.title')}</h1>
        </div>
        <p class="text-muted">{$t('categories.subtitle')}</p>
      </div>
      <button type="button" class="btn-primary px-5" onclick={openCreate}>
        <Icon name="plus" size={20} />
        {$t('categories.add')}
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
    {:else if $categories.length === 0}
      <EmptyState icon="clipboard" title={$t('categories.empty')} />
    {:else}
      <ul class="space-y-2.5">
        {#each $categories as c (c.id)}
          <li class="card flex flex-wrap items-center justify-between gap-3 py-4">
            <div class="flex min-w-0 items-center gap-3">
              <span
                class="h-8 w-8 shrink-0 rounded-full border border-line"
                style={`background:${c.color || 'var(--color-brand, currentColor)'}`}
                aria-hidden="true"
              ></span>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="truncate font-medium text-fg">{c.name}</span>
                  <Badge tone={permTone(c.createPermission)}>
                    {$t(`categories.permissions.${c.createPermission}`)}
                  </Badge>
                  {#if !c.active}
                    <Badge tone="muted">{$t('categories.inactive')}</Badge>
                  {/if}
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>{$t('categories.labelTerm')}: {c.deploymentLabel || '—'}</span>
                  {#if c.description}<span class="truncate">· {c.description}</span>{/if}
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="btn-secondary px-4 text-sm"
                onclick={() => openSchema(c.id)}
              >
                <Icon name="settings" size={16} />
                {$t('categories.editSchema')}
              </button>
              <button type="button" class="btn-secondary px-4 text-sm" onclick={() => openEdit(c)}>
                <Icon name="edit" size={16} />
                {$t('common.edit')}
              </button>
              {#if c.active}
                <button
                  type="button"
                  class="btn-danger px-4 text-sm"
                  onclick={() => (deleteTarget = c)}
                >
                  <Icon name="trash" size={16} />
                  {$t('categories.deactivate')}
                </button>
              {:else}
                <button type="button" class="btn-secondary px-4 text-sm" onclick={() => restore(c)}>
                  {$t('categories.restore')}
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<!-- Create / edit meta modal -->
<Modal
  open={editOpen}
  title={editId ? $t('categories.editTitle') : $t('categories.createTitle')}
  onClose={() => (editOpen = false)}
>
  <form class="space-y-4" onsubmit={saveMeta}>
    <div>
      <label class="field-label" for="cat-name">{$t('categories.name')}</label>
      <input id="cat-name" class="field-input" bind:value={fName} required />
    </div>
    <div>
      <label class="field-label" for="cat-desc">{$t('categories.description')}</label>
      <input id="cat-desc" class="field-input" bind:value={fDescription} />
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="field-label" for="cat-label">{$t('categories.deploymentLabel')}</label>
        <input
          id="cat-label"
          class="field-input"
          placeholder={$t('categories.deploymentLabelPlaceholder')}
          bind:value={fDeploymentLabel}
        />
      </div>
      <div>
        <label class="field-label" for="cat-perm">{$t('categories.createPermission')}</label>
        <select id="cat-perm" class="field-input" bind:value={fPermission}>
          {#each PERMISSIONS as p (p)}
            <option value={p}>{$t(`categories.permissions.${p}`)}</option>
          {/each}
        </select>
      </div>
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="field-label" for="cat-color">{$t('categories.color')}</label>
        <input id="cat-color" class="field-input h-touch p-1" type="color" bind:value={fColor} />
      </div>
      <div>
        <label class="field-label" for="cat-sort">{$t('categories.sortOrder')}</label>
        <input id="cat-sort" class="field-input" type="number" bind:value={fSortOrder} />
      </div>
    </div>
    <label class="flex items-center gap-2 text-sm text-fg">
      <input type="checkbox" class="h-5 w-5 rounded border-line-strong" bind:checked={fActive} />
      {$t('categories.active')}
    </label>
    <p class="text-xs text-subtle">{$t('categories.schemaHint')}</p>
    {#if actionError}
      <p class="field-error" role="alert">{actionError}</p>
    {/if}
    <button type="submit" class="btn-primary w-full" disabled={saving}>
      {saving ? $t('schemaEditor.saving') : $t('common.save')}
    </button>
  </form>
</Modal>

<!-- Deactivate confirm modal -->
<Modal
  open={deleteTarget !== null}
  title={$t('categories.deactivateTitle')}
  onClose={() => (deleteTarget = null)}
>
  {#if deleteTarget}
    <div class="space-y-4">
      <p class="text-sm text-fg">
        {$t('categories.deactivateConfirm')}
        <span class="font-medium">{deleteTarget.name}</span>
      </p>
      <p class="text-sm text-muted">{$t('categories.deactivateExplain')}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-ghost px-4" onclick={() => (deleteTarget = null)}>
          {$t('common.cancel')}
        </button>
        <button type="button" class="btn-danger px-4" onclick={confirmDelete}>
          <Icon name="trash" size={16} />{$t('categories.deactivate')}
        </button>
      </div>
    </div>
  {/if}
</Modal>
