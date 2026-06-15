# Aidlog — Handbuch für Nutzer:innen & Administrator:innen

> Aufgabenorientiertes Handbuch zur Bedienung. Hintergründe zu Sicherheit und
> Datenschutz: [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`THREAT_MODEL.md`](./THREAT_MODEL.md),
> [`COMPLIANCE.md`](./COMPLIANCE.md). Aidlog ist eine installierbare **PWA**, die
> **offline im Feld** funktioniert; Daten werden **auf dem Gerät** ver-/entschlüsselt.

**Grundprinzip in einem Satz:** Dein **Passwort verlässt das Gerät nie**, der
**Server sieht nur Chiffrat**, und nur wer das **Organisations-Passwort** (oder
genügend Wiederherstellungs-Anteile) hat, kann den Archivbestand lesen.

---

## Rollen

| Rolle             | Darf                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Helfer**        | Einsätze anlegen, Patientenkontakte dokumentieren, eigene Einträge bis Schichtschluss lesen                                   |
| **Einsatzleiter** | alles wie Helfer, zusätzlich Schichten führen/schließen, Gegenzeichnungen anfordern/leisten, alle Org-Einsätze sehen          |
| **Administrator** | Org-Schlüssel-Verwahrer; volle Benutzerverwaltung (Einladungen, Sperren, Rollen), Wiederherstellung, Schema-Editor, Audit-Log |

---

# Teil A — Für alle Nutzer:innen

## A1. Ersteinrichtung der Organisation (erster Administrator)

> Nur **einmal** pro Organisation, durch den ersten Administrator.

1. App öffnen → **Ersteinrichtung** erscheint (`/setup`).
2. **Name der Organisation** eingeben.
3. **Organisations-Passwort** vergeben (2×). Dieses schützt den Org-Schlüssel.
4. **Administrator-Namen** + **Administrator-Passwort** vergeben (2×).
5. **Organisation anlegen**.

> ⚠️ **Wichtig:** Geht das **Organisations-Passwort** verloren und ist **keine
> Wiederherstellung** eingerichtet, sind **alle Daten unwiederbringlich**. Richte
> direkt nach der Einrichtung die **Schlüssel-Wiederherstellung** ein (Teil B).
> Org-Passwort und Admin-Passwort sind **verschieden** — verwahre beide sicher.

## A2. Als eingeladene:r Helfer:in starten (Einladung einlösen)

1. Vom Administrator den **Einladungscode** erhalten.
2. App öffnen → **Entsperren** → **„Einladungscode erhalten? Hier einlösen“**
   (`/redeem`).
3. **Code** eingeben, **Anzeigenamen** wählen, **Passwort** vergeben (2×, ≥ 10 Zeichen).
4. **Einladung einlösen**. Deine Schlüssel werden auf dem Gerät erzeugt und mit
   deinem Passwort geschützt.

## A3. Entsperren (täglicher Login)

- App öffnen → **Passwort** eingeben → **Entsperren** (`/login`).
- Optional, falls eingerichtet: **Mit Passkey entsperren** (Fingerabdruck/Gesicht/PIN).
- Das Passwort entsperrt den Schlüssel **nur im Arbeitsspeicher** und wird verworfen.

## A4. Einen Einsatz dokumentieren (ABCDE / Tabs)

1. Auf dem **Dashboard**: Titel im Feld **„Neuer Einsatz“** eingeben →
   **„Neuen Einsatz starten“**.
2. Im **Editor** links die **Abschnitte/Tabs** wählen. Neben den Schema-Abschnitten
   (z. B. ABCDE/Anamnese) gibt es **Spezial-Tabs**:
   - **Vitalwerte** (♥): Mehrfachmessungen + **Trendkurven**.
   - **Body-Map/Fotos** (⚑): Verletzungs-Marker auf der Silhouette + Fotos
     (Fotos werden beim Speichern **automatisch von EXIF/GPS bereinigt**).
   - **Reanimation** (✚): geführter **Reanimations-Assistent** mit Metronom + Log.
   - **Einwilligung** (§): Behandlung / Transportverweigerung / Datenverarbeitung.
   - **Selbstauskunft** (🗣): Patienten-Eingabe (siehe A6).
3. Pflichtfelder sind markiert; oben siehst du den **Fortschritt** je Abschnitt.
4. Eingaben werden **lokal als Entwurf** gespeichert (auch offline).

## A5. Unterschrift & Gegenzeichnung

- **Unterschrift:** im Unterschriften-Bereich auf dem Touch-Pad zeichnen. Das Bild
  wird verschlüsselt mit dem Datensatz gespeichert.
- **Finalisieren:** Pflichtfelder werden geprüft, dann entsteht ein **unveränderlicher,
  signierter** Datensatz (Korrekturen später nur als **neuer** Eintrag).
- **Gegenzeichnung anfordern** (Leitung/Helfer): unter **Gegenzeichnungen**
  (`/cosign`) Person(en) auswählen. Der/die Mitzeichner:in kann den Datensatz
  **lesen** (der Datenschlüssel wird zusätzlich an ihn/sie versiegelt) und
  **signiert** oder **lehnt ab**.
- Offene Gegenzeichnungen erscheinen auf dem **Dashboard** und unter
  **„Wartet auf meine Signatur“**.

## A6. Selbstauskunft durch Patient:innen

1. Im Editor den Tab **Selbstauskunft** öffnen → Gerät an die Patientin/den
   Patienten geben.
2. **Sprache** wählen (de/en/tr/ar/ru/uk/fr; **Arabisch** läuft **rechts-nach-links**).
3. Die Person beantwortet wenige Anamnese-Fragen (Großflächen-Kiosk).
4. Antworten **prefillen** die passenden Protokollfelder; du **prüfst und korrigierst**
   sie anschließend. Die Original-Antworten bleiben zusätzlich gespeichert.

## A7. Gerät hinzufügen (zweites Gerät)

> Damit nutzt du **dieselbe Identität** auf einem weiteren Gerät — server-los.

**Auf dem alten (entsperrten) Gerät:** Profil/Sicherheit → Transfer starten →
ein **QR-Code** + eine **Einmal-PIN** werden angezeigt.

**Auf dem neuen Gerät:** **Entsperren** → **„Anderes Gerät? Dieses Gerät hinzufügen“**
(`/device-add`) → QR scannen oder Code einfügen → **PIN** eingeben → anschließend
dein **Konto-Passwort** eingeben.

> Sicherheit: Der Code allein nützt nichts — es braucht **PIN _und_ Konto-Passwort**.
> Gib die PIN getrennt vom Code weiter und notiere sie nicht.

## A8. Sicherheits-Einstellungen (pro Gerät)

- **Auto-Sperre:** Sperrt nach Inaktivität (Aus / 1 / 2 / 5 / 10 / 15 min; Standard 5).
- **Bei Hintergrund sperren:** sperrt kurz nach dem Wegwechseln der App.
- **Passkey hinzufügen/entfernen:** schnelleres Entsperren via Gerätesicherheit.
- **Benachrichtigungen (Push):** optionale, **inhaltsfreie** Hinweise (z. B.
  „Gegenzeichnung offen“) — nie Patientendaten.

## A9. Notfall-Prozeduren

- **Gerät verloren/gestohlen:** auf einem anderen Gerät anmelden und das/den
  betroffene:n Nutzer:in vom Administrator **sperren** lassen; falls vorhanden,
  per MDM **remote wipen**. Hinweis: Auto-Sperre/Wipe begrenzen den Schaden.
- **Geräte-Wipe (Panik):** in den Sicherheits-Einstellungen **„Dieses Gerät
  bereinigen“** löscht lokal alle App-Daten (IndexedDB, App-Einstellungen, Caches,
  Service-Worker). Auf dem Server liegende Daten bleiben unberührt.
- **Passwort vergessen (eigenes):** ohne Passwort/Passkey ist die lokale Identität
  nicht entsperrbar. Lass dir vom Administrator eine **neue Einladung** geben.
- **Org-Passwort verloren:** siehe **B4 — Schlüssel-Wiederherstellung**.

---

# Teil B — Für Administrator:innen

## B1. Helfer einladen

1. **Benutzerverwaltung** (`/admin/users`).
2. **Einladung erstellen** → **Rolle** (helper/lead/admin), optional Anzeigename
   und Gültigkeitsdauer wählen.
3. Der **Einmal-Code** wird **genau einmal** angezeigt → sicher an die Person
   übermitteln (er wird **nicht** im Klartext gespeichert).

## B2. Nutzer verwalten / Offboarding

- In **Benutzerverwaltung**: **Rolle ändern**, **sperren** (`disabled`) oder
  **reaktivieren**. Gesperrte Nutzer können sich nicht mehr authentifizieren.
- Beim Offboarding zusätzlich: dessen **Passkeys** auf gemeinsamen Geräten
  entfernen; war die Person **Recovery-Treuhänder**, **Anteile neu ausgeben** und
  **Org-Passwort rotieren** (siehe B4).
- Alle diese Aktionen erscheinen im **Audit-Log**.

## B3. Auswertung

1. **Auswertung** (`/admin/auswertung`) — erfordert das **Org-Passwort** (entsperrt
   den Org-Schlüssel zum org-weiten Entschlüsseln **im Browser**).
2. Es werden **nur anonymisierte Aggregate** berechnet/angezeigt: Verteilungen,
   Durchschnitts-Vitalwerte, Zeitreihen, Verletzungs-Heatmap.
3. **Export** enthält **keine** Freitexte/Identifikatoren. Lege intern eine
   **Mindestfallzahl** fest, um Re-Identifikation in kleinen Mengen zu vermeiden.

## B4. Schlüssel-Wiederherstellung (Shamir)

**Einrichten** (`/admin/recovery`):

1. **Org-Passwort** eingeben, **Anzahl Anteile (N)** und **Schwelle (T)** wählen
   (Empfehlung **T ≥ 3**) sowie **Treuhänder-Labels**.
2. Die **Anteile** werden erzeugt → an die Treuhänder **getrennt** verteilen
   (Druck/Export). **Anteile gelangen nie auf den Server** — dort liegen nur
   Metadaten (T/N, Labels, Prüfwert).

**Wiederherstellen** (`/recover`, „Organisations-Passwort verloren?“):

1. **≥ T Anteile** der Treuhänder einsammeln und einfügen.
2. Der Schlüssel wird **rekonstruiert und geprüft**; bei zu wenigen/falschen
   Anteilen schlägt es kontrolliert fehl.
3. Ein **neues Org-Passwort** vergeben → der Schlüssel wird neu verpackt.
4. Danach **Anteile neu ausgeben** (alte sind nach Passwortwechsel zu erneuern).

> **Drill vor Produktion:** Diesen Ablauf einmal in einer Test-Org **vollständig
> durchspielen** (siehe Pre-Production-Checkliste §4).

## B5. Protokoll-Schema anpassen (Schema-Editor)

- **Schema** (`/admin/schema`): Abschnitte/Felder der Protokolle bearbeiten und als
  **neue Version** speichern — **ohne Code-Änderung**. Feld**definitionen** sind
  Org-Konfiguration (**keine** Patientendaten). Bestehende Datensätze behalten ihre
  Schema-Version und bleiben lesbar.

## B6. Audit-Log

- **Audit-Log** (`/admin/audit`): administrative Ereignisse (Einladen, Einlösen,
  Sperren/Reaktivieren, Rollenwechsel, Recovery-Konfiguration, Schichtschluss) mit
  **WER/WAS/WANN**. Enthält **keine** Patientendaten und keine Codes.

## B7. Push aktivieren (optional, Betreiber)

- Push ist **aus**, solange keine **VAPID**-Schlüssel am Server gesetzt sind. Zum
  Aktivieren ein VAPID-Schlüsselpaar erzeugen und in `infra/.env`
  (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`) eintragen. Der Push-Dienst
  des Browserherstellers wird damit zum **Auftragsverarbeiter** (AVV nötig) — siehe
  [`datenschutz/VVT-Vorlage.md`](./datenschutz/VVT-Vorlage.md).

---

## Wichtige ehrliche Grenzen (bitte kennen)

- **Org-Passwort-Verlust ohne Recovery = endgültiger Datenverlust.**
- **Schichtschluss** entzieht Helfern künftiges Lesen, **löscht aber nicht** bereits
  Gesehenes/Kopiertes.
- **Kompromittiertes Gerät** (Schadsoftware/böse Erweiterung) hebt die
  Verschlüsselung auf diesem Gerät auf.
- **Recovery ist Treuhand:** T zusammenwirkende Treuhänder können alles lesen.
