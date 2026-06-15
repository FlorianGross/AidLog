# Datenschutz-Compliance (DSGVO) — Überblick

> **Status / Haftungsausschluss:** Dieses Dokument beschreibt die
> **datenschutzrechtliche Ausrichtung** von Aidlog als Bau­kasten. Es ist **keine**
> Bestätigung, dass eine konkrete Installation rechtskonform betrieben wird, und
> **ersetzt keine** Datenschutzfolgenabschätzung (DSFA) durch den Verantwortlichen.
> Aidlog verarbeitet **besondere Kategorien personenbezogener Daten**
> (Gesundheitsdaten, Art. 9 DSGVO). Vor dem Einsatz mit echten Patientendaten ist
> eine **unabhängige Prüfung** von Kryptografie und Datenschutz zwingend
> erforderlich (siehe [`PRE_PRODUCTION_CHECKLIST.md`](./PRE_PRODUCTION_CHECKLIST.md)).

Dieses Dokument fasst zusammen, wie die in Aidlog umgesetzten Funktionen auf die
DSGVO-Anforderungen einzahlen, und verweist auf die ausführlichen Vorlagen unter
[`docs/datenschutz/`](./datenschutz/). Die englischsprachige Architektur- und
Bedrohungsanalyse liegt in [`ARCHITECTURE.md`](./ARCHITECTURE.md) bzw.
[`THREAT_MODEL.md`](./THREAT_MODEL.md).

---

## 1. Rollen nach DSGVO

| Rolle                               | Wer                                                                                                                                | Aufgabe                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Verantwortlicher** (Art. 4 Nr. 7) | die betreibende Hilfsorganisation                                                                                                  | bestimmt Zwecke & Mittel; richtet Aidlog ein, hält das Org-Passwort/die Wiederherstellungs-Anteile |
| **Auftragsverarbeiter** (Art. 28)   | ggf. Hosting-Anbieter; **Push-Dienst** (z. B. Mozilla/Google/Apple Push, falls Push aktiviert); ggf. Backup-/Storage-Dienstleister | verarbeitet (verschlüsselte) Daten bzw. Metadaten im Auftrag                                       |
| **Betroffene Person**               | Patient:in / dokumentierte Person                                                                                                  | Subjekt der Gesundheitsdaten                                                                       |

**Zero-Knowledge-Besonderheit:** Der Server (und damit der Hosting-Verarbeiter)
sieht **ausschließlich Chiffrat** plus Routing-Metadaten. Das ist eine **technische
Maßnahme** (Art. 32), ersetzt aber **nicht** den Auftragsverarbeitungsvertrag, weil
Metadaten (siehe `THREAT_MODEL.md` §4) personenbezogen sein können.

---

## 2. Rechtsgrundlagen (Art. 6 & 9)

Gesundheitsdaten sind grundsätzlich verboten zu verarbeiten (Art. 9 Abs. 1),
zulässig u. a. über:

- **Art. 9 Abs. 2 lit. c** — Schutz lebenswichtiger Interessen (akute Versorgung,
  Patient nicht einwilligungsfähig);
- **Art. 9 Abs. 2 lit. h** — Gesundheitsvorsorge/Behandlung;
- **Art. 9 Abs. 2 lit. a** + **Art. 6 Abs. 1 lit. a** — **ausdrückliche
  Einwilligung**, die Aidlog mit dem **digitalen Einwilligungs-/Verweigerungs-Modul**
  (`einwilligung`, Behandlung / Transportverweigerung / Datenverarbeitung)
  dokumentiert.

Die konkrete Rechtsgrundlage je Verarbeitung trägt der Verantwortliche im VVT ein
(siehe [`datenschutz/VVT-Vorlage.md`](./datenschutz/VVT-Vorlage.md)).

---

## 3. Datenschutzgrundsätze (Art. 5) — Umsetzung in Aidlog

| Grundsatz                      | Umsetzung                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rechtmäßigkeit/Transparenz** | Einwilligungsmodul mit editierbarem Aufklärungstext; Selbstauskunft in der Patientensprache (RTL für Arabisch).                                                |
| **Zweckbindung**               | Dokumentation des Einsatzkontakts; **Auswertung** nur über anonymisierte Aggregate (Whitelist im Code).                                                        |
| **Datenminimierung**           | Schlanke Routing-Metadaten; **Push inhaltsfrei**; EXIF-/GPS-Strip aller Fotos durch Canvas-Reencode; konfigurierbares Protokoll-Schema (nur benötigte Felder). |
| **Richtigkeit**                | Korrekturen nur per Append (`supersedes`); vollständige **Änderungs-/Integritätshistorie**.                                                                    |
| **Speicherbegrenzung**         | Aufbewahrungsfristen/Löschkonzept (TOM §Löschung); **Krypto-Shredding** durch Vernichtung des Org-Schlüssels.                                                  |
| **Integrität/Vertraulichkeit** | E2E-Verschlüsselung (XChaCha20, X25519-Seal, Argon2id); Ed25519-Signatur + BLAKE2b-Hashkette; TLS; Auto-Lock/Auto-Wipe.                                        |
| **Rechenschaftspflicht**       | **Administratives Audit-Log** (Einladen/Sperren/Rollenwechsel/Recovery/Schichtschluss); CI-Compliance-Gates.                                                   |

---

## 4. Technische Maßnahmen je Funktion (Stand: aktueller Funktionsumfang)

Diese Tabelle ist die Kurzreferenz; Details in
[`datenschutz/TOM.md`](./datenschutz/TOM.md).

| Funktion                                                                        | Datenschutz-relevante Eigenschaft                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Pro-Datensatz-Envelope (E2E)**                                                | DEK je Datensatz; an Org-Public-Key versiegelt; Helfer schreiben ohne Org-Geheimnis.                    |
| **Rollen (admin/lead/helper)**                                                  | Need-to-know; Org-Lese-Recht nur mit Org-Passwort.                                                      |
| **Admin-Einladungs-Onboarding**                                                 | Konten nur per Einladung; Einmal-Code, nie im Klartext gespeichert.                                     |
| **Gegenzeichnung (Co-Signatur)**                                                | Mitzeichner liest, was er signiert: DEK zusätzlich an den Mitzeichner versiegelt.                       |
| **Shamir-Wiederherstellung**                                                    | T-von-N-Anteile bei menschlichen Treuhändern; **nur Metadaten** (T/N, Labels, `orgKeyCheck`) am Server. |
| **Offboarding + Audit-Log**                                                     | Sperren/Reaktivieren/Rollenwechsel protokolliert; keine Patientendaten im Log.                          |
| **WebAuthn/Passkey-Entsperrung**                                                | PRF-Secret bleibt im Authenticator; nur Chiffrat auf dem Gerät.                                         |
| **Multi-Device-Transfer (QR/PIN)**                                              | Code ist Chiffrat; PIN out-of-band + Konto-Passwort weiterhin nötig.                                    |
| **Web Push (inhaltsfrei)**                                                      | Nur generischer Text + Route; VAPID authentifiziert nur; Push-Dienst = Auftragsverarbeiter.             |
| **Client-seitige Auswertung**                                                   | Org-weite Entschlüsselung nur im Admin-Browser; Export nur Aggregate (keine Freitexte/Identifikatoren). |
| **Digitale Einwilligung/Verweigerung**                                          | Aufklärungstext + Quittierungen + Unterschrift, E2E im Datensatz.                                       |
| **In-App-Schema-Editor**                                                        | Feld**definitionen** sind Org-Konfiguration (kein Patientendatum).                                      |
| **Sicherheits-Härtung**                                                         | Auto-Lock (Inaktivität), Lock-on-Background, Geräte-Wipe, EXIF-Strip.                                   |
| **PDF-Export, Vitaltrends, Body-Map/Foto, Scores, Reanimations-Assistent, EKG** | Alle Inhalte reiten im E2E-verschlüsselten Datensatz mit; kein neuer Klartext-Pfad.                     |
| **Änderungshistorie/Integrität, Merkle-Archiv-Anker**                           | Manipulationsnachweis; der Anker ist ein Hash, kein Inhalt.                                             |

---

## 5. Betroffenenrechte (Art. 12–22)

Umsetzung und Grenzen siehe
[`datenschutz/Betroffenenrechte.md`](./datenschutz/Betroffenenrechte.md):
Auskunft (inkl. **Selbstauskunft**-Kiosk), Berichtigung (Append/`supersedes`),
Löschung (inkl. **Krypto-Shredding**), Einschränkung, Datenübertragbarkeit
(PDF-/Daten-Export), Widerspruch. **Ehrliche Grenze:** Eine selektive Löschung
_eines_ Datensatzes auf rein kryptografischem Weg ist nicht möglich, solange der
Org-Schlüssel existiert; siehe das Dokument.

---

## 6. Meldepflichten bei Datenpannen (Art. 33/34)

- **Art. 33** — Meldung an die Aufsichtsbehörde **binnen 72 h**.
- **Art. 34** — Benachrichtigung Betroffener bei hohem Risiko; ein Diebstahl
  reiner Chiffrate (ohne Passwort/Anteile) **kann** das Risiko mindern, hebt die
  Pflicht aber nicht automatisch auf (Metadaten!).
- Der Verantwortliche hält einen **Incident-Response-Runbook** vor (Vorlage-Punkte
  in TOM §Vorfälle).

---

## 7. CI als Datenschutz-Gate

Die technischen Invarianten (kein Krypto-Primitiv außerhalb `crypto-core`, keine
PII/Secrets in Logs, keine Dritt-Tracker, Pino-Redaction) werden **maschinell**
erzwungen; Details in [`CI_AND_COMPLIANCE.md`](./CI_AND_COMPLIANCE.md).

---

## 8. Verweise

- DSFA-Vorlage: [`datenschutz/DSFA-Vorlage.md`](./datenschutz/DSFA-Vorlage.md)
- Verzeichnis von Verarbeitungstätigkeiten: [`datenschutz/VVT-Vorlage.md`](./datenschutz/VVT-Vorlage.md)
- Technisch-organisatorische Maßnahmen: [`datenschutz/TOM.md`](./datenschutz/TOM.md)
- Betroffenenrechte: [`datenschutz/Betroffenenrechte.md`](./datenschutz/Betroffenenrechte.md)
- Go-Live-Checkliste: [`PRE_PRODUCTION_CHECKLIST.md`](./PRE_PRODUCTION_CHECKLIST.md)
- Handbuch (Nutzer & Admin): [`HANDBUCH.md`](./HANDBUCH.md)
