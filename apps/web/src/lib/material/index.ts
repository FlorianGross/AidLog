/**
 * Public surface of the Material-/Verbrauchsmaterial-Verwaltung (inventory)
 * feature: PURE low-stock / expiry derivations. OPERATIONAL logistics only —
 * never patient/health data.
 */
export {
  EXPIRING_SOON_DAYS,
  isLowStock,
  isExpired,
  isExpiringSoon,
  materialStatus,
  type MaterialStatus,
} from './helpers';
