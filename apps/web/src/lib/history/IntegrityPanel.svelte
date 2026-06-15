<!--
  IntegrityPanel.svelte — manipulation-evidence (Manipulationssicherheit) check.

  Runs crypto.verifyRecord across the deployment's record chain and renders a
  clear ✅/❌ per record (signature, hash-chain link, sequence) plus an overall
  verdict. Includes a plain-German explanation of what "manipulationssicher"
  means so any reader (not just developers) can trust the result.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import { Icon, Badge, Spinner } from '$lib/ui';
  import type { ProtocolRecord } from '@aidlog/contracts';
  import { checkIntegrity } from './history';
  import type { IntegrityReport } from './types';

  interface Props {
    records: ProtocolRecord[];
  }
  let { records }: Props = $props();

  let report = $state<IntegrityReport | null>(null);
  let running = $state(false);

  async function run(): Promise<void> {
    running = true;
    report = null;
    try {
      // Verifies signatures + hash links via crypto.verifyRecord.
      report = await checkIntegrity(records);
    } finally {
      running = false;
    }
  }
</script>

<div class="space-y-4">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h2 class="text-lg font-semibold text-fg">{$t('verlauf.integrityTitle')}</h2>
      <p class="mt-0.5 text-sm text-muted">{$t('verlauf.integritySubtitle')}</p>
    </div>
    <button
      type="button"
      class="btn-primary px-4 text-sm"
      disabled={running || records.length === 0}
      onclick={run}
    >
      <Icon name="shield-check" size={18} />
      {running ? $t('verlauf.checking') : $t('verlauf.runCheck')}
    </button>
  </div>

  {#if running}
    <p class="flex items-center gap-2 text-sm text-muted">
      <Spinner size={16} />
      {$t('verlauf.checking')}
    </p>
  {/if}

  {#if report}
    <!-- Overall verdict -->
    <div
      class={`flex items-center gap-3 rounded-xl px-4 py-3 ${
        report.ok ? 'bg-ok-soft text-ok-fg' : 'bg-danger-soft text-danger-fg'
      }`}
      aria-live="polite"
    >
      <span class="text-xl" aria-hidden="true">{report.ok ? '✅' : '❌'}</span>
      <span class="text-sm font-medium">
        {report.ok ? $t('verlauf.overallOk') : $t('verlauf.overallFail')}
      </span>
    </div>

    <!-- Per-record breakdown -->
    <ul class="space-y-2">
      {#each report.records as r (r.recordId)}
        <li class="tile flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class="text-base" aria-hidden="true">{r.ok ? '✅' : '❌'}</span>
          <span class="font-mono text-sm text-fg">#{r.seq}</span>
          <Badge tone={r.signatureValid ? 'ok' : 'danger'}>
            {r.signatureValid ? $t('verlauf.sigOk') : $t('verlauf.sigFail')}
          </Badge>
          <Badge tone={r.chainLinked ? 'ok' : 'danger'}>
            {r.chainLinked ? $t('verlauf.chainOk') : $t('verlauf.chainFail')}
          </Badge>
          {#if !r.seqContiguous}
            <Badge tone="warning">{$t('verlauf.seqGap')}</Badge>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Plain-German explanation of manipulation evidence. -->
  <div class="rounded-xl border border-line bg-surface-2 p-4">
    <p class="mb-1 flex items-center gap-2 text-sm font-medium text-fg">
      <Icon name="shield" size={16} />
      {$t('verlauf.explainTitle')}
    </p>
    <p class="text-sm leading-relaxed text-muted">{$t('verlauf.explain')}</p>
  </div>
</div>
