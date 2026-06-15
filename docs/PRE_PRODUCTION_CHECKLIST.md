# Pre-Production-Checkliste — Go-Live-Gate vor echten Patientendaten

> **Zweck:** Diese Checkliste ist das **verbindliche Tor**, das **vor** der ersten
> Verarbeitung **echter Patientendaten** vollständig abgearbeitet und abgezeichnet
> sein muss. Aidlog ist ein professionell gebautes **Fundament, kein zertifiziertes
> Produkt**. Solange ein Punkt offen ist, gilt: **keine echten Patientendaten.**
>
> Legende: `[ ]` offen · `[x]` erledigt · Verantwortliche:r + Datum je Zeile eintragen.

Organisation: «…» · Freigabe-Verantwortliche:r: «…» · Ziel-Go-Live: «…»

---

## 0. Vorbedingungen (Blocker)

- [ ] **CI ist grün** auf dem Produktions-Commit (alle Pflicht-Gates: compliance,
      build-test (node 20/22), codeql, gitleaks, dependency-audit, trivy,
      license-check, semgrep — siehe `CI_AND_COMPLIANCE.md`).
- [ ] `corepack pnpm install --frozen-lockfile` löst sauber auf.
- [ ] `pnpm -r typecheck && pnpm -r build && pnpm -r test` fehlerfrei.
- [ ] **E2E-Smoke-Tests** grün (`pnpm --filter @aidlog/web test:e2e`).
- [ ] **Versions-/Commit-Stand** des freigegebenen Builds dokumentiert.

---

## 1. Unabhängiges Sicherheits-Review (extern)

- [ ] **Krypto-Review** von `packages/crypto-core` durch eine unabhängige,
      fachkundige Stelle: Primitiv-Nutzung, **Nonce-Handhabung**, **Argon2id-
      Parameter**, Sealed-Box/secretstream, **Shamir split/combine**,
      **WebAuthn/PRF-Wrapping**, **Transfer-PIN-Ableitung**, Schlüssel-Zeroing.
- [ ] **Code-/Architektur-Review** der Zero-Knowledge-Invarianten (kein Klartext/
      DEK/Passwort/Secret zum Server; `apps/api` bleibt blind).
- [ ] **Befunde behoben** oder als Risiko akzeptiert + dokumentiert (mit Sign-off).

## 2. Penetrationstest

- [ ] Externer Pen-Test gegen eine **produktionsnahe** Installation:
      Auth (Challenge/Response), **Mandantentrennung (`orgId`)**, **Append-only-
      Trigger**, **Blob-Ticket-Scoping**, Rate-Limits, Rollen-Durchsetzung.
- [ ] Kritische/High-Findings behoben; Re-Test bestanden.

## 3. Unabhängige DSGVO-/DSFA-Abnahme

- [ ] **DSFA** ausgefüllt und **abgezeichnet** (`datenschutz/DSFA-Vorlage.md`).
- [ ] **VVT** vollständig (`datenschutz/VVT-Vorlage.md`).
- [ ] **TOM** ausgefüllt und freigegeben (`datenschutz/TOM.md`).
- [ ] **Rechtsgrundlagen** je Verarbeitung festgelegt (Art. 6/9).
- [ ] Ggf. **Konsultation der Aufsichtsbehörde** (Art. 36) geklärt.
- [ ] **Betroffenenrechte-Verfahren** + Fristen etabliert (`datenschutz/Betroffenenrechte.md`).
- [ ] **AVV** mit Hosting **und** — falls Push aktiv — mit dem **Push-Dienst**
      abgeschlossen; Drittland-Garantien geprüft.

## 4. Krypto-/Schlüssel-Konfiguration

- [ ] **Argon2id-Parameter** (`KdfParams.opsLimit/memLimit`) auf die Zielhardware
      **gebenchmarkt** und gesetzt.
- [ ] **Starke Org-Passwort-Richtlinie** definiert und kommuniziert.
- [ ] **Shamir-Recovery eingerichtet** (empfohlen **T ≥ 3**), Anteile an Treuhänder
      verteilt, Verwahrung dokumentiert.
- [ ] **Recovery-Drill durchgeführt:** aus T Anteilen rekonstruiert, gegen
      `orgKeyCheck` verifiziert, unter **neuem** Org-Passwort neu verpackt — in
      einer Test-Org, mit Protokoll.
- [ ] **Offboarding-Verfahren** für Treuhänder/Nutzer (Anteile neu ausgeben +
      Passwort rotieren; Konto `disabled`; Passkeys entfernen).

## 5. Geheimnisse, TLS & Server-Konfiguration

- [ ] `SESSION_SECRET` (≥ 16, stark, zufällig), `POSTGRES_*`, `MINIO_*`,
      `AIDLOG_APP_DB_PASSWORD` **frisch generiert** und sicher verwahrt (nicht im Repo).
- [ ] **VAPID** entweder bewusst **unkonfiguriert** (Push aus) **oder** alle drei
      Werte (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`) gesetzt; bei
      „an“: Payload-Inhaltsfreiheit verifiziert.
- [ ] **TLS gehärtet** (HSTS, moderne Ciphers), Zertifikats-Monitoring; Caddy-
      Sicherheits-Header aktiv; **CSP** des SvelteKit-Builds geprüft.
- [ ] **CSP + Subresource Integrity + reproduzierbarer Build**; ausgelieferter
      Client-Bundle entspricht dem geprüften Build (gegen feindlichen Host).
- [ ] `CORS_ORIGIN` auf die echte Origin gesetzt (nicht `*`).
- [ ] **Rate-Limits** (`RATE_LIMIT_*`) sinnvoll konfiguriert.
- [ ] **Logging:** `REDACT_PATHS` aktiv; `LOG_LEVEL` produktionsgerecht; keine
      PII/Secrets in Logs (privacy-lint bestätigt); Metadaten-Aufbewahrung minimiert.

## 6. Backup & Wiederherstellung

- [ ] **Backup** für Postgres **und** MinIO eingerichtet (Frequenz/Aufbewahrung/Ort).
- [ ] **Restore end-to-end getestet** (nicht nur Backup, sondern Wiederherstellung).
- [ ] Backups geschützt (enthalten Chiffrat **und Metadaten**); Aufbewahrungsfristen
      definiert.
- [ ] **Migrationen** (`migrate`-Service) laufen reproduzierbar.

## 7. Geräte- & Betriebs-Policy

- [ ] **Feldgeräte:** FDE, Bildschirmsperre, MDM/Remote-Wipe; kurze Schichtfenster.
- [ ] **Auto-Lock/Auto-Wipe** aktiviert und sinnvoll konfiguriert (`$lib/security`).
- [ ] **Passkey-/Transfer-Policy** entschieden und geschult.
- [ ] **Schlüssel-Rotations-/Sperr-Plan** für kompromittierte Helfer-Schlüssel.

## 8. Übersetzungen & Inhalte

- [ ] **Professionelle Übersetzung/Review** aller Patienten-Texte (Selbstauskunft,
      Verständigungshilfe) für **en/tr/ar/ru/uk/fr** — die maschinellen Entwürfe
      sind **nicht** produktionsreif. **RTL (Arabisch)** im echten Layout geprüft.
- [ ] **Aufklärungs-/Einwilligungstexte** rechtlich geprüft.
- [ ] **Branding** (`apps/web/src/lib/branding.ts`) + **Sicherheitskontakt**
      (`SECURITY.md`, Platzhalter `security@example.org`) ersetzt.

## 9. Barrierefreiheit

- [ ] **Accessibility-Audit** bearbeitet, P1-Findings behoben
      (`ACCESSIBILITY_AUDIT.md`); Tastaturnavigation, Fokus, Labels, Kontrast,
      Touch-Ziele, reduzierte Bewegung, RTL geprüft.

## 10. Dokumentation & Schulung

- [ ] **Handbuch** verteilt (`HANDBUCH.md`); Admins/Leitung/Helfer geschult.
- [ ] **Incident-Response-Runbook** (Art. 33/34) vorhanden und geübt.
- [ ] **Auswertungs-Mindestfallzahl** definiert (Re-Identifikation vermeiden).

---

## Abnahme

| Bereich                    | Verantwortlich | Datum | Unterschrift |
| -------------------------- | -------------- | ----- | ------------ |
| Sicherheits-Review         | «…»            |       |              |
| Penetrationstest           | «…»            |       |              |
| DSGVO/DSFA                 | «…»            |       |              |
| Betrieb/Infra              | «…»            |       |              |
| **Gesamtfreigabe Go-Live** | «…»            |       |              |
