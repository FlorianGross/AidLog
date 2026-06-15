/**
 * Digital consent & refusal feature — public surface
 * ("Einwilligung & Aufklärung").
 *
 * The whole record rides along in the encrypted record payload under
 * `EINWILLIGUNG_KEY` ('einwilligung'); see types.ts. Signature IMAGES ride the
 * existing signature/blob flow under the draft field key `consent-sig:<id>`
 * (see consentSigField) — so the finalized blob label is
 * `sig-field:consent-sig:<id>`. No new upload path, no plaintext leaves the
 * device.
 */
export { default as ConsentPanel } from './ConsentPanel.svelte';
export { default as ConsentView } from './ConsentView.svelte';
export * from './types';
