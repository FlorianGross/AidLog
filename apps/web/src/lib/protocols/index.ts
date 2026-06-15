/**
 * Public surface of the protocols feature (Phase 1: data/draft model).
 *
 * A deployment can contain MULTIPLE logical patient protocols, grouped by the
 * reserved payload marker PROTOCOL_ID_KEY. Phase 2 consumes `listProtocols` to
 * render a protocol hub.
 */
export { PROTOCOL_ID_KEY, newProtocolId, protocolIdOf } from './marker';
export {
  listProtocols,
  labelFromPayload,
  PROTOCOL_FALLBACK_LABEL_KEY,
  type ProtocolSummary,
} from './list';
