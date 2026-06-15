<!--
  Bottom-sheet on mobile, centered dialog on desktop. Closes on Escape, on the
  backdrop button, or via the header close button. The backdrop is a real
  <button> so it's keyboard-accessible (no a11y warnings).

  A11y: on open the dialog receives focus and focus is restored to the
  previously-focused element on close; Escape closes; the dialog is labelled by
  its title (aria-labelledby) when one is given, else by aria-label.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import { t } from '$lib/i18n';
  import Icon from './Icon.svelte';

  interface Props {
    open: boolean;
    title?: string;
    onClose?: () => void;
    children: Snippet;
    footer?: Snippet;
  }
  let { open, title, onClose, children, footer }: Props = $props();

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose?.();
  }

  let dialogEl = $state<HTMLDivElement | null>(null);
  let lastFocused: HTMLElement | null = null;
  // Stable id so the heading can label the dialog (aria-labelledby).
  const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;

  // Move focus into the dialog on open; restore it to the trigger on close.
  $effect(() => {
    if (open) {
      lastFocused = (
        typeof document !== 'undefined' ? document.activeElement : null
      ) as HTMLElement | null;
      void tick().then(() => dialogEl?.focus());
    } else if (lastFocused) {
      lastFocused.focus?.();
      lastFocused = null;
    }
  });
</script>

<svelte:window {onkeydown} />

{#if open}
  <div class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
    <button
      type="button"
      class="absolute inset-0 bg-black/50"
      aria-label={$t('common.close')}
      onclick={() => onClose?.()}
    ></button>
    <div
      bind:this={dialogEl}
      tabindex="-1"
      class="relative w-full max-w-lg rounded-t-2xl border border-line bg-surface-1 p-5 shadow-2xl outline-none sm:rounded-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : $t('common.confirm')}
    >
      {#if title}
        <div class="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} class="text-lg font-medium text-fg">{title}</h2>
          <button
            type="button"
            class="btn-ghost min-h-touch min-w-touch rounded-lg p-2"
            onclick={() => onClose?.()}
            aria-label={$t('common.close')}><Icon name="x" size={20} /></button
          >
        </div>
      {/if}
      <div>{@render children()}</div>
      {#if footer}
        <div class="mt-5 flex justify-end gap-2">{@render footer()}</div>
      {/if}
    </div>
  </div>
{/if}
