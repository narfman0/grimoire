import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import EncounterDifficultyPanel, { type DifficultyReadout } from './EncounterDifficultyPanel.svelte';
import type { DifficultyRating } from '$lib/rules/encounter-difficulty';

/** A level-1 four-person party's thresholds (2014 DMG). */
const THRESHOLDS = { easy: 100, medium: 200, hard: 300, deadly: 400 };

function readout(over: Partial<DifficultyReadout> = {}): DifficultyReadout {
  return {
    edition: '2014',
    partySize: 4,
    partyLevels: [1, 1, 1, 1],
    monsterCount: 2,
    baseXp: 100,
    xpPerCharacter: 25,
    multiplier: 1.5,
    adjustedXp: 150,
    thresholds: THRESHOLDS,
    rating: 'easy',
    unrated: [],
    ...over
  };
}

/** Markup wraps at will; compare on collapsed whitespace. */
function norm(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('EncounterDifficultyPanel', () => {
  it('shows a loading line until the first readout arrives', () => {
    const { getByText } = render(EncounterDifficultyPanel, {
      props: { difficulty: null, loading: true }
    });
    expect(getByText('Rating encounter…')).not.toBeNull();
  });

  it('says so when the fetch produced nothing', () => {
    const { getByText } = render(EncounterDifficultyPanel, {
      props: { difficulty: null, loading: false }
    });
    expect(getByText('Difficulty unavailable.')).not.toBeNull();
  });

  // Each band gets its own chip palette; a refactor that collapsed deadly
  // into medium would read as a much softer encounter than it is.
  const BAND_PALETTE: Record<Exclude<DifficultyRating, 'unknown'>, RegExp> = {
    trivial: /slate/,
    easy: /emerald/,
    medium: /amber/,
    hard: /orange/,
    deadly: /red/
  };

  for (const [band, palette] of Object.entries(BAND_PALETTE)) {
    it(`renders the ${band} band with its chip palette and the XP math`, () => {
      const { getByTestId } = render(EncounterDifficultyPanel, {
        props: { difficulty: readout({ rating: band as DifficultyRating }) }
      });
      const chip = getByTestId('difficulty-band');
      expect(chip.textContent?.trim()).toBe(band);
      expect(chip.className).toMatch(palette);
      const panel = norm(getByTestId('difficulty-readout'));
      expect(panel).toContain('150 adjusted XP');
      expect(panel).toContain('(100 XP × 1.5 for 2 monsters)');
    });
  }

  it('marks the thresholds the adjusted XP has cleared', () => {
    const { getByTitle } = render(EncounterDifficultyPanel, {
      props: { difficulty: readout({ rating: 'easy', adjustedXp: 250 }) }
    });
    // 250 clears easy (100) and medium (200), not hard (300) or deadly (400).
    expect(getByTitle('Cleared the easy threshold')).not.toBeNull();
    expect(getByTitle('Cleared the medium threshold')).not.toBeNull();
    expect(getByTitle('hard threshold').className).toMatch(/text-slate-500/);
    expect(getByTitle('deadly threshold').className).toMatch(/text-slate-500/);
  });

  // `rating: 'unknown'` means no PCs are linked, so there are no thresholds
  // to band against. Zeroed thresholds would render as "everything is
  // deadly" — the panel must refuse to band instead.
  it('refuses to band an empty party and says what to do about it', () => {
    const { getByText, queryByTestId, getByTestId } = render(EncounterDifficultyPanel, {
      props: {
        difficulty: readout({
          rating: 'unknown',
          partySize: 0,
          partyLevels: [],
          thresholds: { easy: 0, medium: 0, hard: 0, deadly: 0 }
        })
      }
    });
    expect(queryByTestId('difficulty-band')).toBeNull();
    expect(getByText('No party linked')).not.toBeNull();
    // The XP that IS on the board still shows — it's the only usable number.
    expect(norm(getByTestId('difficulty-readout'))).toContain('100 XP on the board');
  });

  it('does not band an empty roster even when the rating is trivial', () => {
    const { getByText, queryByTestId, getByTestId } = render(EncounterDifficultyPanel, {
      props: {
        difficulty: readout({
          rating: 'trivial',
          monsterCount: 0,
          baseXp: 0,
          adjustedXp: 0,
          xpPerCharacter: 0
        })
      }
    });
    expect(queryByTestId('difficulty-band')).toBeNull();
    expect(getByText('No monsters yet')).not.toBeNull();
    // The party summary still renders — 4 PCs at level 1.
    expect(norm(getByTestId('difficulty-readout'))).toContain('4 PCs, avg L1.0');
  });

  it('averages a mixed-level party for the threshold summary', () => {
    const { getByTestId } = render(EncounterDifficultyPanel, {
      props: { difficulty: readout({ partySize: 4, partyLevels: [1, 2, 3, 4] }) }
    });
    expect(norm(getByTestId('difficulty-readout'))).toContain('avg L2.5');
  });

  // A monster with no CR and no XP contributes 0 XP but still drives the
  // multiplier, so the band reads low. The panel names the offenders rather
  // than showing a confident number over them.
  it('warns about unrated creatures by name', () => {
    const { getByTestId } = render(EncounterDifficultyPanel, {
      props: { difficulty: readout({ unrated: ['Mystery Blob', 'Captured Noble'] }) }
    });
    const warning = norm(getByTestId('difficulty-unrated'));
    expect(warning).toContain('no CR or XP for 2 creatures');
    expect(warning).toContain('Mystery Blob, Captured Noble');
    expect(warning).toContain('the real difficulty is higher than shown');
  });

  it('singularises the unrated warning for one creature', () => {
    const { getByTestId } = render(EncounterDifficultyPanel, {
      props: { difficulty: readout({ unrated: ['Mystery Blob'] }) }
    });
    expect(norm(getByTestId('difficulty-unrated'))).toContain('no CR or XP for 1 creature:');
  });

  it('renders no warning when everything is priced', () => {
    const { queryByTestId } = render(EncounterDifficultyPanel, {
      props: { difficulty: readout() }
    });
    expect(queryByTestId('difficulty-unrated')).toBeNull();
  });
});
