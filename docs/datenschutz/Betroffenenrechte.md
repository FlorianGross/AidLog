# Betroffenenrechte (Art. 12–22 DSGVO) — Umsetzung & Grenzen

> Beschreibt, wie der Verantwortliche Betroffenenrechte mit Aidlog **umsetzen
> kann** — und wo die Zero-Knowledge-Architektur **ehrliche Grenzen** setzt.
> Felder `«…»` füllt der Verantwortliche aus.

---

## 1. Transparenz & Information (Art. 12–14)

- **Aufklärung am Einsatzort:** das **Einwilligungs-/Aufklärungs-Modul**
  (`einwilligung`: Behandlung / Transportverweigerung / Datenverarbeitung) zeigt
  einen **editierbaren Aufklärungstext** und erfasst Quittierungen + Unterschrift.
- **Sprachbarrieren:** die **Selbstauskunft** und die **Verständigungshilfe**
  bieten mehrsprachige Erfassung (de/en/tr/ar/ru/uk/fr), **Arabisch in RTL**.
  Hinweis: nicht-deutsche Übersetzungen sind maschinell vorerstellt (Banner) und
  vor Produktion **professionell zu prüfen**.
- **Datenschutzhinweise** (allgemein) stellt der Verantwortliche bereit: «Link».

---

## 2. Auskunft (Art. 15)

- **Selbstauskunft-Kiosk:** Patient:innen können geführt Angaben selbst erfassen;
  diese werden im Datensatz gespeichert und sind später auslesbar.
- **Auskunftserteilung:** ein Org-Schlüssel-Inhaber (admin/lead) entschlüsselt die
  betreffenden Datensätze **client-seitig** und stellt eine Kopie bereit
  (z. B. via **PDF-Export**).
- **Grenze:** der Server kann **nicht** auskunftsfähig „nachschlagen“ — Auskunft
  erfordert immer einen autorisierten, entsperrten Client.

---

## 3. Berichtigung (Art. 16)

- Datensätze sind **append-only**. Eine Korrektur erzeugt einen **neuen** Datensatz
  mit `supersedes`-Verweis; die **Änderungshistorie** bleibt nachvollziehbar
  (Integrität/Manipulationsnachweis). Der ursprüngliche Eintrag wird nicht
  überschrieben, sondern als ersetzt markiert — das ist gewollt (Beweiswert).

---

## 4. Löschung / „Recht auf Vergessenwerden“ (Art. 17)

- **Krypto-Shredding (Gesamtbestand):** Vernichtung des **Org-Schlüssels** und
  **aller Wiederherstellungs-Anteile** macht den **gesamten** Datenbestand
  dauerhaft unentschlüsselbar = wirksame Löschung.
- **Soft Revocation:** beim Schichtschluss wird der Helfer-Wrapper entfernt
  (entzieht **künftige** Entschlüsselbarkeit, löscht aber nicht bereits Gesehenes).
- **Ehrliche Grenze — selektive Einzel-Löschung:** Eine Löschung **eines einzelnen**
  Datensatzes ist rein kryptografisch **nicht** möglich, solange der Org-Schlüssel
  existiert (jeder Datensatz ist zusätzlich an den Org-Public-Key versiegelt). Eine
  echte Einzel-Löschung erfordert eine **operative Maßnahme** des Verantwortlichen:
  serverseitiges Entfernen des Chiffrats/Blobs des betreffenden Datensatzes
  «Verfahren/Tooling definieren». Die Append-only-Kette macht ein solches Entfernen
  als **Kettenlücke** sichtbar — das ist beim Löschkonzept zu berücksichtigen.

---

## 5. Einschränkung (Art. 18)

- Markierung/Einschränkung der Verarbeitung organisatorisch über Rollen/Status
  und «Verfahren». Technisch unterstützt der Append-Charakter die Nachvollziehbarkeit.

---

## 6. Datenübertragbarkeit (Art. 20)

- **Export:** strukturierter **PDF-Export** je Datensatz; ein maschinenlesbarer
  Datenexport ist über die entschlüsselten Payloads (kanonisches JSON) möglich
  «Format/Tooling definieren».

---

## 7. Widerspruch (Art. 21) & Einwilligungswiderruf (Art. 7 Abs. 3)

- **Widerruf:** das Einwilligungsmodul dokumentiert auch **Verweigerung/Widerruf**
  (inkl. Transportverweigerung). Der Widerruf wirkt **ab** Eingang; bereits
  rechtmäßig erfolgte Verarbeitung bleibt unberührt.
- Folgen eines Widerrufs (z. B. Löschung) richten sich nach §4.

---

## 8. Keine automatisierte Entscheidung im Einzelfall (Art. 22)

- Aidlog trifft **keine** rechtlich erheblichen automatisierten Einzelentscheidungen.
  Scores/Assistenten (z. B. Reanimations-Assistent, Vital-Scores) sind
  **Entscheidungs­unterstützung** für Fachpersonal, nicht automatisierte Entscheidung.

---

## 9. Verfahren & Fristen (organisatorisch)

- **Eingangskanal** für Betroffenenanfragen: «E-Mail/Adresse».
- **Frist:** grundsätzlich **1 Monat** (Art. 12 Abs. 3), Verlängerung möglich.
- **Identitätsprüfung** der anfragenden Person: «Verfahren».
- **Zuständige Rolle** (entsperrt Client, erstellt Auskunft/Export): «admin/lead».
