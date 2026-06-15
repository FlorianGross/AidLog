# Accessibility Audit (WCAG 2.1 AA-orientiert)

> **Art:** Experten-/Code-Review (kein vollständiger assistive-technology-Test).
> **Scope:** `apps/web` (SvelteKit-PWA). **Ziel-Konformität:** WCAG 2.1 **AA**.
> **Methode:** Review der Komponenten/Routen, Design-Tokens (`app.css`,
> `tailwind.config.js`), Fokus-/ARIA-Muster, RTL-Pfad und Bewegungs-Verhalten.
> **Hinweis:** Dies ist ein **Bericht** — es wurden **keine** Komponenten geändert
> (um Konflikte mit parallelen Änderungen zu vermeiden). Jede Empfehlung nennt die
> Stelle, damit sie gezielt umgesetzt werden kann.

**Datum:** 2026-06-12 · **Build-Stand:** aktueller `main`

---

## 0. Zusammenfassung

Aidlog hat eine **überdurchschnittlich gute** Barrierefreiheits-Grundlage:
durchgängige Touch-Ziele (≥ 48px), ein sichtbarer Fokus-Ring via
`:focus-visible`, korrekt verknüpfte `<label for>`-Felder, semantische Landmarks
(`<header>/<nav>/<main>/<footer>`), `aria-label`/`aria-expanded`/`aria-live` an
den richtigen Stellen, `role="alert"` für Fehlermeldungen, gesetztes
`<html lang="de">` und ein **sauberer RTL-Pfad** für den arabischen Patientenflow.

Die wichtigsten Lücken sind **(P1)** unzureichender Textkontrast der „subtle“-
Farbe, **(P1)** fehlendes `prefers-reduced-motion`, und **(P2)** ein nicht
dynamisch gesetztes `lang`/`dir` auf Dokumentebene für nicht-deutsche Inhalte.

| Prio                  | Anzahl | Bedeutung           |
| --------------------- | ------ | ------------------- |
| **P1** (AA-Blocker)   | 3      | vor Go-Live beheben |
| **P2** (wichtig)      | 5      | zeitnah beheben     |
| **P3** (Verbesserung) | 4      | Backlog             |

---

## 1. Befunde

### P1 — vor Produktion beheben

**A11Y-01 · Textkontrast „subtle“ unter AA (WCAG 1.4.3)**

- `--text-subtle: 130 142 160` (≈ `#828EA0`) auf `--surface: 247 248 250`
  (≈ `#F7F8FA`) ergibt ein Kontrastverhältnis von **≈ 3.0:1** — **unter** den für
  Normaltext geforderten **4.5:1**. `text-subtle` wird breit verwendet
  (Footer „Zero-Knowledge …“, Hilfetexte, Badges, Tab-Prozentwerte,
  Trenner-Label „oder“).
- **Empfehlung:** `--text-subtle` (Light **und** Dark) abdunkeln, bis ≥ 4.5:1 für
  Normaltext bzw. ≥ 3:1 nur dort, wo der Text **groß** (≥ 18.66px bold / 24px) ist.
  Light z. B. Richtung `#5A6675`. Auch `--text-muted` gegen die jeweiligen
  Hintergründe (`surface`, `surface-1`, `surface-2`) gegenprüfen.

**A11Y-02 · Kein `prefers-reduced-motion` (WCAG 2.3.3 AAA, aber relevant)**

- Keine Datei nutzt `prefers-reduced-motion`/`motion-reduce`. Es gibt jedoch
  diverse Bewegungen: `animate-spin` (`ui/Spinner.svelte`), `active:scale-[0.98]`
  und `transition-*` (Buttons in `app.css`), die pulsierende **Metronom-Anzeige**
  (`resus/ResusPanel.svelte`, `transition-all duration-75`) sowie Trend-/Progress-
  Animationen.
- **Empfehlung:** globale `@media (prefers-reduced-motion: reduce)`-Regel in
  `app.css`, die Transitions/Animationen auf ~0 reduziert; den Spinner als
  statisches/aria-verstecktes Element belassen (er ist bereits `aria-hidden`).
  Der **akustische/haptische** Metronom-Takt darf bleiben — nur die visuelle
  Pulsation drosseln.

**A11Y-03 · Dokument-`lang`/`dir` für nicht-deutsche Inhalte nicht dynamisch**

- `app.html` setzt fest `<html lang="de">`. Der Patienten-Flow rendert nicht-
  deutsche Inhalte korrekt **lokal** mit `lang`/`dir` am Container
  (`SelfIntakeKiosk.svelte`, `Verstaendigungshilfe.svelte` setzen
  `dir={rtl?'rtl':'ltr'}` und `lang={lang}` an der Wurzel des Panels — gut!), aber
  Screenreader, die das **Dokument**-`lang` heranziehen, lesen z. B. arabischen
  Text mit deutscher Aussprache, solange der lokale `lang` nicht greift.
- **Empfehlung:** das **lokale** `lang`/`dir` ist der entscheidende Hebel und ist
  vorhanden — sicherstellen, dass **jeder** patientensprachige Textknoten
  (inkl. eingebetteter Buttons/Hinweise) innerhalb eines Elements mit korrektem
  `lang`/`dir` liegt. Optional bei aktivem Kiosk `document.documentElement.lang/dir`
  temporär mitsetzen.

### P2 — wichtig

**A11Y-04 · Theme-Toggle-Status nicht programmatisch exponiert**

- `ui/ThemeToggle.svelte` ist ein `<button>` mit `aria-label="Darstellung: …"`,
  aber ohne `aria-pressed`/`aria-live`. Beim Durchschalten (Hell→Dunkel→System)
  erfährt ein Screenreader-Nutzer den neuen Zustand nur über das geänderte Label
  beim erneuten Fokussieren.
- **Empfehlung:** den neuen Zustand nach Klick via einer `aria-live="polite"`-
  Region ansagen oder als `role="radiogroup"`/Menü modellieren.

**A11Y-05 · Touch-Tasten-/Ziel-Mindestgröße im Reanimations-/Skalen-UI prüfen**

- Es gibt `min-h-touch` (48px) breit; einige dichte Steuerflächen nutzen jedoch
  feste `h-14 w-14`/`min-h-[3rem]` (Metronom-Button, NRS-Skala 0–10 in
  `SelfIntakeKiosk`). 48px ist erfüllt, aber die NRS-Zellen im 11-Spalten-Raster
  können auf kleinen Geräten **eng** werden (Abstand < empfohlen).
- **Empfehlung:** Mindest-Hit-Target **48×48px inkl. Abstand** (WCAG 2.5.5 AAA /
  2.5.8 AA „24px“ mind. einhalten); ggf. NRS auf kleinen Viewports umbrechen.

**A11Y-06 · Icon-only-Buttons systematisch auf `aria-label` prüfen**

- Im Layout/Drawer sind Icon-Buttons korrekt gelabelt (`aria-label={$t('nav.openMenu')}`
  etc.). Bei der Vielzahl an Panels (Body-Map-Editor, Foto-Galerie, EKG, Vital-
  Editor) ist eine **vollständige** Durchsicht nötig, dass **kein** rein
  ikonischer interaktiver Knopf ohne zugänglichen Namen bleibt.
- **Empfehlung:** Lint-Regel/Review-Checkliste „Icon-only ⇒ `aria-label`“.

**A11Y-07 · Fehler-Zuordnung zu Feldern (`aria-describedby`/`aria-invalid`)**

- Formularfehler werden korrekt als `role="alert"` angekündigt (gut), sind aber
  als **Sammelmeldung** unten platziert und nicht per `aria-describedby` mit dem
  konkreten Feld verknüpft; betroffene Felder tragen kein `aria-invalid`.
- **Empfehlung:** das fehlerhafte Feld mit `aria-invalid="true"` und
  `aria-describedby` auf die Meldung verknüpfen (z. B. Passwort-Felder in
  `setup`/`redeem`).

**A11Y-08 · Fokus-Management bei Drawer/Modal verifizieren**

- `components/Drawer.svelte` und `ui/Modal.svelte` existieren; off-canvas-Drawer
  hat `aria-live`. Zu prüfen: **Fokus-Falle** im offenen Modal/Drawer, Rückgabe
  des Fokus auf den auslösenden Button beim Schließen, `Esc`-Schließen.
- **Empfehlung:** Fokus-Trap + Fokus-Restore testen (Tastatur-only-Durchlauf).

### P3 — Verbesserungen

**A11Y-09 · „Skip to content“-Link** fehlt — für Tastaturnutzer hilfreich, um die
Navigation zu überspringen. Empfehlung: sichtbar-bei-Fokus-Skiplink vor `<main>`.

**A11Y-10 · Statusfarben nicht allein über Farbe (WCAG 1.4.1).** Online/Offline-
Punkt und „open/closed“-Badges nutzen Farbe; Text-Label ist vorhanden (gut) — bei
rein farbigen Punkten (z. B. Konnektivitäts-Dot) ein zusätzliches Form-/Text-
Signal sicherstellen.

**A11Y-11 · Heading-Hierarchie prüfen.** Pro Route genau **ein** `<h1>` und keine
Sprünge (h1→h3); im Layout trägt der Header bereits ein `<h1>` mit dem Seitentitel —
sicherstellen, dass Unterseiten nicht ein zweites `<h1>` einführen.

**A11Y-12 · Canvas-Inhalte (Body-Map, EKG, Trendkurven, Unterschrift) textlich
alternativ beschreiben** (WCAG 1.1.1): kurze `aria-label`/`<figcaption>`-
Zusammenfassung (z. B. „Verletzungs-Silhouette, 3 Marker“), da die grafische
Information sonst rein visuell ist.

---

## 2. Was bereits gut ist (zur Beibehaltung)

- **Touch-Ziele:** `min-h-touch`/`min-w-touch` = **3rem (48px)** als Token, breit
  angewandt — entspricht WCAG 2.5.5.
- **Sichtbarer Fokus:** globaler `:focus-visible { ring-2 ring-ring ring-offset-2 }`
  in `app.css` (WCAG 2.4.7).
- **Formular-Labels:** durchgängig `<label class="field-label" for="…">` mit
  passenden `id`s; `autocomplete="new-password|current-password"` gesetzt.
- **Landmarks & ARIA:** `<header>/<nav aria-label>/<main>/<footer>`,
  `aria-expanded` am Hamburger, `aria-live="polite"` für Konnektivität/Integrität,
  `role="alert"` für Fehler, `role="note"` für die Org-Passwort-Warnung.
- **RTL:** sauberer, datengetriebener RTL-Pfad (`isRtl`/`RTL_LANGS`), `dir`/`lang`
  am Panel-Container; numerische Skalen bewusst `dir="ltr"`.
- **Dark/Light/Kontrast-Tokens:** zentrale Farb-Tokens mit Dark-Mode und
  `color-scheme` gesetzt; erleichtert die Kontrast-Korrektur aus A11Y-01.
- **Keine reinen Farb-Botschaften ohne Text** an den geprüften Hauptstellen
  (Status zusätzlich mit Wort-Label).

---

## 3. Priorisierte Empfehlungen (Reihenfolge)

1. **A11Y-01** Kontrast `--text-subtle`/`--text-muted` auf ≥ AA anheben (Tokens).
2. **A11Y-02** globales `prefers-reduced-motion: reduce` in `app.css`.
3. **A11Y-03** sicherstellen, dass patientensprachige Inhalte vollständig in
   `lang`/`dir`-korrekten Containern liegen.
4. **A11Y-07 / A11Y-04** Feld-Fehler-Verknüpfung + Theme-Status-Ansage.
5. **A11Y-08 / A11Y-06** Fokus-Trap/-Restore + vollständige Icon-Button-Durchsicht.
6. **A11Y-05 / A11Y-12 / A11Y-09 / A11Y-10 / A11Y-11** Touch-Abstände, Canvas-
   Alternativtexte, Skiplink, Farb-Redundanz, Heading-Hierarchie.

## 4. Vorschlag: automatisierte Prüfung (folgt der E2E-Erweiterung)

Im Rahmen der geplanten **Full-Stack-E2E** (siehe `apps/web/e2e/README.md`) lässt
sich `@axe-core/playwright` ergänzen, um Kontrast/Labels/Landmarks pro Route
**automatisiert** zu prüfen. Die Smoke-Tests setzen bereits auf zugängliche
Selektoren (Rollen/Labels), was solche Checks erleichtert.
