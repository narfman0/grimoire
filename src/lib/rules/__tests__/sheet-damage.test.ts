// Sheet HP-box damage: resistances, Relentless Endurance, and the 0 HP
// knockout. Regressions from the Ogila usability walk: the sheet ignored
// Rage's resistances, never offered Relentless Endurance, and left Rage
// running on an unconscious barbarian.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as zealot from './fixtures/half-orc-zealot-barbarian';
import { applySheetDamage, planSheetDamage, reviveFromZero } from '../sheet-damage';
import type { CharacterDocument, ContentRow, Derived } from '../types';

let PACKS: Map<string, ContentRow>;
beforeAll(() => {
  PACKS = loadAllPacks();
});

function setup(patch: Partial<CharacterDocument> = {}) {
  const doc: CharacterDocument = structuredClone({ ...zealot.CHARACTER, ...patch });
  const d: Derived = derive(doc, zealot.makeLookup(PACKS));
  const ctx = {
    stats: d.stats,
    triggers: d.triggers,
    resources: d.resources,
    availableActivations: d.availableActivations,
    equipped: d.equipped
  };
  return { doc, d, ctx };
}

describe('planSheetDamage', () => {
  it('halves typed damage the character resists (raging vs slashing)', () => {
    const { doc, ctx } = setup({ conditions: ['rage'], currentHp: 30 });
    const plan = planSheetDamage(doc, 11, 'slashing', ctx);
    expect(plan.amount).toBe(5);
    expect(plan.hpAfter).toBe(25);
  });

  it('applies untyped damage in full', () => {
    const { doc, ctx } = setup({ conditions: ['rage'], currentHp: 30 });
    expect(planSheetDamage(doc, 11, null, ctx).amount).toBe(11);
  });

  it('offers Relentless Endurance when a hit drops the character to 0', () => {
    const { doc, ctx } = setup({ conditions: [], currentHp: 5 });
    const plan = planSheetDamage(doc, 20, null, ctx);
    expect(plan.dropsToZero).toBe(true);
    const saver = plan.savers.find((s) => s.name.includes('Relentless Endurance'));
    expect(saver).toBeDefined();
    expect(saver!.setHpTo).toBe(1);
  });

  it('does not offer Relentless Endurance once its use is spent', () => {
    const fresh = setup({ conditions: [], currentHp: 5 });
    const saver = planSheetDamage(fresh.doc, 20, null, fresh.ctx).savers[0];
    const { doc, ctx } = setup({
      conditions: [],
      currentHp: 5,
      resourcesSpent: { [saver.resourceId!]: 1 }
    });
    expect(planSheetDamage(doc, 20, null, ctx).savers).toEqual([]);
  });

  it('offers nothing when the hit leaves the character standing', () => {
    const { doc, ctx } = setup({ conditions: [], currentHp: 30 });
    expect(planSheetDamage(doc, 10, null, ctx).savers).toEqual([]);
  });
});

describe('applySheetDamage', () => {
  it('spending Relentless Endurance leaves the character at 1 HP and debits the pool', () => {
    const { doc, ctx } = setup({ conditions: [], currentHp: 5 });
    const plan = planSheetDamage(doc, 20, null, ctx);
    applySheetDamage(doc, plan, plan.savers[0], ctx);
    expect(doc.currentHp).toBe(1);
    expect(doc.resourcesSpent?.[plan.savers[0].resourceId!]).toBe(1);
    expect(doc.conditions).not.toContain('unconscious');
  });

  it('dropping to 0 knocks the character unconscious and ends Rage', () => {
    const { doc, ctx } = setup({
      conditions: ['rage'],
      currentHp: 5,
      activations: { rage: { active: true, usesRemaining: 2 } }
    });
    const plan = planSheetDamage(doc, 99, null, ctx);
    applySheetDamage(doc, plan, null, ctx);
    expect(doc.currentHp).toBe(0);
    expect(doc.conditions).toContain('unconscious');
    expect(doc.conditions).not.toContain('rage');
    expect(doc.activations?.rage?.active).toBe(false);
    expect(doc.deathSaves).toEqual({ successes: 0, failures: 0 });
  });

  it('reviveFromZero clears the knockout after healing', () => {
    const { doc, ctx } = setup({ conditions: [], currentHp: 5 });
    applySheetDamage(doc, planSheetDamage(doc, 99, null, ctx), null, ctx);
    doc.currentHp = 4;
    reviveFromZero(doc);
    expect(doc.conditions).not.toContain('unconscious');
    expect(doc.deathSaves).toBeUndefined();
  });
});
