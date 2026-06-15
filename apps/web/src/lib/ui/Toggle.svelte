<!--
  Toggle.svelte — switch-style boolean control with a large tap target.

  A clearer, faster replacement for a bare checkbox: the whole row is tappable and
  the on/off state reads at a glance (brand-filled track when on). Stores a plain
  boolean via `onchange`. Honours `disabled` (read-only). Rendered as a real
  <button role="switch"> with aria-checked so it is keyboard- and SR-accessible.
-->
<script lang="ts">
  interface Props {
    checked: boolean;
    label: string;
    /** Marks the associated field as required (renders a "*"). */
    required?: boolean;
    id?: string;
    disabled?: boolean;
    onchange: (checked: boolean) => void;
  }

  let { checked, label, required = false, id, disabled = false, onchange }: Props = $props();

  function toggle(): void {
    if (disabled) return;
    onchange(!checked);
  }
</script>

<button
  {id}
  type="button"
  role="switch"
  aria-checked={checked}
  {disabled}
  onclick={toggle}
  class="flex min-h-touch w-full items-center justify-between gap-3 rounded-xl border border-line-strong bg-surface-1 px-3 text-left text-base text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
>
  <span>
    {label}{#if required}<span class="text-danger" aria-hidden="true"> *</span>{/if}
  </span>
  <span
    class={`relative inline-flex h-7 w-12 flex-none items-center rounded-full transition-colors ${
      checked ? 'bg-brand' : 'bg-surface-3'
    }`}
    aria-hidden="true"
  >
    <span
      class={`inline-block h-5 w-5 transform rounded-full bg-surface shadow transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    ></span>
  </span>
</button>
