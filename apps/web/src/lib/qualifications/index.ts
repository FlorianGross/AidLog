/**
 * qualifications/ — client helpers for the Sanitätsdienst qualification model.
 *
 * The canonical ordered list, ranks and labels live ONCE in `@aidlog/contracts`
 * (`QUALIFICATIONS`, `qualificationRank`, `qualificationLabel`). This module
 * re-exports them and adds:
 *   - a reactive store of the CURRENT user's OWN qualification (persisted in the
 *     local identity so the editor can gate sections offline), and
 *   - `meetsQualification`, the pure soft-gate predicate used by SectionForm.
 *
 * NON-secret, operational metadata only — never patient/health data.
 */
import { writable, type Readable } from 'svelte/store';
import {
  QUALIFICATIONS,
  qualificationRank,
  qualificationLabel,
  isQualification,
  type Qualification,
} from '@aidlog/contracts';

export {
  QUALIFICATIONS,
  qualificationRank,
  qualificationLabel,
  isQualification,
  type Qualification,
};

/**
 * The current user's own qualification (null = unset). Mirrored from the local
 * identity on login/account load so the documentation editor can gate sections
 * even before/without a network round-trip. Wiped to null on lock/logout.
 */
const ownQualificationStore = writable<Qualification | null>(null);
export const ownQualification: Readable<Qualification | null> = ownQualificationStore;

/** Set the cached own-qualification (call after account/identity load + on lock). */
export function setOwnQualification(q: Qualification | null): void {
  ownQualificationStore.set(q);
}

/**
 * SOFT-gate predicate: does `userQual` satisfy a section's `minQualification`?
 * - No requirement (`required` unset) → always true (backward compatible).
 * - Otherwise the user's rank must be >= the required rank; an unset user
 *   (`userQual` null) ranks 0 and is gated out of any requirement.
 */
export function meetsQualification(
  userQual: Qualification | null | undefined,
  required: Qualification | null | undefined,
): boolean {
  if (required == null) return true;
  return qualificationRank(userQual) >= qualificationRank(required);
}
