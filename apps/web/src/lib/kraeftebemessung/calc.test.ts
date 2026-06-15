/**
 * calc.test.ts — Kräftebemessung (Kölner Algorithmus / Maurer-Schema).
 *
 * Prüft die Punktevergabe und die Abbildung Score → Empfehlungsstufe an
 * repräsentativen Szenarien. Die Berechnung ist pur (deterministisch).
 */
import { describe, it, expect } from 'vitest';
import {
  berechneKraefte,
  stufeFuerScore,
  DEFAULT_INPUT,
  EMPFEHLUNGS_TABELLE,
  type KraefteInput,
} from './calc';

describe('berechneKraefte', () => {
  it('kleines ruhiges Fest → niedriger Score, Stufe "gering"', () => {
    // alle minimalen Parameter: 1+1+1+0+0+0+0+0 = 3
    const res = berechneKraefte(DEFAULT_INPUT);
    expect(res.score).toBe(3);
    expect(res.empfehlung.stufe).toBe('gering');
    expect(res.empfehlung.sanitaeter).toBe(2);
    expect(res.empfehlung.arztbesetzteMittel).toBe(0);
  });

  it('mittelgroße Sportveranstaltung → Stufe "erhoeht"', () => {
    const input: KraefteInput = {
      veranstaltungsart: 'sport_publikum', // 3
      besucher: 'bis_5000', // 3
      struktur: 'familien_kinder', // 2
      verhalten: 'maessig', // 2
      witterung: 'gemaessigt', // 0
      dauer: 'bis_8h', // 1
      flaeche: 'mittel', // 2
      gefaehrdetePersonen: false, // 0
    };
    const res = berechneKraefte(input);
    expect(res.score).toBe(13);
    expect(res.empfehlung.stufe).toBe('erhoeht');
    expect(res.empfehlung.rettungsmittel).toBe(1);
  });

  it('großes Festival mit hohem Risiko → Stufe "sehr_hoch"', () => {
    const input: KraefteInput = {
      veranstaltungsart: 'grossveranstaltung_risiko', // 8
      besucher: 'ueber_50000', // 12
      struktur: 'jugendlich', // 3
      verhalten: 'hoch', // 4
      witterung: 'hitze', // 3
      dauer: 'mehrtaegig', // 4
      flaeche: 'schlecht', // 4
      gefaehrdetePersonen: true, // 3
    };
    const res = berechneKraefte(input);
    expect(res.score).toBe(41);
    expect(res.empfehlung.stufe).toBe('sehr_hoch');
    expect(res.empfehlung.sanitaeter).toBe(16);
    expect(res.empfehlung.arztbesetzteMittel).toBe(2);
  });

  it('Aufschlüsselung enthält jede Eingabe-Position und summiert auf den Score', () => {
    const res = berechneKraefte(DEFAULT_INPUT);
    expect(res.positionen).toHaveLength(8);
    const summe = res.positionen.reduce((s, p) => s + p.punkte, 0);
    expect(summe).toBe(res.score);
  });

  it('ist deterministisch (gleiche Eingabe → gleiche Ausgabe)', () => {
    expect(berechneKraefte(DEFAULT_INPUT)).toEqual(berechneKraefte(DEFAULT_INPUT));
  });
});

describe('stufeFuerScore', () => {
  it('wählt die höchste Stufe, deren minScore erreicht ist', () => {
    expect(stufeFuerScore(0).stufe).toBe('gering');
    expect(stufeFuerScore(9).stufe).toBe('gering');
    expect(stufeFuerScore(10).stufe).toBe('erhoeht');
    expect(stufeFuerScore(18).stufe).toBe('hoch');
    expect(stufeFuerScore(28).stufe).toBe('sehr_hoch');
    expect(stufeFuerScore(1000).stufe).toBe('sehr_hoch');
  });

  it('Schwellen sind streng aufsteigend', () => {
    for (let i = 1; i < EMPFEHLUNGS_TABELLE.length; i++) {
      expect(EMPFEHLUNGS_TABELLE[i]!.minScore).toBeGreaterThan(
        EMPFEHLUNGS_TABELLE[i - 1]!.minScore,
      );
    }
  });
});
