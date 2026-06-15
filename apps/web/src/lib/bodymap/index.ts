/**
 * Photo + body-map feature — public surface.
 *
 * Markers ride along in the encrypted payload under `BODYMAP_KEY` ('bodymap').
 * Photos are encrypted under the record DEK and attached via the EXISTING blob/
 * outbox flow with label `photo:<id>` (see types.ts + finalize integration).
 */
export { default as BodyMapPhotoEditor } from './BodyMapPhotoEditor.svelte';
export { default as BodyMapView } from './BodyMapView.svelte';
export { default as PhotoGalleryView } from './PhotoGalleryView.svelte';
export { default as PhotoThumb } from './PhotoThumb.svelte';
export { default as Silhouette } from './Silhouette.svelte';
export * from './types';
export { downscaleImage } from './photo';
