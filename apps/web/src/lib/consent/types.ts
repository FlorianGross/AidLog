/**
 * consent/types.ts — the "Einwilligung & Aufklärung" data model.
 *
 * Digital consent & refusal documentation. The whole record rides along in the
 * SAME E2E-encrypted record payload as the rest of the documentation, under the
 * stable key `einwilligung: ConsentRecord`. It is a plain structured value, so it
 * inherits the record's encryption and the offline draft persistence — no new
 * upload path, no plaintext ever leaves the device.
 *
 * Each consent item captures: the type (Behandlung / Transportverweigerung /
 * Datenverarbeitung), the SHOWN Aufklärungstext (editable, pre-filled from a
 * vendor-neutral German default template per type), the key acknowledgement
 * checkboxes, free-text remarks, the signer role, and a client timestamp.
 *
 * The signature IMAGE itself is NOT stored in this structured value — like every
 * other signature it rides the existing blob mechanism (encrypted under the
 * record DEK), labelled `consent-sig:<id>`. The item only references the blob via
 * its stable `id` and a `signed` flag (see consentSigField / consentSigLabel).
 *
 * This formalises the legacy ad-hoc `sig_patient_verweigerung` boolean: old
 * payloads keep working untouched; the consent module is the proper home and may
 * cross-reference the legacy flag (see legacyRefusalPresent).
 */

/** The stable payload key under which the consent record is persisted. */
export const EINWILLIGUNG_KEY = 'einwilligung' as const;

/** The legacy ad-hoc refusal flag key, kept for backward compatibility. */
export const LEGACY_REFUSAL_KEY = 'sig_patient_verweigerung' as const;

/** Kinds of consent items. Stable string ids (also used as i18n suffix). */
export type ConsentType = 'behandlung' | 'transportverweigerung' | 'datenverarbeitung';

/** All supported consent types, in display order. */
export const CONSENT_TYPES: readonly ConsentType[] = [
  'behandlung',
  'transportverweigerung',
  'datenverarbeitung',
] as const;

/** Who put the pen to the pad. Stable string ids (also used as i18n suffix). */
export type SignerRole = 'patient' | 'vertreter' | 'zeuge';

/** All supported signer roles, in display order. */
export const SIGNER_ROLES: readonly SignerRole[] = ['patient', 'vertreter', 'zeuge'] as const;

/**
 * A single acknowledgement checkbox: a stable id (i18n suffix) and its state.
 * The shown label comes from i18n key `consent.ack.<id>`.
 */
export interface ConsentAck {
  id: string;
  checked: boolean;
}

/** One consent / refusal item. */
export interface ConsentItem {
  /** stable, non-secret, client-generated id (also keys the signature blob). */
  id: string;
  type: ConsentType;
  /** the SHOWN Aufklärungs-/Verweigerungstext — pre-filled, but editable. */
  aufklaerungstext: string;
  /** key acknowledgement checkboxes for this item. */
  acknowledgements: ConsentAck[];
  /** free-text remarks / individual notes. */
  remarks: string;
  /** who signed. */
  signerRole: SignerRole;
  /** optional printed name of the signer. */
  signerName: string;
  /**
   * whether a signature image has been captured for this item. The image bytes
   * live in the draft/blob flow under field `consent-sig:<id>` — not here.
   */
  signed: boolean;
  /** ISO-8601 client timestamp of when the item was last confirmed/signed. */
  signedAt: string | null;
  /** ISO-8601 client timestamp of when the item was created. */
  createdAt: string;
}

/** The full consent record stored under EINWILLIGUNG_KEY. */
export interface ConsentRecord {
  items: ConsentItem[];
}

/** Field-key prefix marking a captured consent signature image in the draft. */
export const CONSENT_SIG_FIELD_PREFIX = 'consent-sig:';

/** The draft signature field key for a consent item's signature image. */
export function consentSigField(itemId: string): string {
  return CONSENT_SIG_FIELD_PREFIX + itemId;
}

/** Extract the consent item id from a signature field key, or null. */
export function itemIdFromSigField(field: string | undefined): string | null {
  if (!field || !field.startsWith(CONSENT_SIG_FIELD_PREFIX)) return null;
  return field.slice(CONSENT_SIG_FIELD_PREFIX.length);
}

/**
 * The acknowledgement ids shown per consent type. The label for each is the
 * i18n key `consent.ack.<id>`.
 */
export const ACKS_BY_TYPE: Record<ConsentType, readonly string[]> = {
  behandlung: ['risikenAufgeklaert', 'einwilligungsfaehig', 'freiwillig'],
  transportverweigerung: [
    'untersucht',
    'risikenAblehnungVerstanden',
    'einwilligungsfaehig',
    'gegenAerztlichenRat',
  ],
  datenverarbeitung: ['datenschutzAufgeklaert', 'einwilligungsfaehig', 'widerrufBelehrt'],
};

/**
 * Vendor-neutral German default Aufklärungs-/Verweigerungstexte. Pre-filled into
 * the form but fully editable so an organisation can adapt the wording.
 */
export const DEFAULT_TEXTS: Record<ConsentType, string> = {
  behandlung:
    'Ich wurde über meinen gesundheitlichen Zustand, die vorgesehenen Maßnahmen ' +
    '(Untersuchung, Behandlung und ggf. Transport) sowie über deren Nutzen, ' +
    'mögliche Risiken und Alternativen in verständlicher Weise aufgeklärt. Ich ' +
    'hatte Gelegenheit, Fragen zu stellen, die beantwortet wurden. Ich willige ' +
    'freiwillig in die genannten Maßnahmen ein.',
  transportverweigerung:
    'Ich wurde durch das eingesetzte Personal untersucht und über meinen ' +
    'Gesundheitszustand sowie über die empfohlenen Maßnahmen aufgeklärt. Mir ' +
    'wurde ausführlich erläutert, dass eine Ablehnung der Behandlung und/oder ' +
    'des Transports zu einer Verschlechterung meines Zustands bis hin zu ' +
    'schweren, dauerhaften Gesundheitsschäden oder lebensbedrohlichen Folgen ' +
    'führen kann. Ich entscheide mich nach dieser Aufklärung aus freiem Willen ' +
    'und entgegen dem ausdrücklichen ärztlichen bzw. medizinischen Rat gegen die ' +
    'empfohlene Behandlung und/oder den Transport. Ich bestätige, dass ich ' +
    'einwilligungs- und entscheidungsfähig bin und die Tragweite meiner ' +
    'Entscheidung verstanden habe. Ich stelle das eingesetzte Personal und den ' +
    'Träger insoweit von der Haftung für die Folgen meiner Ablehnung frei.',
  datenverarbeitung:
    'Ich wurde darüber aufgeklärt, dass meine im Rahmen des Einsatzes erhobenen ' +
    'Gesundheits- und Personendaten zum Zweck der Dokumentation, Behandlung und ' +
    'Weitergabe an weiterbehandelnde Stellen verarbeitet werden. Die Daten werden ' +
    'Ende-zu-Ende-verschlüsselt verarbeitet und nur an berechtigte Stellen ' +
    'übermittelt. Ich wurde darüber belehrt, dass ich diese Einwilligung ' +
    'jederzeit mit Wirkung für die Zukunft widerrufen kann. Ich willige in die ' +
    'beschriebene Datenverarbeitung ein.',
};

/** A short, non-secret id for a consent item / its signature blob. */
export function newConsentId(): string {
  return globalThis.crypto.randomUUID();
}

/** Build a fresh consent item of the given type with defaults pre-filled. */
export function newConsentItem(type: ConsentType): ConsentItem {
  const now = new Date().toISOString();
  return {
    id: newConsentId(),
    type,
    aufklaerungstext: DEFAULT_TEXTS[type],
    acknowledgements: ACKS_BY_TYPE[type].map((id) => ({ id, checked: false })),
    remarks: '',
    signerRole: type === 'transportverweigerung' ? 'patient' : 'patient',
    signerName: '',
    signed: false,
    signedAt: null,
    createdAt: now,
  };
}

/** An empty consent record. */
export function emptyConsentRecord(): ConsentRecord {
  return { items: [] };
}

function isConsentType(v: unknown): v is ConsentType {
  return v === 'behandlung' || v === 'transportverweigerung' || v === 'datenverarbeitung';
}

function isSignerRole(v: unknown): v is SignerRole {
  return v === 'patient' || v === 'vertreter' || v === 'zeuge';
}

function normalizeAcks(value: unknown, type: ConsentType): ConsentAck[] {
  const arr = Array.isArray(value) ? value : [];
  const byId = new Map<string, boolean>();
  for (const a of arr) {
    if (a && typeof a === 'object' && typeof (a as ConsentAck).id === 'string') {
      byId.set((a as ConsentAck).id, !!(a as ConsentAck).checked);
    }
  }
  // Re-derive from the canonical list for this type so a stale payload never
  // loses or duplicates checkboxes; preserve any previously-checked state.
  return ACKS_BY_TYPE[type].map((id) => ({ id, checked: byId.get(id) ?? false }));
}

function normalizeItem(value: unknown): ConsentItem | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ConsentItem>;
  if (!isConsentType(v.type)) return null;
  const id = typeof v.id === 'string' && v.id ? v.id : newConsentId();
  return {
    id,
    type: v.type,
    aufklaerungstext:
      typeof v.aufklaerungstext === 'string' ? v.aufklaerungstext : DEFAULT_TEXTS[v.type],
    acknowledgements: normalizeAcks(v.acknowledgements, v.type),
    remarks: typeof v.remarks === 'string' ? v.remarks : '',
    signerRole: isSignerRole(v.signerRole) ? v.signerRole : 'patient',
    signerName: typeof v.signerName === 'string' ? v.signerName : '',
    signed: !!v.signed,
    signedAt: typeof v.signedAt === 'string' ? v.signedAt : null,
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : new Date().toISOString(),
  };
}

/**
 * Type guard / normaliser: narrow an unknown payload value to a ConsentRecord,
 * dropping anything unrecognised so the editor never throws on a stale payload.
 */
export function asConsentRecord(value: unknown): ConsentRecord {
  if (!value || typeof value !== 'object') return emptyConsentRecord();
  const v = value as Partial<ConsentRecord>;
  const items = Array.isArray(v.items)
    ? v.items.map(normalizeItem).filter((i): i is ConsentItem => i !== null)
    : [];
  return { items };
}

/** True when the record carries any consent item. */
export function hasConsentData(rec: ConsentRecord): boolean {
  return rec.items.length > 0;
}

/**
 * Backward-compat bridge: true if the LEGACY ad-hoc refusal flag is set in the
 * payload. The editor surfaces this so an old payload's refusal isn't lost; the
 * consent module is the proper home going forward.
 */
export function legacyRefusalPresent(values: Record<string, unknown>): boolean {
  return values[LEGACY_REFUSAL_KEY] === true;
}
