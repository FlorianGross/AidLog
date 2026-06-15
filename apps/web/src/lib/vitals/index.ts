/**
 * Vital-sign trends feature — public surface.
 *
 * The series rides along in the encrypted record payload under `VITALVERLAUF_KEY`
 * ('vitalverlauf'); see types.ts. No new upload path, no plaintext leaves device.
 */
export { default as VitalTrendEditor } from './VitalTrendEditor.svelte';
export { default as VitalTrendView } from './VitalTrendView.svelte';
export { default as VitalTrendChart } from './VitalTrendChart.svelte';
export { default as VitalIndicators } from './VitalIndicators.svelte';
export { default as ScorePanel } from './ScorePanel.svelte';
export * from './types';
export * from './indicators';
