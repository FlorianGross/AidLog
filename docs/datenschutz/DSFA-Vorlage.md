# Datenschutz-Folgenabschätzung (DSFA / DPIA) — Vorlage

> **Vorlage nach Art. 35 DSGVO.** Eine DSFA ist für Aidlog **erforderlich**:
> umfangreiche Verarbeitung **besonderer Kategorien** (Gesundheitsdaten, Art. 9) +
> ggf. vulnerable Betroffene. Diese Vorlage strukturiert die Bewertung; sie ist
> **vom Verantwortlichen auszufüllen und von einer fachkundigen Stelle abzuzeichnen**
> (siehe [`../PRE_PRODUCTION_CHECKLIST.md`](../PRE_PRODUCTION_CHECKLIST.md)).
> Felder `«…»` ausfüllen.

Verantwortlicher: «Organisation» · Beteiligte (DSB/IT/Recht): «…» · Stand: «Datum»

---

## 1. Notwendigkeit & Beschreibung der Verarbeitung

- **Gegenstand:** digitale Einsatz-/Patientendokumentation im Sanitäts-/Hilfsdienst.
- **Datenarten:** Gesundheitsdaten (Vitalwerte, Anamnese, Verletzungen/Body-Map,
  Fotos, EKG, Reanimation, Scores), Einwilligungen, Unterschriften, Stammdaten.
- **Umfang/Häufigkeit/Speicherdauer:** «…»
- **Verantwortlicher, Verarbeiter, Schnittstellen:** «Hosting», **Push-Dienst**
  (optional), Backup «…».
- **Warum DSFA nötig:** Art. 35 Abs. 3 lit. b (Art. 9 in großem Umfang) und
  Positivliste der zuständigen Aufsichtsbehörde «prüfen».

---

## 2. Bewertung von Notwendigkeit & Verhältnismäßigkeit

- **Rechtsgrundlage je Zweck** dokumentiert (siehe [`VVT-Vorlage.md`](./VVT-Vorlage.md)).
- **Datenminimierung:** konfigurierbares Schema; **EXIF/GPS-Strip**; **inhaltsfreies**
  Push; Auswertung **nur** über Aggregate.
- **Speicherbegrenzung:** Fristen + Krypto-Shredding (siehe [`TOM.md`](./TOM.md)).
- **Betroffenenrechte** umsetzbar (siehe [`Betroffenenrechte.md`](./Betroffenenrechte.md)).

---

## 3. Risiken für die Rechte und Freiheiten Betroffener

Bewertung je Risiko: **Eintrittswahrscheinlichkeit** × **Schwere** → Restrisiko.
Die Spalte „Maßnahme“ verweist auf den realen Funktionsumfang; „Restrisiko“ ist
**ehrlich** anzugeben (vgl. `../THREAT_MODEL.md`).

| #   | Risiko                                      | Maßnahme in Aidlog                                                         | Restrisiko (ehrlich)                                                                                            | Bewertung «n.V.» |
| --- | ------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------- |
| R1  | Server/Hoster liest Patientendaten          | E2E-Verschlüsselung; nur Chiffrat am Server                                | Metadaten sichtbar; **manipulierter Client-Code** durch feindlichen Host (CSP/SRI/reproduzierbare Builds nötig) | «…»              |
| R2  | Datenbank-/Blob-Diebstahl                   | nur Chiffrat + verpackte Schlüssel                                         | Offline-Passwort-Raten bei schwachem Org-Passwort (Argon2id mildert)                                            | «…»              |
| R3  | Client/Browser-Kompromittierung             | strikte CSP, keine Tracker, `crypto-core` als einzige Krypto-Fläche        | **prinzipiell nicht kryptografisch behebbar**; E2E auf dem Gerät gebrochen                                      | «…»              |
| R4  | Bösartiger/sorgloser Helfer                 | Versiegelung an Org-Key; Lese-Recht nur eigene Einträge bis Schichtschluss | Soft Revocation löscht **nicht** bereits Gesehenes                                                              | «…»              |
| R5  | Netz-Angreifer/MITM                         | TLS; Inhalte ohnehin E2E + signiert                                        | TLS-Metadaten; feindliche CA → R3                                                                               | «…»              |
| R6  | Verlust/Diebstahl Gerät                     | At-Rest-Wrapping; Auto-Lock/Wipe; Cache-Wipe bei Schichtschluss            | offenes/entsperrtes Gerät zeigt gecachte Klartexte                                                              | «…»              |
| R7  | Org-Passwort-Verlust                        | **Shamir T-von-N-Wiederherstellung** (falls eingerichtet) + Backup-Wrapper | ohne vorherige Einrichtung **dauerhafter Datenverlust**                                                         | «…»              |
| R8  | **Anteils-Kollusion/-Diebstahl (Recovery)** | T-von-N; < T enthüllt nichts; getrennte Verwahrung                         | **T Treuhänder = vollständiger Lesezugriff**                                                                    | «…»              |
| R9  | **Passkey auf verlorenem Gerät**            | Userverifikation Pflicht; nur Chiffrat lokal; PRF-Secret im Authenticator  | so stark wie die Geräte-Userverifikation; Auto-Wipe nötig                                                       | «…»              |
| R10 | **Abgefangener Geräte-Transfer**            | Code = Chiffrat; PIN out-of-band; Konto-Passwort zusätzlich                | drei Geheimnisse zugleich nötig; Code+PIN ohne Passwort nutzlos                                                 | «…»              |
| R11 | **Push-Metadaten / Push-Dienst**            | inhaltsfreie Payloads; VAPID nur Auth; Push optional                       | Push-Dienst lernt Erreichbarkeit + **Zeitpunkte** (Aktivitätsmuster)                                            | «…»              |
| R12 | **Re-Identifikation über Auswertung**       | client-seitig; **nur Aggregate**; Whitelist ohne Identifikatoren           | kleine Fallzahlen können re-identifizierend sein → Mindestfallzahl prüfen                                       | «…»              |
| R13 | Manipulation/Tilgung von Datensätzen        | Append-only + Signatur + Hashkette; Merkle-Anker                           | böswilliger Host kann **löschen** (als Kettenlücke erkennbar), nicht still ändern                               | «…»              |
| R14 | Re-Identifikation über Metadaten            | schlanke Metadaten; minimieren/kurz aufbewahren                            | in kleinen Orgs Verhaltensrückschluss möglich                                                                   | «…»              |

---

## 4. Geplante Abhilfemaßnahmen (vor Go-Live)

- [ ] Unabhängiges **Krypto-Review** (`crypto-core` inkl. Shamir/Passkey/Transfer).
- [ ] Unabhängige **DSGVO-/DSFA-Abnahme** (dieses Dokument).
- [ ] **Penetrationstest** (Auth, Mandantentrennung, Append-only, Blob-Tickets).
- [ ] **CSP + SRI + reproduzierbare Builds** (gegen R1/R3).
- [ ] **Recovery-Drill** und **Backup-Restore-Test** durchgeführt.
- [ ] **Push-Entscheidung** (an/aus) + AVV mit Push-Dienst (falls an).
- [ ] **Mindestfallzahl** für Auswertungs-Export festgelegt (gegen R12).
- [ ] Starke **Org-Passwort-Richtlinie** + **T ≥ 3** Treuhänder.
- [ ] **Incident-Response-Runbook** (Art. 33/34) vorhanden.

---

## 5. Ergebnis / Abnahme

- **Verbleibendes Gesamt-Restrisiko:** «gering/mittel/hoch»
- **Konsultation der Aufsichtsbehörde nach Art. 36 nötig?** «ja/nein — Begründung»
- **Freigabe:** «Name, Funktion, Datum, Unterschrift»
- **Wiedervorlage/Review-Turnus:** «z. B. jährlich oder bei wesentlicher Änderung»
