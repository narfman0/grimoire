import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import RandomTableRoller from './RandomTableRoller.svelte';
import { diceLog, resetDiceLog } from '$lib/client/dice-log';

const SURGE = {
  die: '1d4',
  label: 'Wild Magic Surge',
  entries: [
    { min: 1, max: 2, label: 'Nothing happens', description: 'A brief shimmer.' },
    { min: 3, max: 4, label: 'Fireball centred on you' }
  ]
};

beforeEach(() => resetDiceLog());

describe('RandomTableRoller', () => {
  it('rolls once and shows the matching row', async () => {
    render(RandomTableRoller, { table: SURGE, sourceLabel: 'Wild Magic' });
    await fireEvent.click(screen.getByRole('button', { name: /Roll/ }));

    const [entry] = get(diceLog);
    expect(entry.label).toBe('Wild Magic (1d4)');
    const matched = SURGE.entries.find(
      (e) => entry.result.total >= e.min && entry.result.total <= e.max
    )!;
    expect(screen.getByText(matched.label)).toBeTruthy();
  });

  it('rolls twice and waits for a choice when rollTwiceChoose is set', async () => {
    // Controlled Chaos grants a *choice*; resolving it automatically would be
    // a different (and stronger) feature.
    render(RandomTableRoller, {
      table: { ...SURGE, rollTwiceChoose: true },
      sourceLabel: 'Controlled Chaos'
    });
    await fireEvent.click(screen.getByRole('button', { name: /Roll twice/ }));

    expect(get(diceLog)).toHaveLength(2);
    expect(screen.getByText('Pick which result to use.')).toBeTruthy();

    await fireEvent.click(screen.getAllByRole('button', { name: 'use this' })[0]);
    expect(screen.queryByText('Pick which result to use.')).toBeNull();
  });

  it('reports a roll that falls outside every row rather than silently picking one', async () => {
    render(RandomTableRoller, {
      table: { die: '1d4', entries: [{ min: 1, max: 1, label: 'Only one row' }] }
    });
    for (let i = 0; i < 30; i++) {
      await fireEvent.click(screen.getByRole('button', { name: /Roll/ }));
      const total = get(diceLog)[0].result.total;
      if (total > 1) {
        expect(screen.getByText('no matching row')).toBeTruthy();
        return;
      }
    }
    throw new Error('never rolled outside the single row in 30 attempts');
  });
});
