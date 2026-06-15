# Technisch-organisatorische Maßnahmen (TOM) — Vorlage

> **Vorlage / Hinweis:** Dieses Dokument beschreibt die in Aidlog **technisch
> umgesetzten** Maßnahmen (Art. 32 DSGVO) und die **organisatorischen** Maßnahmen,
> die der Verantwortliche ergänzen **muss**. Felder in `«…»` sind vom
> Verantwortlichen auszufüllen. Aidlog ist ein Bau­kasten — diese TOM sind erst
> nach unabhängiger Prüfung und Ausfüllen produktionsreif (siehe
> [`../PRE_PRODUCTION_CHECKLIST.md`](../PRE_PRODUCTION_CHECKLIST.md)).

Verantwortlicher: «Organisation» · Stand: «Datum» · Version: «x.y»

---

## 1. Vertraulichkeit (Art. 32 Abs. 1 lit. b)

### 1.1 Zutritts-/Zugangs-/Zugriffskontrolle

- **Ende-zu-Ende-Verschlüsselung:** Ver-/Entschlüsselung ausschließlich am Client
  (`packages/crypto-core`). Der Server speichert **nur Chiffrat** + Routing-Metadaten
  und kann Inhalte **nicht** entschlüsseln (Zero-Knowledge).
- **Pinned-Primitive:** XChaCha20-Poly1305 (Inhalte/Blobs), X25519-Sealed-Box
  (DEK-Versiegelung), Argon2id (Passwort→Schlüssel), Ed25519 (Signaturen),
  BLAKE2b-256 (Hash/Kette).
- **Schlüsselhierarchie:** Org-Schlüssel (X25519+Ed25519), durch **Org-Passwort**
  (Argon2id) geschützt; Helfer-Schlüssel durch Helfer-Passwort. Passwörter
  erreichen den Server **nie** (Challenge-Response-Auth).
- **Rollen (admin/lead/helper):** Need-to-know; Org-Lese-Recht nur mit Org-Passwort.
- **Geräte-Sicherheit:** Auto-Lock bei Inaktivität (konfigurierbar, Standard 5 min),
  Lock-on-Background, **Geräte-Wipe/Panik-Offboarding** (löscht IndexedDB, App-
  `localStorage`, Caches, Service-Worker; Theme-Präferenz ausgenommen).
- **WebAuthn/Passkey-Entsperrung (optional):** PRF-Secret bleibt im Authenticator,
  nur Chiffrat (`prfWrappedSecret`) auf dem Gerät; Benutzerverifikation Pflicht.
- **Organisatorisch (vom Verantwortlichen):** Geräte-Vollverschlüsselung (FDE),
  Bildschirmsperre, MDM/Remote-Wipe «Tool», starke Org-Passwort-Richtlinie
  «Vorgabe», sichere Verwahrung der Wiederherstellungs-Anteile (s. §4).

### 1.2 Trennungskontrolle

- **Mandantentrennung** per `orgId`-Scoping serverseitig (Code-erzwungen — im
  Audit zu prüfen). Keine organisationsübergreifende Lesbarkeit.

### 1.3 Datenträger-/Übertragungskontrolle

- **TLS überall** (Caddy, automatische Zertifikate; HSTS/moderne Ciphers vom
  Betreiber zu härten). Inhalte sind zusätzlich bereits E2E-Chiffrat.
- **Blobs** (Fotos/Scans/Unterschriften) als secretstream-Chiffrat in MinIO/S3.
- **Foto-Datenminimierung:** jedes Bild wird vor der Verschlüsselung über ein
  Canvas neu kodiert → **alle EXIF-/GPS-Metadaten werden entfernt**.

---

## 2. Integrität (Art. 32 Abs. 1 lit. b)

- **Append-only + Signatur + Hashkette:** Datensätze sind unveränderlich, Ed25519-
  signiert und BLAKE2b-hashverkettet (`prevHash`/`recordHash`/`seq`). UPDATE/DELETE
  bestehender Datensätze werden serverseitig (DB-Rechte/Trigger) **abgelehnt**.
- **Korrekturen** nur per Append mit `supersedes`; vollständige **Änderungs-/
  Integritätshistorie** im Client einsehbar (Diff + Integritätspanel).
- **Merkle-Archiv-Anker:** periodische Anker (Hash) ermöglichen späteren
  Manipulationsnachweis ohne Inhaltsoffenlegung.
- **Co-Signatur:** zusätzliche Ed25519-Signatur(en) eines Mitzeichners über den
  `recordHash`.

---

## 3. Verfügbarkeit & Belastbarkeit (Art. 32 Abs. 1 lit. c)

- **Offline-first PWA:** Doku funktioniert ohne Netz; Outbox-Sync bei Reconnect.
- **Backups (vom Verantwortlichen):** Postgres + MinIO regelmäßig sichern und
  **Restore getestet**. Backups enthalten nur Chiffrat, **aber Metadaten** — daher
  schützen und fristgerecht aufbewahren. Backup-Plan: «Frequenz/Aufbewahrung/Ort».
- **Schlüssel-Wiederherstellung (Shamir T-von-N):** sichert Verfügbarkeit der
  _entschlüsselbaren_ Daten gegen Org-Passwort-Verlust — **nur wenn vorab
  eingerichtet**. Restore-/Recovery-Drill dokumentieren.
- **Keine eingebaute HA** — Hochverfügbarkeit ist Betreiber-Verantwortung.

---

## 4. Schlüssel- & Wiederherstellungs-Verwaltung

- **Org-Passwort-Verlust = Datenverlust**, **außer** Shamir-Wiederherstellung
  wurde eingerichtet. Empfehlung: **T ≥ 3** Treuhänder.
- **Anteile (Shares):** rein menschlich gehalten (gedruckt/exportiert), **nie** am
  Server. Server speichert nur Metadaten (T/N, Treuhänder-**Labels**, `orgKeyCheck`).
- **Verwahrung der Anteile (organisatorisch):** getrennte Aufbewahrung
  (versiegelte Umschläge/Tresore/verschiedene Personen) «Verfahren».
- **Offboarding:** bei Treuhänder-/Personalwechsel **Anteile neu ausgeben** und
  Org-Passwort rotieren; Nutzerkonto sperren (`disabled`), Passkeys entfernen.
- **Audit-Log:** Einladung/Redeem/Sperren/Reaktivieren/Rollenwechsel/Recovery-
  Konfiguration/Schichtschluss werden protokolliert (WER/WAS/WANN; **keine**
  Patientendaten, keine Codes).

---

## 5. Auftragsverarbeiter & externe Endpunkte

| Verarbeiter / Endpunkt                                       | Zweck                                           | Daten                                                     | AVV nötig? |
| ------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------- | ---------- |
| Hosting «Anbieter»                                           | Betrieb Server/Storage                          | Chiffrat + Metadaten                                      | **Ja**     |
| **Push-Dienst** «Mozilla/Google/Apple» (nur wenn Push aktiv) | Zustellung **inhaltsfreier** Benachrichtigungen | Push-Endpunkt + Browser-Schlüssel + Zeitpunkt (Metadaten) | **Ja**     |
| Backup/Storage «Dienstleister»                               | Sicherung                                       | Chiffrat + Metadaten                                      | **Ja**     |

**Push-Hinweis:** Payloads tragen **nur** generischen Text + In-App-Route
(`apps/api/src/push.ts`). **Niemals** Patienten-/Datensatzinhalte. Push ist
**optional** (deaktiviert, solange keine VAPID-Schlüssel gesetzt sind).

---

## 6. Datenminimierung & Auswertung

- **Konfigurierbares Schema:** nur tatsächlich benötigte Felder werden erhoben.
- **Auswertung:** wird **client-seitig** vom Org-Schlüssel-Inhaber berechnet;
  exportiert werden **ausschließlich anonymisierte Aggregate** (Whitelist
  kategorialer/numerischer Felder in `analytics/types.ts`). Freitexte und direkte
  Identifikatoren (Name, Ort, Übergabe, Notizen, Unterschriften, Fotos) werden
  **nie** aggregiert.

---

## 7. Logging & Pseudonymisierung

- **Pino-Redaction** (`REDACT_PATHS`) verhindert das Loggen von PII/Secrets;
  privacy-lint erzwingt, dass `req.body`/sensible Bezeichner nicht geloggt werden.
- **Keine Dritt-Tracker/Analytics** im Web-Client (privacy-lint Gate).
- **Metadaten minimieren/kurz aufbewahren** (Zeitstempel, Größen, Urheber-KeyIds,
  IP/SNI). Aufbewahrung Server-Logs: «Frist».

---

## 8. Löschung / Speicherbegrenzung

- **Aufbewahrungsfrist** Patientendokumentation: «z. B. nach Landesrecht /
  Berufsrecht» — vom Verantwortlichen festzulegen.
- **Soft Revocation** am Schichtende entfernt den Helfer-Wrapper (kein
  rückwirkendes Vergessen bereits Gesehener Inhalte).
- **Krypto-Shredding:** Vernichtung des Org-Schlüssels (und aller Anteile) macht
  alle Daten unentschlüsselbar = wirksame Löschung. Selektive Einzel-Löschung
  siehe [`Betroffenenrechte.md`](./Betroffenenrechte.md).

---

## 9. Vorfälle / Datenpannen

- **Runbook** (vom Verantwortlichen): Erkennung → Eindämmung → Bewertung →
  Meldung (Art. 33, 72 h) → ggf. Benachrichtigung (Art. 34) → Nachbereitung.
- **Sicherheitskontakt:** «security@…» (siehe `SECURITY.md`, Platzhalter ersetzen).

---

## 10. Wirksamkeit / Überprüfung (Art. 32 Abs. 1 lit. d)

- CI-Sicherheits-/Compliance-Gates (siehe `../CI_AND_COMPLIANCE.md`).
- **Unabhängiges Krypto-/DSGVO-Review** vor Produktion (Pflicht).
- Regelmäßige Wiederholung: Pen-Test, Recovery-Drill, Restore-Test, TOM-Review:
  «Turnus».
