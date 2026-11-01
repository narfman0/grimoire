// Relentless Rage (SRD 5.2, Barbarian 11): on a successful CON save after
// dropping to 0 HP while raging, HP becomes 2 × barbarian level. The pack
// row used to carry the 2014 rule (drop to 1 HP, no set-hp grant at all),
// so the sheet could never offer it as a saver.

import { describe, it, expect } from 'vitest';
import { derive } from '../derive';
import { planSheetDamage } from '../sheet-damage';
import { loadAllPacks } from './setup/load-packs';
import * as zealot from './fixtures/half-orc-zealot-barbarian';
import type { CharacterDocument } from '../types';

const PACKS = loadAllPacks();
const lookup = zealot.makeLookup(PACKS);

function barbarian(level: number): CharacterDocument {
  const base = structuredClone(zealot.CHARACTER);
  base.classes = [
    {
      ...base.classes[0],
      level,
      hpRolledPerLevel: [12, ...Array.from({ length: level - 1 }, () => 7)]
    }
  ];
  return base;
}

describe('Relentless Rage (SRD 5.2)', () => {
  it('resolves its set-hp grant to 2 × barbarian level at level 11', () => {
    const d = derive(barbarian(11), lookup);
    const rr = d.triggers.find((t) => t.id === 'relentless-rage-save');
    expect(rr).toBeDefined();
    expect(rr!.on).toContain('damage.reduce-to-zero');
    expect(rr!.grants).toMatchObject({ type: 'set-hp', value: 22 });
    expect(rr!.grants).toMatchObject({ save: { ability: 'con', dc: { base: 10 } } });
  });

  it('scales to 30 HP at level 15', () => {
    const d = derive(barbarian(15), lookup);
    const rr = d.triggers.find((t) => t.id === 'relentless-rage-save');
    expect(rr!.grants).toMatchObject({ type: 'set-hp', value: 30 });
  });

  it('is not present below level 11', () => {
    const d = derive(barbarian(10), lookup);
    expect(d.triggers.find((t) => t.id === 'relentless-rage-save')).toBeUndefined();
  });

  it('is offered as a save-gated saver on the sheet while raging', () => {
    const c = barbarian(11);
    const d = derive(c, lookup);
    const ctx = {
      stats: d.stats,
      triggers: d.triggers,
      resources: d.resources
    };
    const plan = planSheetDamage({ ...c, currentHp: 5, tempHp: 0 }, 50, null, ctx);
    expect(plan.dropsToZero).toBe(true);
    const rr = plan.savers.find((s) => s.triggerId === 'relentless-rage-save');
    expect(rr).toMatchObject({ setHpTo: 22, save: { ability: 'con', dc: 10 } });

    // Not raging → not offered.
    const calm = planSheetDamage({ ...c, currentHp: 5, tempHp: 0, conditions: [] }, 50, null, ctx);
    expect(calm.savers.find((s) => s.triggerId === 'relentless-rage-save')).toBeUndefined();
  });
});
