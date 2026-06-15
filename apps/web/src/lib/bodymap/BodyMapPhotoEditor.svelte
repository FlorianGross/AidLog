<!--
  BodyMapPhotoEditor.svelte — the "Body-Map & Fotos" editor panel.

  Two concerns in one dedicated panel (NOT a generic-schema section):
    1. Body-map: tap an inline SVG silhouette (front/back) to place an injury
       marker; markers are an editable list with type / severity / note. Stored
       in the payload under `bodymap` and persisted in the encrypted draft.
    2. Photos: capture/select a photo, downscale on-device, hold the bytes in the
       draft. At finalize the parent encrypts each under the record DEK and
       attaches it as an EncryptedBlobRef via the EXISTING blob/outbox flow
       (label `photo:<id>`).

  The parent owns persistence: marker changes emit `onmarkers`, photo changes
  emit `onphotos`. Touch-friendly, both themes, design-system tokens only.
-->
<script lang="ts">
  import { Icon, Badge } from '$lib/ui';
  import { t } from '$lib/i18n';
  import Silhouette from './Silhouette.svelte';
  import PhotoThumb from './PhotoThumb.svelte';
  import { downscaleImage } from './photo';
  import {
    INJURY_TYPES,
    SEVERITIES,
    newMarkerId,
    severityColor,
    severityTone,
    type BodyMarker,
    type BodySide,
    type DraftPhoto,
    type InjurySeverity,
    type InjuryType,
  } from './types';

  interface Props {
    markers: BodyMarker[];
    photos: DraftPhoto[];
    readonly?: boolean;
    onmarkers?: (markers: BodyMarker[]) => void;
    onphotos?: (photos: DraftPhoto[]) => void;
  }
  let { markers, photos, readonly = false, onmarkers, onphotos }: Props = $props();

  let side = $state<BodySide>('front');
  // The "pen" applied to the next placed marker.
  let penType = $state<InjuryType>('wunde');
  let penSeverity = $state<InjurySeverity>('mittel');
  let selectedId = $state<string | null>(null);
  let photoBusy = $state(false);
  let photoError = $state<string | null>(null);

  const sideMarkers = $derived(markers.filter((m) => m.side === side));

  function addMarkerAt(x: number, y: number): void {
    const marker: BodyMarker = {
      id: newMarkerId(),
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      side,
      type: penType,
      severity: penSeverity,
    };
    onmarkers?.([...markers, marker]);
    selectedId = marker.id;
  }

  function place(e: MouseEvent): void {
    if (readonly) return;
    const host = e.currentTarget as HTMLElement;
    const rect = host.getBoundingClientRect();
    addMarkerAt((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  }

  /** Keyboard fallback: Enter/Space drops a marker at the silhouette centre. */
  function placeFromKey(e: KeyboardEvent): void {
    if (readonly) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      addMarkerAt(0.5, 0.5);
    }
  }

  function updateMarker(id: string, patch: Partial<BodyMarker>): void {
    if (readonly) return;
    onmarkers?.(markers.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function removeMarker(id: string): void {
    if (readonly) return;
    onmarkers?.(markers.filter((m) => m.id !== id));
    if (selectedId === id) selectedId = null;
  }

  function indexOfMarker(m: BodyMarker): number {
    return markers.indexOf(m) + 1;
  }

  async function onPhotoPick(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file) return;
    photoBusy = true;
    photoError = null;
    try {
      const scaled = await downscaleImage(file);
      const photo: DraftPhoto = {
        id: newMarkerId(),
        mediaType: scaled.mediaType,
        data: scaled.data,
        capturedAt: new Date().toISOString(),
      };
      onphotos?.([...photos, photo]);
    } catch {
      photoError = $t('bodymap.photoError');
    } finally {
      photoBusy = false;
    }
  }

  function removePhoto(id: string): void {
    if (readonly) return;
    onphotos?.(photos.filter((p) => p.id !== id));
  }
</script>

<div class="space-y-6">
  <!-- BODY-MAP -->
  <section class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-base font-semibold text-fg">{$t('bodymap.title')}</h3>
      <!-- front/back toggle -->
      <div
        class="inline-flex rounded-xl border border-line-strong bg-surface-1 p-0.5"
        role="group"
        aria-label={$t('bodymap.side.front')}
      >
        {#each ['front', 'back'] as const as s}
          <button
            type="button"
            class={`min-h-touch rounded-lg px-4 text-sm font-medium transition-colors ${
              side === s ? 'bg-brand text-brand-fg' : 'text-muted hover:bg-surface-2'
            }`}
            aria-pressed={side === s}
            onclick={() => (side = s)}
          >
            {$t(`bodymap.side.${s}`)}
          </button>
        {/each}
      </div>
    </div>

    {#if !readonly}
      <!-- pen: type + severity for the next placed marker -->
      <div class="flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 p-3">
        <label class="flex items-center gap-2 text-sm text-muted">
          <span>{$t('bodymap.type.label')}</span>
          <select
            class="field-input min-h-0 w-auto py-1.5"
            value={penType}
            onchange={(e) => (penType = e.currentTarget.value as InjuryType)}
          >
            {#each INJURY_TYPES as ty (ty)}
              <option value={ty}>{$t(`bodymap.type.${ty}`)}</option>
            {/each}
          </select>
        </label>
        <div
          class="flex items-center gap-1.5"
          role="group"
          aria-label={$t('bodymap.severity.label')}
        >
          {#each SEVERITIES as sev (sev)}
            <button
              type="button"
              class={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                penSeverity === sev
                  ? 'border-brand bg-brand-soft text-brand-soft-fg'
                  : 'border-line-strong bg-surface-1 text-muted hover:bg-surface-2'
              }`}
              aria-pressed={penSeverity === sev}
              onclick={() => (penSeverity = sev)}
            >
              {$t(`bodymap.severity.${sev}`)}
            </button>
          {/each}
        </div>
      </div>
      <p class="text-xs text-muted">{$t('bodymap.tapHint')}</p>
    {/if}

    {#snippet markerOverlay()}
      <svg
        viewBox="0 0 100 220"
        class="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {#each sideMarkers as m (m.id)}
          <g class={selectedId === m.id ? 'opacity-100' : 'opacity-90'}>
            <circle
              cx={m.x * 100}
              cy={m.y * 220}
              r={selectedId === m.id ? 6.5 : 5.5}
              fill={severityColor(m.severity)}
              stroke="rgb(var(--surface-1))"
              stroke-width="1.5"
            />
            <text
              x={m.x * 100}
              y={m.y * 220 + 2.5}
              text-anchor="middle"
              font-size="6"
              fill="rgb(var(--brand-fg))"
            >
              {indexOfMarker(m)}
            </text>
          </g>
        {/each}
      </svg>
    {/snippet}

    {#if readonly}
      <div class="relative mx-auto aspect-[100/220] max-w-[220px]">
        <Silhouette {side} />
        {@render markerOverlay()}
      </div>
    {:else}
      <div
        class="relative mx-auto aspect-[100/220] max-w-[220px] touch-none cursor-crosshair"
        role="button"
        aria-label={$t('bodymap.title')}
        tabindex="0"
        onclick={place}
        onkeydown={placeFromKey}
      >
        <Silhouette {side} />
        {@render markerOverlay()}
      </div>
    {/if}

    <!-- marker list (editable) -->
    {#if markers.length === 0}
      <p class="text-sm text-muted">{$t('bodymap.empty')}</p>
    {:else}
      <ul class="space-y-2">
        {#each markers as m (m.id)}
          <li class="rounded-xl border border-line bg-surface-1 p-3">
            <div class="flex items-start gap-2">
              <span
                class="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-fg"
              >
                {indexOfMarker(m)}
              </span>
              <div class="min-w-0 flex-1 space-y-2">
                {#if readonly}
                  <p class="text-sm">
                    <span class="font-medium text-fg">{$t(`bodymap.type.${m.type}`)}</span>
                    <Badge tone={severityTone(m.severity)}
                      >{$t(`bodymap.severity.${m.severity}`)}</Badge
                    >
                    <span class="text-subtle"> · {$t(`bodymap.side.${m.side}`)}</span>
                  </p>
                  {#if m.note}<p class="text-sm text-muted">{m.note}</p>{/if}
                {:else}
                  <div class="flex flex-wrap items-center gap-2">
                    <select
                      class="field-input min-h-0 w-auto py-1.5 text-sm"
                      aria-label={$t('bodymap.type.label')}
                      value={m.type}
                      onchange={(e) =>
                        updateMarker(m.id, { type: e.currentTarget.value as InjuryType })}
                    >
                      {#each INJURY_TYPES as ty (ty)}
                        <option value={ty}>{$t(`bodymap.type.${ty}`)}</option>
                      {/each}
                    </select>
                    <select
                      class="field-input min-h-0 w-auto py-1.5 text-sm"
                      aria-label={$t('bodymap.severity.label')}
                      value={m.severity}
                      onchange={(e) =>
                        updateMarker(m.id, { severity: e.currentTarget.value as InjurySeverity })}
                    >
                      {#each SEVERITIES as sev (sev)}
                        <option value={sev}>{$t(`bodymap.severity.${sev}`)}</option>
                      {/each}
                    </select>
                    <span class="text-xs text-subtle">{$t(`bodymap.side.${m.side}`)}</span>
                  </div>
                  <input
                    type="text"
                    class="field-input min-h-0 py-1.5 text-sm"
                    placeholder={$t('bodymap.notePlaceholder')}
                    aria-label={$t('bodymap.note')}
                    value={m.note ?? ''}
                    oninput={(e) => updateMarker(m.id, { note: e.currentTarget.value })}
                  />
                {/if}
              </div>
              {#if !readonly}
                <button
                  type="button"
                  class="btn-ghost min-h-0 flex-none rounded-lg p-2 text-danger"
                  aria-label={$t('common.delete')}
                  onclick={() => removeMarker(m.id)}
                >
                  <Icon name="trash" size={18} />
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- PHOTOS -->
  <section class="space-y-3">
    <h3 class="text-base font-semibold text-fg">{$t('bodymap.photos')}</h3>

    {#if photoError}
      <p class="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-fg" role="alert">
        {photoError}
      </p>
    {/if}

    {#if photos.length > 0}
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {#each photos as p (p.id)}
          <PhotoThumb
            data={p.data}
            mediaType={p.mediaType}
            onremove={readonly ? undefined : () => removePhoto(p.id)}
          />
        {/each}
      </div>
    {:else}
      <p class="text-sm text-muted">{$t('bodymap.noPhotos')}</p>
    {/if}

    {#if !readonly}
      <label
        class={`btn-secondary w-full cursor-pointer text-sm ${photoBusy ? 'pointer-events-none opacity-50' : ''}`}
      >
        <Icon name="plus" size={18} />
        {photoBusy ? $t('common.loading') : $t('bodymap.addPhoto')}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          class="sr-only"
          onchange={onPhotoPick}
        />
      </label>
      <p class="text-xs text-subtle">{$t('bodymap.photoHint')}</p>
    {/if}
  </section>
</div>
