/**
 * protocols/marker.ts — the reserved payload key that GROUPS a deployment's
 * records into separate logical patient protocols.
 *
 * A `deployment` keeps ONE record hash-chain (one ChainHead, seq 0,1,2…). To let
 * a deployment (Dienst/Veranstaltung) contain MULTIPLE patient protocols we stamp
 * each record's ENCRYPTED payload with a stable `protocolId` (UUID) under this
 * key. All versions of one protocol — its initial record + later corrections
 * (which still use `supersedes`) — share the SAME protocolId, so a reader who can
 * decrypt the records can regroup them into protocols independent of the chain.
 *
 * Like {@link CATEGORY_ID_KEY} it is NOT a `DocField` (no schema renders it), so
 * it never appears as an editable form field. Records created before this change
 * simply omit it and are grouped under a legacy fallback (= the deploymentId).
 *
 * The server is unaffected: this is arbitrary JSON inside the already-encrypted,
 * stableStringified payload — the wire contract does not change.
 */
export const PROTOCOL_ID_KEY = '__protocolId__';

/** Generate a fresh protocolId (one per new full protocol / per quick contact). */
export function newProtocolId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Read the protocolId out of a decrypted payload, falling back to the supplied
 * legacy id (the deploymentId) for records written before the marker existed.
 * Resilient: any non-string value falls back too.
 */
export function protocolIdOf(
  payload: Record<string, unknown> | null | undefined,
  legacyFallback: string,
): string {
  const raw = payload?.[PROTOCOL_ID_KEY];
  return typeof raw === 'string' && raw.length > 0 ? raw : legacyFallback;
}
