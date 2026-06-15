/**
 * kraeftebemessung/calc.ts — TRANSPARENTER Punkte-Rechner zur Kräftebemessung
 * für Sanitätsdienste bei Veranstaltungen, in Anlehnung an den
 * KÖLNER ALGORITHMUS (Maurer-Schema).
 *
 * WICHTIG — RECHTLICHER CHARAKTER:
 * Dies ist eine ORIENTIERUNGSHILFE. Das Ergebnis ersetzt KEINE verbindliche
 * Bemessung durch die zuständige Behörde bzw. die Sanitätseinsatzleitung. Die
 * tatsächlich vorzuhaltenden Kräfte richten sich nach den örtlichen Vorgaben,
 * der Gefährdungsbeurteilung und der konkreten Lage.
 *
 * METHODIK (Maurer-Schema / Kölner Algorithmus, vereinfachte, offen gelegte
 * Variante): jeder Eingabeparameter wird einer Punktzahl zugeordnet. Die Summe
 * aller Punkte ergibt einen Gesamtscore, der über eine Schwellen­tabelle auf
 * eine Empfehlung (Sanitäter, Rettungsmittel, arztbesetzte Mittel,
 * Empfehlungsstufe) abgebildet wird. Sämtliche Tabellen sind als benannte
 * Konstanten mit Kommentaren offen gelegt — bewusst KEINE Black-Box.
 *
 * PURITÄT: dieses Modul ist seiteneffektfrei. Es verwendet KEIN `Date`,
 * KEIN `Math.random` und führt KEINE I/O aus. Gleiche Eingabe → gleiche Ausgabe.
 *
 * Die konkreten Punktwerte sind eine nachvollziehbare, an die publizierten
 * Schemata angelehnte Parametrisierung; sie sind als Startwerte gedacht und
 * können organisationsintern angepasst werden. Sie sind NICHT als amtlich
 * verbindlich zu verstehen (siehe Disclaimer).
 */

// ===========================================================================
// Eingabe-Wertebereiche (jeweils als String-Union, damit das Formular sie als
// Auswahl rendern kann und die Punktetabellen vollständig/typsicher bleiben).
// ===========================================================================

/** Art/Risikoklasse der Veranstaltung. */
export type Veranstaltungsart =
  | 'fest_ruhig' // ruhiges Fest, Markt, Ausstellung
  | 'sport_publikum' // Sportveranstaltung mit Publikum
  | 'konzert_sitzend' // Konzert/Bühne, überwiegend sitzend
  | 'konzert_stehend' // Konzert/Festival, stehend, Bühne vorne
  | 'demonstration' // Demonstration/Kundgebung
  | 'grossveranstaltung_risiko'; // Großveranstaltung mit erhöhtem Risiko

/** Erwartete Besucherzahl in Bändern (typische Schwellen der Schemata). */
export type BesucherBand = 'bis_1000' | 'bis_5000' | 'bis_20000' | 'bis_50000' | 'ueber_50000';

/** Alters-/Besucherstruktur (Schwerpunkt der erwarteten Klientel). */
export type Besucherstruktur =
  | 'gemischt' // gemischtes Publikum
  | 'familien_kinder' // viele Familien/Kinder
  | 'jugendlich' // überwiegend jugendlich
  | 'senioren'; // überwiegend ältere Menschen

/** Erwartetes Verhalten / Alkohol- & Drogenkonsum. */
export type Verhalten =
  | 'gering' // ruhig, wenig/kein Alkohol
  | 'maessig' // moderater Alkoholkonsum
  | 'hoch' // hoher Alkohol-/Drogenkonsum, Eskalationsrisiko
  | 'aggressiv'; // erhöhtes Gewalt-/Eskalationspotenzial

/** Witterung / Wetterlage. */
export type Witterung =
  | 'gemaessigt' // gemäßigt, überdacht/innen
  | 'hitze' // große Hitze / direkte Sonne
  | 'kaelte' // Kälte/Nässe
  | 'extrem'; // Unwetterlage / extreme Bedingungen

/** Veranstaltungsdauer. */
export type Dauer = 'bis_4h' | 'bis_8h' | 'bis_12h' | 'mehrtaegig';

/** Fläche / Zugänglichkeit für Rettungskräfte. */
export type Flaeche =
  | 'gut' // gut zugänglich, kurze Wege
  | 'mittel' // teilweise eingeschränkt
  | 'schlecht'; // weitläufig/unübersichtlich, schwer erreichbar

/** Vollständige Eingabe der Kräftebemessung. */
export interface KraefteInput {
  veranstaltungsart: Veranstaltungsart;
  besucher: BesucherBand;
  struktur: Besucherstruktur;
  verhalten: Verhalten;
  witterung: Witterung;
  dauer: Dauer;
  flaeche: Flaeche;
  /** Anwesenheit besonders gefährdeter Personen (z. B. Kranke, Pflegebedürftige). */
  gefaehrdetePersonen: boolean;
}

// ===========================================================================
// PUNKTETABELLEN (offen gelegt). Höhere Punkte = höherer Bedarf.
// Angelehnt an das Maurer-Schema / den Kölner Algorithmus. Die Werte sind eine
// nachvollziehbare Parametrisierung und organisationsintern anpassbar.
// ===========================================================================

export const PUNKTE_VERANSTALTUNGSART: Record<Veranstaltungsart, number> = {
  fest_ruhig: 1,
  sport_publikum: 3,
  konzert_sitzend: 4,
  konzert_stehend: 6,
  demonstration: 6,
  grossveranstaltung_risiko: 8,
};

export const PUNKTE_BESUCHER: Record<BesucherBand, number> = {
  bis_1000: 1,
  bis_5000: 3,
  bis_20000: 6,
  bis_50000: 9,
  ueber_50000: 12,
};

export const PUNKTE_STRUKTUR: Record<Besucherstruktur, number> = {
  gemischt: 1,
  familien_kinder: 2,
  jugendlich: 3,
  senioren: 3,
};

export const PUNKTE_VERHALTEN: Record<Verhalten, number> = {
  gering: 0,
  maessig: 2,
  hoch: 4,
  aggressiv: 6,
};

export const PUNKTE_WITTERUNG: Record<Witterung, number> = {
  gemaessigt: 0,
  hitze: 3,
  kaelte: 2,
  extrem: 5,
};

export const PUNKTE_DAUER: Record<Dauer, number> = {
  bis_4h: 0,
  bis_8h: 1,
  bis_12h: 2,
  mehrtaegig: 4,
};

export const PUNKTE_FLAECHE: Record<Flaeche, number> = {
  gut: 0,
  mittel: 2,
  schlecht: 4,
};

/** Zuschlag bei Anwesenheit besonders gefährdeter Personen. */
export const PUNKTE_GEFAEHRDETE_PERSONEN = 3;

// ===========================================================================
// EMPFEHLUNGS-STUFEN: Abbildung Gesamtscore → empfohlene Vorhaltung.
// Die Schwellen sind aufsteigend; es gilt die höchste Stufe, deren `minScore`
// erreicht wird. Bewusst transparent als Tabelle gehalten.
// ===========================================================================

export type Stufe = 'gering' | 'erhoeht' | 'hoch' | 'sehr_hoch';

export interface EmpfehlungsStufe {
  /** untere Score-Grenze (einschließlich), ab der diese Stufe gilt. */
  minScore: number;
  stufe: Stufe;
  /** empfohlene Anzahl Sanitäter (Einsatzkräfte). */
  sanitaeter: number;
  /** empfohlene Anzahl Rettungsmittel (z. B. Tragen-/RTW-äquivalente Einheiten). */
  rettungsmittel: number;
  /** empfohlene Anzahl arztbesetzter Mittel (Notarzt/leitender Notarzt-Komponente). */
  arztbesetzteMittel: number;
}

/**
 * Schwellentabelle (aufsteigend nach `minScore`). Die Mengenangaben sind als
 * Mindest-Orientierung zu verstehen und im Einzelfall an Lage und örtliche
 * Vorgaben anzupassen.
 */
export const EMPFEHLUNGS_TABELLE: readonly EmpfehlungsStufe[] = [
  { minScore: 0, stufe: 'gering', sanitaeter: 2, rettungsmittel: 0, arztbesetzteMittel: 0 },
  { minScore: 10, stufe: 'erhoeht', sanitaeter: 4, rettungsmittel: 1, arztbesetzteMittel: 0 },
  { minScore: 18, stufe: 'hoch', sanitaeter: 8, rettungsmittel: 2, arztbesetzteMittel: 1 },
  { minScore: 28, stufe: 'sehr_hoch', sanitaeter: 16, rettungsmittel: 4, arztbesetzteMittel: 2 },
] as const;

// ===========================================================================
// ERGEBNISTYPEN
// ===========================================================================

/** Eine einzelne, nachvollziehbare Position der Punkteberechnung. */
export interface ScorePosition {
  /** stabiler Schlüssel des Parameters (für i18n-Labels). */
  key: keyof KraefteInput;
  /** der gewählte Wert (oder 'ja'/'nein' bei boolean). */
  wert: string;
  punkte: number;
}

export interface Empfehlung {
  stufe: Stufe;
  sanitaeter: number;
  rettungsmittel: number;
  arztbesetzteMittel: number;
}

export interface KraefteErgebnis {
  /** Gesamtpunktzahl. */
  score: number;
  /** nachvollziehbare Aufschlüsselung jeder Score-Position (für die Anzeige). */
  positionen: ScorePosition[];
  empfehlung: Empfehlung;
}

// ===========================================================================
// BERECHNUNG
// ===========================================================================

/** Wähle die höchste Empfehlungsstufe, deren `minScore` erreicht ist. */
export function stufeFuerScore(score: number): EmpfehlungsStufe {
  let gewaehlt = EMPFEHLUNGS_TABELLE[0]!;
  for (const stufe of EMPFEHLUNGS_TABELLE) {
    if (score >= stufe.minScore) gewaehlt = stufe;
  }
  return gewaehlt;
}

/**
 * Berechne die empfohlene Kräftevorhaltung aus den Eingabeparametern.
 *
 * PUR: keine Seiteneffekte, kein Date/Math.random. Liefert den Gesamtscore, die
 * vollständige Aufschlüsselung jeder Position und die abgeleitete Empfehlung.
 */
export function berechneKraefte(input: KraefteInput): KraefteErgebnis {
  const positionen: ScorePosition[] = [
    {
      key: 'veranstaltungsart',
      wert: input.veranstaltungsart,
      punkte: PUNKTE_VERANSTALTUNGSART[input.veranstaltungsart],
    },
    { key: 'besucher', wert: input.besucher, punkte: PUNKTE_BESUCHER[input.besucher] },
    { key: 'struktur', wert: input.struktur, punkte: PUNKTE_STRUKTUR[input.struktur] },
    { key: 'verhalten', wert: input.verhalten, punkte: PUNKTE_VERHALTEN[input.verhalten] },
    { key: 'witterung', wert: input.witterung, punkte: PUNKTE_WITTERUNG[input.witterung] },
    { key: 'dauer', wert: input.dauer, punkte: PUNKTE_DAUER[input.dauer] },
    { key: 'flaeche', wert: input.flaeche, punkte: PUNKTE_FLAECHE[input.flaeche] },
    {
      key: 'gefaehrdetePersonen',
      wert: input.gefaehrdetePersonen ? 'ja' : 'nein',
      punkte: input.gefaehrdetePersonen ? PUNKTE_GEFAEHRDETE_PERSONEN : 0,
    },
  ];

  const score = positionen.reduce((sum, p) => sum + p.punkte, 0);
  const stufe = stufeFuerScore(score);

  return {
    score,
    positionen,
    empfehlung: {
      stufe: stufe.stufe,
      sanitaeter: stufe.sanitaeter,
      rettungsmittel: stufe.rettungsmittel,
      arztbesetzteMittel: stufe.arztbesetzteMittel,
    },
  };
}

/** Sinnvolle Default-Eingabe für den Formular-Erststart. */
export const DEFAULT_INPUT: KraefteInput = {
  veranstaltungsart: 'fest_ruhig',
  besucher: 'bis_1000',
  struktur: 'gemischt',
  verhalten: 'gering',
  witterung: 'gemaessigt',
  dauer: 'bis_4h',
  flaeche: 'gut',
  gefaehrdetePersonen: false,
};
