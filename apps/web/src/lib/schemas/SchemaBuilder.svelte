<!--
  SchemaBuilder.svelte — the reusable visual DocSchema builder.

  Extracted from admin/schema/+page.svelte so the SAME builder UI can edit either
  the org-active schema (admin/schema) OR a protocol CATEGORY's own schema
  (admin/categories → "Schema bearbeiten"). The component owns only the EDITING
  surface (schema meta, section list, per-section field editor, live preview); the
  parent owns loading, the save target (saveActiveSchema vs upsertCategory) and the
  page chrome. The schema is a `$bindable` so the parent reads the edited value.

  A schema is FIELD DEFINITIONS only — no patient data is ever involved here.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import { Badge, EmptyState, Icon } from '$lib/ui';
  import type { DocField, DocSchema, FieldOption, FieldType } from './types';
  import {
    FIELD_TYPES,
    typeNeedsOptions,
    suggestKey,
    isValidKey,
    allFieldKeys,
    otherFieldKeys,
    newSection,
    newField,
    move,
  } from './editor';

  interface Props {
    /** The schema being edited (two-way bound; the parent persists it). */
    schema: DocSchema;
    /** Notified after every edit, so the parent can clear "saved" banners. */
    onchange?: () => void;
  }

  let { schema = $bindable(), onchange }: Props = $props();

  let selectedIndex = $state(0);
  const selectedSection = $derived(schema.sections[selectedIndex] ?? null);

  function touch(): void {
    onchange?.();
  }

  // --- section operations ------------------------------------------------
  function addSection(): void {
    const taken = [...schema.sections.map((s) => s.key), ...allFieldKeys(schema)];
    schema.sections = [...schema.sections, newSection(taken)];
    selectedIndex = schema.sections.length - 1;
    touch();
  }
  function removeSection(index: number): void {
    schema.sections = schema.sections.filter((_, i) => i !== index);
    if (selectedIndex >= schema.sections.length)
      selectedIndex = Math.max(0, schema.sections.length - 1);
    touch();
  }
  function moveSection(index: number, delta: number): void {
    schema.sections = move(schema.sections, index, delta);
    const target = index + delta;
    if (selectedIndex === index)
      selectedIndex = Math.min(Math.max(0, target), schema.sections.length - 1);
    touch();
  }

  // --- field operations (within the selected section) --------------------
  function addField(): void {
    if (!selectedSection) return;
    const field = newField(allFieldKeys(schema));
    selectedSection.fields = [...selectedSection.fields, field];
    touch();
  }
  function removeField(index: number): void {
    if (!selectedSection) return;
    selectedSection.fields = selectedSection.fields.filter((_, i) => i !== index);
    touch();
  }
  function moveField(index: number, delta: number): void {
    if (!selectedSection) return;
    selectedSection.fields = move(selectedSection.fields, index, delta);
    touch();
  }
  function suggestFieldKey(field: DocField): void {
    field.key = suggestKey(field.label, otherFieldKeys(schema, field));
    touch();
  }
  function onTypeChange(field: DocField, type: FieldType): void {
    field.type = type;
    if (typeNeedsOptions(type) && !field.options) field.options = [];
    touch();
  }

  // --- option operations (for select/multiselect fields) -----------------
  function addOption(field: DocField): void {
    const opt: FieldOption = { value: '', label: '' };
    field.options = [...(field.options ?? []), opt];
    touch();
  }
  function removeOption(field: DocField, index: number): void {
    field.options = (field.options ?? []).filter((_, i) => i !== index);
    touch();
  }

  // Reset selection if the bound schema shrank from underneath us (parent reload).
  $effect(() => {
    if (selectedIndex >= schema.sections.length) {
      selectedIndex = Math.max(0, schema.sections.length - 1);
    }
  });
</script>

<div class="space-y-6">
  <!-- Schema meta -->
  <section class="card space-y-4">
    <h2 class="text-base font-semibold text-fg">{$t('schemaEditor.schemaMeta')}</h2>
    <div class="grid gap-3 sm:grid-cols-3">
      <div>
        <label class="field-label" for="schema-id">{$t('schemaEditor.schemaId')}</label>
        <input id="schema-id" class="field-input" bind:value={schema.schemaId} oninput={touch} />
      </div>
      <div>
        <label class="field-label" for="schema-title">{$t('schemaEditor.schemaTitle')}</label>
        <input id="schema-title" class="field-input" bind:value={schema.title} oninput={touch} />
      </div>
      <div>
        <span class="field-label">{$t('schemaEditor.version')}</span>
        <p class="min-h-touch flex items-center text-base text-muted">v{schema.version}</p>
      </div>
    </div>
  </section>

  <div class="grid gap-6 lg:grid-cols-[18rem_1fr]">
    <!-- Section list -->
    <aside class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-fg">{$t('schemaEditor.sections')}</h2>
        <button type="button" class="btn-secondary px-3 text-sm" onclick={addSection}>
          <Icon name="plus" size={16} />{$t('schemaEditor.addSection')}
        </button>
      </div>
      {#if schema.sections.length === 0}
        <EmptyState icon="clipboard" title={$t('schemaEditor.noSections')} />
      {:else}
        <ul class="space-y-2">
          {#each schema.sections as section, i (section)}
            <li
              class="card flex items-center gap-2 p-2.5 {i === selectedIndex ? 'border-brand' : ''}"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 text-left"
                onclick={() => (selectedIndex = i)}
              >
                {#if section.badge}
                  <Badge tone="brand">{section.badge}</Badge>
                {/if}
                <span class="truncate font-medium text-fg">{section.title}</span>
                <span class="text-xs text-subtle">({section.fields.length})</span>
              </button>
              <div class="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  class="btn-ghost px-1.5"
                  aria-label={$t('schemaEditor.moveUp')}
                  title={$t('schemaEditor.moveUp')}
                  disabled={i === 0}
                  onclick={() => moveSection(i, -1)}
                >
                  <span class="block rotate-180"><Icon name="chevron-down" size={16} /></span>
                </button>
                <button
                  type="button"
                  class="btn-ghost px-1.5"
                  aria-label={$t('schemaEditor.moveDown')}
                  title={$t('schemaEditor.moveDown')}
                  disabled={i === schema.sections.length - 1}
                  onclick={() => moveSection(i, 1)}
                >
                  <Icon name="chevron-down" size={16} />
                </button>
                <button
                  type="button"
                  class="btn-ghost px-1.5 text-danger"
                  aria-label={$t('schemaEditor.remove')}
                  title={$t('schemaEditor.remove')}
                  onclick={() => removeSection(i)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </aside>

    <!-- Selected section editor + preview -->
    <div class="space-y-6">
      {#if !selectedSection}
        <EmptyState icon="edit" title={$t('schemaEditor.selectSection')} />
      {:else}
        <!-- Section meta -->
        <section class="card space-y-4">
          <div class="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <div>
              <label class="field-label" for="sec-title">{$t('schemaEditor.sectionTitle')}</label>
              <input
                id="sec-title"
                class="field-input"
                bind:value={selectedSection.title}
                oninput={touch}
              />
            </div>
            <div>
              <label class="field-label" for="sec-badge">{$t('schemaEditor.sectionBadge')}</label>
              <input
                id="sec-badge"
                class="field-input"
                maxlength="3"
                bind:value={selectedSection.badge}
                oninput={touch}
              />
            </div>
          </div>
          <p class="text-xs text-subtle">{$t('schemaEditor.sectionBadgeHint')}</p>
        </section>

        <!-- Field list -->
        <section class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-fg">{$t('schemaEditor.fields')}</h2>
            <button type="button" class="btn-secondary px-3 text-sm" onclick={addField}>
              <Icon name="plus" size={16} />{$t('schemaEditor.addField')}
            </button>
          </div>

          {#if selectedSection.fields.length === 0}
            <EmptyState icon="file-text" title={$t('schemaEditor.noFields')} />
          {:else}
            <ul class="space-y-3">
              {#each selectedSection.fields as field, fi (field)}
                <li class="card space-y-3">
                  <div class="flex items-start justify-between gap-2">
                    <div class="grid flex-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label class="field-label" for={`f-label-${fi}`}>
                          {$t('schemaEditor.fieldLabel')}
                        </label>
                        <input
                          id={`f-label-${fi}`}
                          class="field-input"
                          bind:value={field.label}
                          oninput={touch}
                        />
                      </div>
                      <div>
                        <label class="field-label" for={`f-type-${fi}`}>
                          {$t('schemaEditor.fieldType')}
                        </label>
                        <select
                          id={`f-type-${fi}`}
                          class="field-input"
                          value={field.type}
                          onchange={(e) =>
                            onTypeChange(
                              field,
                              (e.currentTarget as HTMLSelectElement).value as FieldType,
                            )}
                        >
                          {#each FIELD_TYPES as ft (ft)}
                            <option value={ft}>{$t(`schemaEditor.types.${ft}`)}</option>
                          {/each}
                        </select>
                      </div>
                    </div>
                    <div class="flex shrink-0 flex-col gap-0.5">
                      <button
                        type="button"
                        class="btn-ghost px-1.5"
                        aria-label={$t('schemaEditor.moveUp')}
                        title={$t('schemaEditor.moveUp')}
                        disabled={fi === 0}
                        onclick={() => moveField(fi, -1)}
                      >
                        <span class="block rotate-180"><Icon name="chevron-down" size={16} /></span>
                      </button>
                      <button
                        type="button"
                        class="btn-ghost px-1.5"
                        aria-label={$t('schemaEditor.moveDown')}
                        title={$t('schemaEditor.moveDown')}
                        disabled={fi === selectedSection.fields.length - 1}
                        onclick={() => moveField(fi, 1)}
                      >
                        <Icon name="chevron-down" size={16} />
                      </button>
                      <button
                        type="button"
                        class="btn-ghost px-1.5 text-danger"
                        aria-label={$t('schemaEditor.remove')}
                        title={$t('schemaEditor.remove')}
                        onclick={() => removeField(fi)}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </div>

                  <!-- key + unit + span + required -->
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label class="field-label" for={`f-key-${fi}`}>
                        {$t('schemaEditor.fieldKey')}
                      </label>
                      <div class="flex gap-2">
                        <input
                          id={`f-key-${fi}`}
                          class="field-input font-mono text-sm {isValidKey(field.key)
                            ? ''
                            : 'border-danger'}"
                          bind:value={field.key}
                          oninput={touch}
                        />
                        <button
                          type="button"
                          class="btn-ghost shrink-0 px-2 text-xs"
                          title={$t('schemaEditor.suggestKey')}
                          onclick={() => suggestFieldKey(field)}
                        >
                          <Icon name="edit" size={16} />
                        </button>
                      </div>
                      <p class="mt-1 text-xs text-subtle">{$t('schemaEditor.fieldKeyHint')}</p>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                      <div>
                        <label class="field-label" for={`f-unit-${fi}`}>
                          {$t('schemaEditor.fieldUnit')}
                        </label>
                        <input
                          id={`f-unit-${fi}`}
                          class="field-input"
                          bind:value={field.unit}
                          oninput={touch}
                        />
                      </div>
                      <div>
                        <label class="field-label" for={`f-span-${fi}`}>
                          {$t('schemaEditor.fieldSpan')}
                        </label>
                        <select
                          id={`f-span-${fi}`}
                          class="field-input"
                          value={field.span ?? 2}
                          onchange={(e) => {
                            field.span = Number((e.currentTarget as HTMLSelectElement).value) as
                              | 1
                              | 2;
                            touch();
                          }}
                        >
                          <option value={1}>{$t('schemaEditor.spanHalf')}</option>
                          <option value={2}>{$t('schemaEditor.spanFull')}</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <label class="flex items-center gap-2 text-sm text-fg">
                    <input
                      type="checkbox"
                      class="h-5 w-5 rounded border-line-strong"
                      checked={field.required ?? false}
                      onchange={(e) => {
                        field.required = (e.currentTarget as HTMLInputElement).checked;
                        touch();
                      }}
                    />
                    {$t('schemaEditor.fieldRequired')}
                  </label>

                  <!-- options editor -->
                  {#if typeNeedsOptions(field.type)}
                    <div class="space-y-2 rounded-xl bg-surface-2 p-3">
                      <div class="flex items-center justify-between">
                        <span class="text-sm font-medium text-fg">{$t('schemaEditor.options')}</span
                        >
                        <button
                          type="button"
                          class="btn-ghost px-2 text-xs"
                          onclick={() => addOption(field)}
                        >
                          <Icon name="plus" size={14} />{$t('schemaEditor.addOption')}
                        </button>
                      </div>
                      {#if !field.options || field.options.length === 0}
                        <p class="text-xs text-subtle">{$t('schemaEditor.noOptions')}</p>
                      {:else}
                        <ul class="space-y-2">
                          {#each field.options as opt, oi (opt)}
                            <li class="flex items-center gap-2">
                              <input
                                class="field-input font-mono text-sm"
                                placeholder={$t('schemaEditor.optionValue')}
                                bind:value={opt.value}
                                oninput={touch}
                              />
                              <input
                                class="field-input text-sm"
                                placeholder={$t('schemaEditor.optionLabel')}
                                bind:value={opt.label}
                                oninput={touch}
                              />
                              <button
                                type="button"
                                class="btn-ghost shrink-0 px-1.5 text-danger"
                                aria-label={$t('schemaEditor.remove')}
                                onclick={() => removeOption(field, oi)}
                              >
                                <Icon name="x" size={16} />
                              </button>
                            </li>
                          {/each}
                        </ul>
                      {/if}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <!-- Live preview -->
        <section class="card space-y-3">
          <div class="space-y-0.5">
            <h2 class="text-base font-semibold text-fg">{$t('schemaEditor.preview')}</h2>
            <p class="text-xs text-subtle">{$t('schemaEditor.previewHint')}</p>
          </div>
          <div class="rounded-xl bg-surface-2 p-4">
            <div class="mb-3 flex items-center gap-2">
              {#if selectedSection.badge}
                <Badge tone="brand">{selectedSection.badge}</Badge>
              {/if}
              <h3 class="text-lg font-semibold text-fg">{selectedSection.title}</h3>
            </div>
            {#if selectedSection.fields.length === 0}
              <p class="text-sm text-subtle">{$t('schemaEditor.noFields')}</p>
            {:else}
              <div class="grid grid-cols-2 gap-3">
                {#each selectedSection.fields as field (field)}
                  {@const full = (field.span ?? 2) === 2}
                  <div class={full ? 'col-span-2' : 'col-span-2 sm:col-span-1'}>
                    <span class="field-label">
                      {field.label || field.key}
                      {#if field.required}<span class="text-danger">*</span>{/if}
                      {#if field.unit}<span class="text-subtle">({field.unit})</span>{/if}
                    </span>
                    {#if field.type === 'textarea'}
                      <div class="field-input flex min-h-[4rem] items-start py-2 text-subtle">
                        …
                      </div>
                    {:else if field.type === 'boolean'}
                      <label class="flex items-center gap-2 text-sm text-subtle">
                        <input
                          type="checkbox"
                          disabled
                          class="h-5 w-5 rounded border-line-strong"
                        />
                        {field.label || field.key}
                      </label>
                    {:else if field.type === 'select' || field.type === 'multiselect'}
                      <select class="field-input text-subtle" disabled>
                        {#each field.options ?? [] as opt (opt.value)}
                          <option>{opt.label || opt.value}</option>
                        {/each}
                      </select>
                    {:else if field.type === 'signature'}
                      <div
                        class="field-input flex min-h-[3rem] items-center justify-center border-dashed text-subtle"
                      >
                        ✎
                      </div>
                    {:else}
                      <input
                        class="field-input"
                        disabled
                        type={field.type === 'number' || field.type === 'scale'
                          ? 'number'
                          : field.type === 'date'
                            ? 'date'
                            : field.type === 'time'
                              ? 'time'
                              : field.type === 'datetime'
                                ? 'datetime-local'
                                : 'text'}
                      />
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </section>
      {/if}
    </div>
  </div>
</div>
