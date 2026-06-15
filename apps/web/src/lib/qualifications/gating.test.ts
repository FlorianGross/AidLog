/**
 * Unit tests for the qualification-dependent documentation gating (the soft,
 * read-only section gate used by SectionForm). Pure logic, no DOM.
 */
import { describe, it, expect } from 'vitest';
import { meetsQualification, qualificationRank } from './index';

describe('meetsQualification (soft section gate)', () => {
  it('is permissive when the section has no requirement', () => {
    // No minQualification → editable by anyone, incl. an unset user.
    expect(meetsQualification(null, null)).toBe(true);
    expect(meetsQualification(undefined, undefined)).toBe(true);
    expect(meetsQualification('sanh', null)).toBe(true);
  });

  it('gates an under-qualified or unset user out of a required section', () => {
    expect(meetsQualification(null, 'san')).toBe(false);
    expect(meetsQualification(undefined, 'san')).toBe(false);
    expect(meetsQualification('sanh', 'san')).toBe(false);
  });

  it('admits a user whose rank meets or exceeds the requirement', () => {
    expect(meetsQualification('san', 'san')).toBe(true); // exactly meets
    expect(meetsQualification('rs', 'san')).toBe(true); // exceeds
    expect(meetsQualification('arzt', 'sanh')).toBe(true);
  });

  it('agrees with qualificationRank ordering', () => {
    expect(meetsQualification('notsan', 'arzt')).toBe(
      qualificationRank('notsan') >= qualificationRank('arzt'),
    );
    expect(meetsQualification('arzt', 'notsan')).toBe(true);
  });
});
