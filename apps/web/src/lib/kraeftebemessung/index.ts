/**
 * lib/kraeftebemessung — Kräftebemessung (Kölner Algorithmus / Maurer-Schema).
 *
 * Reine, offen gelegte Punkte-Berechnung als ORIENTIERUNGSHILFE für die
 * Sanitätsdienst-Vorhaltung bei Veranstaltungen. Kein Ersatz für eine
 * verbindliche Bemessung durch Behörde/Sanitätseinsatzleitung.
 */
export {
  berechneKraefte,
  stufeFuerScore,
  DEFAULT_INPUT,
  EMPFEHLUNGS_TABELLE,
  PUNKTE_VERANSTALTUNGSART,
  PUNKTE_BESUCHER,
  PUNKTE_STRUKTUR,
  PUNKTE_VERHALTEN,
  PUNKTE_WITTERUNG,
  PUNKTE_DAUER,
  PUNKTE_FLAECHE,
  PUNKTE_GEFAEHRDETE_PERSONEN,
  type KraefteInput,
  type KraefteErgebnis,
  type Empfehlung,
  type EmpfehlungsStufe,
  type ScorePosition,
  type Stufe,
  type Veranstaltungsart,
  type BesucherBand,
  type Besucherstruktur,
  type Verhalten,
  type Witterung,
  type Dauer,
  type Flaeche,
} from './calc';
