<!--
  ChipSelect.svelte — single-select TAP-CHIP group for fast tablet/phone entry.

  A larger-touch replacement for a native <select> with a SHORT option list: each
  option becomes a big tap target with a clear selected state (brand tokens). Used
  by SectionForm (short `select` fields) and QuickEntry (Versorgungsart, Verbleib,
  Altersgruppe, Geschlecht). Value semantics match a <select> exactly — the chosen
  `value` is whatever the option carries, and `allowNone` surfaces a reachable
  empty/"none" chip that stores `''` (same as a native select's empty option).

  Accessibility: rendered as a radiogroup; each chip is role="radio" with
  aria-checked, min-h-touch sizing, and a visible focus ring. Honours `disabled`
  (read-only) — chips render but cannot change the value.
-->
<script lang="ts">
  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    options: Option[];
    /** Current value (a stored option value, or '' for none). */
    value: string;
    /** Accessible group label (visually provided by the field <label>). */
    ariaLabelledby?: string;
    ariaLabel?: string;
    /** Show a reachable empty/"none" chip that stores ''. */
    allowNone?: boolean;
    /** Label for the empty chip when `allowNone`. */
    noneLabel?: string;
    disabled?: boolean;
    onchange: (value: string) => void;
  }

  let {
    options,
    value,
    ariaLabelledby,
    ariaLabel,
    allowNone = false,
    noneLabel = '—',
    disabled = false,
    onchange,
  }: Props = $props();

  function pick(v: string): void {
    if (disabled) return;
    onchange(v);
  }

  const chipBase =
    'min-h-touch inline-flex items-center justify-center rounded-xl border px-4 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60';
  const chipSelected = 'border-brand bg-brand text-brand-fg';
  const chipIdle = 'border-line-strong bg-surface-1 text-fg hover:bg-surface-2';
</script>

<div
  class="flex flex-wrap gap-2"
  role="radiogroup"
  aria-labelledby={ariaLabelledby}
  aria-label={ariaLabel}
>
  {#if allowNone}
    <button
      type="button"
      role="radio"
      aria-checked={value === ''}
      {disabled}
      class={`${chipBase} ${value === '' ? chipSelected : chipIdle}`}
      onclick={() => pick('')}
    >
      {noneLabel}
    </button>
  {/if}
  {#each options as opt (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === opt.value}
      {disabled}
      class={`${chipBase} ${value === opt.value ? chipSelected : chipIdle}`}
      onclick={() => pick(opt.value)}
    >
      {opt.label}
    </button>
  {/each}
</div>
