/**
 * i18n structural-parity & per-key-fallback tests.
 *
 * German (de) is the source of truth. Every other locale must:
 *  - never introduce a key path that de does not have (no orphan keys), and
 *  - for the fully-authored locales (tr/ar/ru/uk/fr) provide EVERY key de has,
 *    so nothing silently falls back. (en is intentionally partial and only
 *    checked for "no orphan keys" + that fallback covers its gaps.)
 *
 * It also asserts the per-key de-fallback: a partial locale resolves missing
 * keys to the German string, and de/en still resolve exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { de } from './de';
import { en } from './en';
import { tr } from './tr';
import { ar } from './ar';
import { ru } from './ru';
import { uk } from './uk';
import { fr } from './fr';
import { translate, SUPPORTED_LOCALES, LOCALE_NAMES, dirFor, type Locale } from './index';

type Dict = Record<string, unknown>;

/** All dotted key paths whose leaf is a string. */
function leafPaths(obj: Dict, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') out.push(...leafPaths(v as Dict, path));
    else out.push(path);
  }
  return out;
}

const dePaths = new Set(leafPaths(de as unknown as Dict));

const fullyAuthored: Record<string, Dict> = {
  tr: tr as Dict,
  ar: ar as Dict,
  ru: ru as Dict,
  uk: uk as Dict,
  fr: fr as Dict,
};

const allLocales: Record<string, Dict> = { en: en as unknown as Dict, ...fullyAuthored };

describe('i18n locale registry', () => {
  it('declares 7 locales each with a native name', () => {
    expect(SUPPORTED_LOCALES).toEqual(['de', 'en', 'tr', 'ar', 'ru', 'uk', 'fr']);
    for (const loc of SUPPORTED_LOCALES) {
      expect(LOCALE_NAMES[loc]).toBeTruthy();
    }
  });

  it('marks only Arabic as RTL', () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(dirFor(loc)).toBe(loc === 'ar' ? 'rtl' : 'ltr');
    }
  });
});

describe('no locale introduces keys German lacks', () => {
  for (const [name, dict] of Object.entries(allLocales)) {
    it(`${name} has no orphan keys`, () => {
      const orphans = leafPaths(dict).filter((p) => !dePaths.has(p));
      expect(orphans).toEqual([]);
    });
  }
});

describe('fully-authored locales have structural parity with de', () => {
  for (const [name, dict] of Object.entries(fullyAuthored)) {
    it(`${name} provides every de key`, () => {
      const have = new Set(leafPaths(dict));
      const missing = [...dePaths].filter((p) => !have.has(p));
      expect(missing).toEqual([]);
    });
  }
});

describe('per-key de-fallback', () => {
  it('falls back to German for a key missing in a partial locale (en)', () => {
    // `app.name` is not authored in en.ts → must resolve to the de value.
    expect(translate('en', 'app.name')).toBe(de.app.name);
    // …but an authored en key uses the English string.
    expect(translate('en', 'training.badge')).toBe('TRAINING');
  });

  it('keeps de resolving to itself and unknown keys to the raw key', () => {
    expect(translate('de', 'common.save')).toBe('Speichern');
    expect(translate('de', 'does.not.exist')).toBe('does.not.exist');
  });

  it('interpolates params in every locale', () => {
    for (const loc of SUPPORTED_LOCALES) {
      const out = translate(loc as Locale, 'dashboard.welcome', { name: 'Sam' });
      expect(out).toContain('Sam');
    }
  });

  it('a fully-authored locale uses its own string, not German', () => {
    expect(translate('fr', 'common.save')).toBe('Enregistrer');
    expect(translate('ar', 'common.save')).toBe('حفظ');
  });
});
