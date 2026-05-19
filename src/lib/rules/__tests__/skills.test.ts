import { describe, it, expect } from 'vitest';
import { SKILLS, SKILL_ABILITY } from '../skills';

// The 18-skill list is referenced by every editor that asks the user to
// pick proficiencies, plus the derived stats projection. Pin both the
// shape and the canonical ability mapping.
describe('SKILLS / SKILL_ABILITY', () => {
  it('lists exactly the 18 5e skills as kebab-case', () => {
    expect(SKILLS.length).toBe(18);
    expect(SKILLS).toContain('animal-handling');
    expect(SKILLS).toContain('sleight-of-hand');
    expect(SKILLS).toContain('athletics');
  });

  it('every SKILLS entry has a matching SKILL_ABILITY mapping', () => {
    for (const skill of SKILLS) {
      expect(SKILL_ABILITY[skill]).toBeDefined();
      expect(['str', 'dex', 'con', 'int', 'wis', 'cha']).toContain(
        SKILL_ABILITY[skill]
      );
    }
  });

  it('canonical mappings match 5e: athletics→str, perception→wis, persuasion→cha', () => {
    expect(SKILL_ABILITY['athletics']).toBe('str');
    expect(SKILL_ABILITY['perception']).toBe('wis');
    expect(SKILL_ABILITY['persuasion']).toBe('cha');
    expect(SKILL_ABILITY['arcana']).toBe('int');
    expect(SKILL_ABILITY['acrobatics']).toBe('dex');
  });
});
