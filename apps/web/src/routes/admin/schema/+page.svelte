<!--
  admin/schema/+page.svelte — In-App Protokoll-Schema-Editor (admin only).

  A visual builder for the org's DocSchema (sections + fields) that drives the
  documentation form. Loads the active schema via loadActiveSchema() and persists
  with saveActiveSchema() (the server bumps the version). The schema is FIELD
  DEFINITIONS only — no patient data is involved here.

  The editing surface is the shared <SchemaBuilder>, also reused by
  admin/categories to edit a CATEGORY's own schema. This page persists to the
  legacy org schema (the "default" category) via saveActiveSchema.

  Admin-only: this client guard mirrors the server's requireAdmin on PUT
  /api/org/schema. Non-admins are redirected away.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { session, isAdmin } from '$lib/store';
  import { Modal, Icon } from '$lib/ui';
  import { loadActiveSchema, saveActiveSchema, defaultSchema } from '$lib/schemas/store';
  import SchemaBuilder from '$lib/schemas/SchemaBuilder.svelte';
  import type { DocSchema } from '$lib/schemas/types';
  import { validateSchema } from '$lib/schemas/editor';

  // Deep clone so editing never mutates the cached/active schema in place.
  function clone(s: DocSchema): DocSchema {
    return structuredClone(s);
  }

  let schema = $state<DocSchema>(clone(defaultSchema));
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let saved = $state(false);
  let resetOpen = $state(false);

  const validation = $derived(validateSchema(schema));

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
      const active = await loadActiveSchema();
      schema = clone(active);
    } catch {
      loadError = $t('schemaEditor.loadFailed');
    } finally {
      loading = false;
    }
  });

  // Any edit invalidates the "saved" banner.
  function touch(): void {
    saved = false;
    saveError = null;
  }

  function confirmReset(): void {
    schema = clone(defaultSchema);
    resetOpen = false;
    touch();
  }

  async function save(): Promise<void> {
    saveError = null;
    saved = false;
    if (!validation.ok) {
      saveError = validation.errors.map((e) => $t(`schemaEditor.errors.${e}`)).join(' ');
      return;
    }
    saving = true;
    try {
      await saveActiveSchema($state.snapshot(schema));
      saved = true;
    } catch {
      saveError = $t('schemaEditor.saveFailed');
    } finally {
      saving = false;
    }
  }
</script>

<section class="space-y-6">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-1">
      <div class="flex items-center gap-2">
        <a class="btn-ghost px-2" href="/admin/users/" aria-label={$t('common.back')}>
          <Icon name="arrow-left" size={20} />
        </a>
        <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('schemaEditor.title')}</h1>
      </div>
      <p class="text-muted">{$t('schemaEditor.subtitle')}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn-secondary px-4 text-sm" onclick={() => (resetOpen = true)}>
        {$t('schemaEditor.reset')}
      </button>
      <button
        type="button"
        class="btn-primary px-5 text-sm"
        onclick={save}
        disabled={saving || loading}
      >
        <Icon name="check" size={18} />
        {saving ? $t('schemaEditor.saving') : $t('schemaEditor.save')}
      </button>
    </div>
  </header>

  {#if loadError}
    <p class="field-error" role="alert">{loadError}</p>
  {/if}
  {#if saveError}
    <p class="field-error" role="alert">{saveError}</p>
  {/if}
  {#if saved}
    <div class="flex gap-3 rounded-xl border border-line bg-ok-soft/40 p-3" role="status">
      <span class="shrink-0 text-ok-fg"><Icon name="check" size={18} /></span>
      <p class="text-sm text-ok-fg">{$t('schemaEditor.saved')}</p>
    </div>
  {/if}

  <!-- Breaking-change advisory (informational; never blocks) -->
  <div class="flex gap-3 rounded-xl border border-line bg-warning-soft/40 p-3">
    <span class="shrink-0 text-warning"><Icon name="alert" size={18} /></span>
    <div class="space-y-0.5">
      <p class="text-sm font-medium text-warning-fg">{$t('schemaEditor.breakingTitle')}</p>
      <p class="text-sm text-warning-fg">{$t('schemaEditor.breakingWarning')}</p>
    </div>
  </div>

  {#if loading}
    <p class="text-muted">{$t('common.loading')}</p>
  {:else}
    <SchemaBuilder bind:schema onchange={touch} />
  {/if}
</section>

<!-- Reset-to-template confirm modal -->
<Modal
  open={resetOpen}
  title={$t('schemaEditor.resetConfirmTitle')}
  onClose={() => (resetOpen = false)}
>
  <div class="space-y-4">
    <p class="text-sm text-fg">{$t('schemaEditor.resetConfirm')}</p>
    <div class="flex justify-end gap-2">
      <button type="button" class="btn-ghost px-4" onclick={() => (resetOpen = false)}>
        {$t('common.cancel')}
      </button>
      <button type="button" class="btn-primary px-4" onclick={confirmReset}>
        {$t('schemaEditor.resetConfirmBtn')}
      </button>
    </div>
  </div>
</Modal>
