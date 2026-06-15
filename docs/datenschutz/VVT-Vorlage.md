# Verzeichnis von Verarbeitungstätigkeiten (VVT) — Vorlage

> **Vorlage nach Art. 30 DSGVO.** Felder in `«…»` füllt der **Verantwortliche**
> aus. Diese Vorlage spiegelt den **aktuellen Funktionsumfang** von Aidlog wider.
> Sie ersetzt keine rechtliche Prüfung.

## 0. Verantwortlicher / DSB

- **Verantwortlicher:** «Organisation, Anschrift»
- **Vertretung:** «Name»
- **Datenschutzbeauftragte:r (falls bestellt):** «Name/Kontakt»

---

## 1. Verarbeitungstätigkeit: Einsatz-/Patientendokumentation

| Feld                       | Inhalt                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zweck**                  | Dokumentation von Patientenkontakten im Sanitäts-/Hilfsdienst                                                                                                                                                  |
| **Rechtsgrundlage**        | Art. 9 Abs. 2 lit. c/h DSGVO; bei Einwilligung lit. a + Art. 6 Abs. 1 lit. a                                                                                                                                   |
| **Kategorien Betroffener** | Patient:innen / versorgte Personen; ggf. Begleitpersonen                                                                                                                                                       |
| **Kategorien Daten**       | **Gesundheitsdaten (Art. 9)**: Vitalwerte, Anamnese (SAMPLER), Verletzungen/Body-Map, Fotos, EKG, Reanimationsverlauf, Scores; Stammdaten (sofern erhoben); Einwilligungs-/Verweigerungs-Daten; Unterschriften |
| **Empfänger**              | Org-Leitung (Org-Schlüssel-Inhaber); Mitzeichner (Co-Signatur); ggf. Klinik bei Übergabe (außerhalb des Systems)                                                                                               |
| **Hosting/Verarbeiter**    | «Hosting-Anbieter» (sieht **nur Chiffrat + Metadaten**)                                                                                                                                                        |
| **Drittlandtransfer**      | «keiner / Garantien nach Art. 44 ff.»                                                                                                                                                                          |
| **Löschfristen**           | «nach Landesrecht/Berufsrecht»; Krypto-Shredding als Endmaßnahme                                                                                                                                               |
| **TOM**                    | E2E-Verschlüsselung, Append-only/Signatur/Hashkette, TLS, Rollen, Auto-Lock/Wipe, EXIF-Strip — siehe [`TOM.md`](./TOM.md)                                                                                      |

---

## 2. Verarbeitungstätigkeit: Benutzer-/Org-Verwaltung & Audit

| Feld                       | Inhalt                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Zweck**                  | Konten-/Rollenverwaltung, Einladungen, Offboarding, Rechenschaft                                                                                                   |
| **Rechtsgrundlage**        | Art. 6 Abs. 1 lit. f (Betrieb/Sicherheit) bzw. lit. c                                                                                                              |
| **Kategorien Betroffener** | Helfer:innen, Einsatzleitung, Administratoren                                                                                                                      |
| **Kategorien Daten**       | Anzeigename, Rolle, Status, öffentliche Schlüssel-IDs, Einladungs-Metadaten, **Audit-Log** (Einladen/Sperren/Rollenwechsel/Recovery/Schichtschluss — WER/WAS/WANN) |
| **Empfänger**              | Administratoren der Organisation                                                                                                                                   |
| **Besonderheit**           | Einladungs-**Codes** werden **nie im Klartext** gespeichert; Audit-Log enthält **keine** Patientendaten                                                            |
| **Löschfristen**           | «Aufbewahrung Audit-Log: z. B. 12 Monate»                                                                                                                          |

---

## 3. Verarbeitungstätigkeit: Schlüssel-Wiederherstellung (Shamir)

| Feld                       | Inhalt                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Zweck**                  | Wiederherstellbarkeit der Daten bei Org-Passwort-Verlust                                                                       |
| **Rechtsgrundlage**        | Art. 6 Abs. 1 lit. f (Verfügbarkeit, Art. 32)                                                                                  |
| **Kategorien Betroffener** | benannte **Treuhänder** (Anteils-Inhaber)                                                                                      |
| **Kategorien Daten**       | am Server **nur Metadaten**: Schwellwert/Anzahl (T/N), Treuhänder-**Labels**, `orgKeyCheck`. **Anteile selbst nie am Server.** |
| **Empfänger**              | Treuhänder (offline), Administratoren                                                                                          |
| **Risiko**                 | T kolludierende Treuhänder können alles lesen → organisatorische Verwahrung (TOM §4)                                           |

---

## 4. Verarbeitungstätigkeit: Web-Push-Benachrichtigungen (optional)

| Feld                        | Inhalt                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Zweck**                   | **inhaltsfreie** operative/administrative Hinweise (z. B. „Gegenzeichnung offen“)                                            |
| **Rechtsgrundlage**         | Art. 6 Abs. 1 lit. f; Einwilligung über Browser-Permission                                                                   |
| **Kategorien Betroffener**  | Nutzer (Helfer/Leitung/Admin) der App                                                                                        |
| **Kategorien Daten**        | Push-**Endpunkt-URL**, vom Browser publizierte Verschlüsselungs-Schlüssel (p256dh/auth), optionales Geräte-Label, Zeitpunkte |
| **Empfänger / Verarbeiter** | **Push-Dienst** des Browserherstellers (Mozilla/Google/Apple …) — **AVV/Garantien prüfen**, ggf. Drittland                   |
| **Besonderheit**            | Payload **nie** mit Patienten-/Datensatzdaten; nur generischer Text + Route; deaktiviert ohne VAPID                          |
| **Löschfristen**            | Abmeldung entfernt Subscription; tote Endpunkte (404/410) werden automatisch entfernt                                        |

---

## 5. Verarbeitungstätigkeit: Statistische Auswertung

| Feld                 | Inhalt                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Zweck**            | Qualitäts-/Einsatzstatistik (anonymisierte Aggregate)                                                                                   |
| **Rechtsgrundlage**  | Art. 9 Abs. 2 lit. j i. V. m. Art. 89 / berechtigtes Interesse                                                                          |
| **Kategorien Daten** | **nur Aggregate** (Verteilungen kategorialer Felder, Durchschnitts-Vitalwerte, Zeitreihen, Verletzungs-Heatmap)                         |
| **Besonderheit**     | Berechnung **client-seitig** durch Org-Schlüssel-Inhaber; Export enthält **keine** Freitexte/Identifikatoren (Code-Whitelist, getestet) |
| **Empfänger**        | Org-Leitung/Administration                                                                                                              |

---

## 6. Verarbeitungstätigkeit: Multi-Device-Onboarding (Geräte-Transfer)

| Feld                 | Inhalt                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| **Zweck**            | Übernahme der eigenen Identität auf ein weiteres Gerät                                                  |
| **Kategorien Daten** | **Chiffrat** der passwortverpackten Identität (+ öffentliche Identität/Rolle), per Einmal-PIN geschützt |
| **Besonderheit**     | Server-los/offline; PIN out-of-band; Konto-Passwort weiterhin nötig                                     |

> **Hinweis:** Selbstauskunft (Patient), Einwilligung, Vitaltrends, Body-Map/Fotos,
> Reanimation, EKG, PDF-Export und Historie sind **Bestandteile** der
> Patientendokumentation (Nr. 1) und reiten im selben E2E-verschlüsselten Datensatz
> mit — sie sind hier nicht als eigene Verarbeitung gelistet, sondern in Nr. 1 erfasst.
