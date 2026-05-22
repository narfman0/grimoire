// Phase 2a: overlay HP pools. Locks the derive() contract for the
// `overlay-hp-pool` modifier shape — declares pool existence, max,
// and refresh policy. Pool current values are encounter-runtime state.

import { describe, it, expect, beforeAll } from 'vitest';
import { derive } from '../derive';
import { loadAllPacks } from './setup/load-packs';
import * as chronurgy from './fixtures/tortle-chronurgy-wizard';
import type { CharacterDocument, ContentRow } from '../types';

let PACKS: Map<string, ContentRow>;

beforeAll(() => {
  PACKS = loadAllPacks();
});

function withFeat(slug: string): CharacterDocument {
  return {
    ...chronurgy.CHARACTER,
    feats: [...chronurgy.CHARACTER.feats, { kind: 'feat', slug, version: 1 }]
  };
}

function fakeFeat(slug: string, name: string, modifiers: Array<Record<string, unknown>>): ContentRow {
  return {
    kind: 'feat',
    slug,
    version: 1,
    name,
    source: 'test',
    data: { modifiers }
  };
}

function wrapLookup(extras: Record<string, ContentRow>) {
  const base = chronurgy.makeLookup(PACKS);
  return (ref: { kind: string; slug: string; version?: number }) =>
    extras[`${ref.kind}/${ref.slug}`] ?? base(ref);
}

describe('derive() overlay HP pools', () => {
  it('emits a numeric pool from a literal max', () => {
    const feat = fakeFeat('test-overlay-literal', 'Test Overlay (Literal)', [
      { kind: 'overlay-hp-pool', name: 'Test Ward', max: 10, refreshOn: 'long-rest' }
    ]);
    const d = derive(withFeat('test-overlay-literal'), wrapLookup({ 'feat/test-overlay-literal': feat }));
    expect(d.overlayHpPools.length).toBe(1);
    expect(d.overlayHpPools[0].max).toBe(10);
    expect(d.overlayHpPools[0].refreshOn).toBe('long-rest');
    expect(d.overlayHpPools[0].name).toBe('Test Ward');
  });

  it('evaluates an arithmetic formula against the character context (Arcane Ward shape)', () => {
    // Wizard L10, INT mod 5 → 2 × 10 + 5 = 25 (literal Arcane Ward shape).
    const feat = fakeFeat('test-overlay-arcane', 'Test Arcane Ward', [
      {
        kind: 'overlay-hp-pool',
        name: 'Arcane Ward',
        max: '2 * wizardLevel + intMod',
        refreshOn: 'manual'
      }
    ]);
    const d = derive(withFeat('test-overlay-arcane'), wrapLookup({ 'feat/test-overlay-arcane': feat }));
    expect(d.overlayHpPools.length).toBe(1);
    expect(d.overlayHpPools[0].max).toBe(25);
    expect(d.overlayHpPools[0].refreshOn).toBe('manual');
  });

  it('defaults refreshOn to long-rest when unspecified or unknown', () => {
    const feat = fakeFeat('test-overlay-default', 'Test Default Refresh', [
      { kind: 'overlay-hp-pool', name: 'Defaulted', max: 5 }
    ]);
    const d = derive(withFeat('test-overlay-default'), wrapLookup({ 'feat/test-overlay-default': feat }));
    expect(d.overlayHpPools[0].refreshOn).toBe('long-rest');
  });

  it('warns when max does not evaluate to a number', () => {
    const feat = fakeFeat('test-overlay-bad-max', 'Bad Max', [
      { kind: 'overlay-hp-pool', name: 'Broken', max: 'gibberish' }
    ]);
    const d = derive(withFeat('test-overlay-bad-max'), wrapLookup({ 'feat/test-overlay-bad-max': feat }));
    expect(d.overlayHpPools.length).toBe(0);
    expect(
      d.validations.some((v) => v.code === 'overlay-hp-pool-non-numeric-max')
    ).toBe(true);
  });

  it('floors fractional max to an integer and clamps negatives to zero', () => {
    const featFrac = fakeFeat('test-overlay-frac', 'Frac', [
      { kind: 'overlay-hp-pool', max: '7 / 2' }
    ]);
    const featNeg = fakeFeat('test-overlay-neg', 'Neg', [
      { kind: 'overlay-hp-pool', max: -5 }
    ]);
    const dFrac = derive(withFeat('test-overlay-frac'), wrapLookup({ 'feat/test-overlay-frac': featFrac }));
    const dNeg = derive(withFeat('test-overlay-neg'), wrapLookup({ 'feat/test-overlay-neg': featNeg }));
    expect(dFrac.overlayHpPools[0].max).toBe(3); // floor(3.5)
    expect(dNeg.overlayHpPools[0].max).toBe(0);
  });

  it('preserves sourceContent so the runtime can attribute the pool', () => {
    const feat = fakeFeat('test-overlay-attribution', 'Attributed', [
      { kind: 'overlay-hp-pool', max: 1 }
    ]);
    const d = derive(
      withFeat('test-overlay-attribution'),
      wrapLookup({ 'feat/test-overlay-attribution': feat })
    );
    expect(d.overlayHpPools[0].sourceContent).toEqual({
      kind: 'feat',
      slug: 'test-overlay-attribution'
    });
  });

  it('emits no overlay pools when the character has no overlay-hp-pool modifiers', () => {
    const d = derive(chronurgy.CHARACTER, chronurgy.makeLookup(PACKS));
    expect(d.overlayHpPools).toEqual([]);
  });
});
