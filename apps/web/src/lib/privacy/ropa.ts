/**
 * lib/privacy/ropa.ts — Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO).
 *
 * A generated, factual record-of-processing-activities document templated from
 * the org name (cached org PUBLIC info) plus the system's KNOWN processing
 * facts. It contains NO personal data — only the org name, the purpose, the
 * data categories handled, recipients, technical+organisational measures (TOMs)
 * and the legal bases. Pure + side-effect-free so it is unit-testable; the page
 * downloads/prints whatever this returns.
 */

export interface RopaInput {
  /** Org display name (from cached OrgPublicInfo). */
  orgName: string;
  /** Configured org-wide retention in days, or null when not yet configured. */
  retentionDays: number | null;
  generatedAt?: string;
}

export interface RopaSection {
  title: string;
  /** One or more paragraphs / bullet lines (already localised, German). */
  items: string[];
}

export interface RopaDocument {
  title: string;
  orgName: string;
  generatedAt: string;
  sections: RopaSection[];
}

/** Render the retention statement (German), or an "unset" note. */
function retentionText(retentionDays: number | null): string {
  if (retentionDays == null) {
    return 'Org-weite Löschfrist: noch nicht konfiguriert (siehe Datenschutz-Verwaltung).';
  }
  const years = Math.round((retentionDays / 365.25) * 10) / 10;
  return (
    `Org-weite Löschfrist: ${retentionDays} Tage (ca. ${years} Jahre), gemessen ab dem ` +
    `serverseitigen Eingangszeitpunkt (received_at). Die Löschung erfolgt durch ` +
    `Crypto-Shredding (Vernichtung der datensatzbezogenen Schlüssel).`
  );
}

/**
 * Build the Art. 30 document. Factual and editable-friendly; the strings are
 * German source-of-truth copy. NO personal data is included by construction.
 */
export function buildRopa(input: RopaInput): RopaDocument {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  return {
    title: 'Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)',
    orgName: input.orgName,
    generatedAt,
    sections: [
      {
        title: 'Verantwortlicher',
        items: [
          `Organisation: ${input.orgName}`,
          'Anschrift / Kontakt der/des Datenschutzbeauftragten: [bitte ergänzen]',
        ],
      },
      {
        title: 'Zweck der Verarbeitung',
        items: [
          'Sanitätsdienst- und Einsatzdokumentation (Patienten-/Einsatzprotokolle) ' +
            'im Rahmen der ehrenamtlichen bzw. dienstlichen Hilfeleistung.',
          'Qualitätssicherung und Nachweisführung über erbrachte Maßnahmen.',
        ],
      },
      {
        title: 'Kategorien betroffener Personen',
        items: [
          'Behandelte/betreute Personen (Patientinnen und Patienten).',
          'Einsatzkräfte und dokumentierende Helferinnen und Helfer.',
        ],
      },
      {
        title: 'Kategorien personenbezogener Daten',
        items: [
          'Stammdaten (z. B. Name, Geburtsdatum, Kontaktdaten), soweit erfasst.',
          'Gesundheitsdaten gemäß Art. 9 DSGVO (besondere Kategorien): Anamnese, ' +
            'Vitalparameter, Verletzungen, durchgeführte Maßnahmen, Verbleib.',
          'Einsatzbezogene Metadaten (Zeitpunkt, Einsatz, dokumentierende Person).',
        ],
      },
      {
        title: 'Rechtsgrundlagen',
        items: [
          'Art. 6 Abs. 1 lit. d DSGVO (Schutz lebenswichtiger Interessen) sowie ' +
            'Art. 9 Abs. 2 lit. c/h DSGVO für Gesundheitsdaten.',
          'Ggf. Art. 6 Abs. 1 lit. e DSGVO (Wahrnehmung einer Aufgabe im öffentlichen ' +
            'Interesse) in Verbindung mit landesrechtlichen Regelungen.',
        ],
      },
      {
        title: 'Empfänger',
        items: [
          'Übernehmende Rettungsdienste / Notärztinnen und Notärzte im Rahmen der Übergabe.',
          'Einsatzleitung und Administration der Organisation (rollenbasiert).',
          'Keine Übermittlung an Dritte zu Werbe- oder Analysezwecken. Keine ' +
            'Drittland-Übermittlung durch das System.',
        ],
      },
      {
        title: 'Technische und organisatorische Maßnahmen (TOM)',
        items: [
          'Ende-zu-Ende-Verschlüsselung aller Inhaltsdaten auf dem Endgerät.',
          'Zero-Knowledge-Server: der Server speichert ausschließlich Chiffrat und ' +
            'nicht-geheime Metadaten; er besitzt keine Entschlüsselungsschlüssel.',
          'Append-only-Speicherung mit Hash-Kette und Ed25519-Signaturen ' +
            '(manipulationssicher / revisionssicher).',
          'Löschkonzept per Crypto-Shredding: Löschung durch Vernichtung der ' +
            'datensatzbezogenen Schlüssel (sealed_keys); der Klartext wird dadurch ' +
            'dauerhaft unentschlüsselbar.',
          'Rollenbasierte Zugriffskontrolle (Helfer / Einsatzleitung / Administration).',
        ],
      },
      {
        title: 'Löschfristen',
        items: [
          retentionText(input.retentionDays),
          'In wiederherstellbaren Sicherungen (Backups) wirkt die Löschung erst nach ' +
            'Ablauf des Backup-Rotationszeitraums (siehe infra/BACKUP.md).',
        ],
      },
    ],
  };
}

/** Serialise the Art. 30 document as pretty JSON for download. */
export function ropaToJson(doc: RopaDocument): string {
  return JSON.stringify(doc, null, 2);
}
