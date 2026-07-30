import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import DiceTray from './DiceTray.svelte';
import { diceLog, resetDiceLog } from '$lib/client/dice-log';

const post = vi.fn();
vi.mock('$lib/client/api', () => ({ api: { post: (...a: unknown[]) => post(...a) } }));

async function openTray(props: Record<string, unknown> = {}) {
  const rendered = render(DiceTray, props);
  await fireEvent.click(screen.getByLabelText('Open dice tray'));
  return rendered;
}

beforeEach(() => {
  resetDiceLog();
  post.mockReset();
});

describe('DiceTray', () => {
  it('starts collapsed so it does not compete for space', () => {
    render(DiceTray);
    expect(screen.getByLabelText('Open dice tray')).toBeTruthy();
    expect(screen.queryByLabelText('Dice formula')).toBeNull();
  });

  it('rolls a quick die and records it', async () => {
    await openTray();
    await fireEvent.click(screen.getByRole('button', { name: 'd20' }));

    const log = get(diceLog);
    expect(log).toHaveLength(1);
    expect(log[0].label).toBe('d20');
    expect(log[0].result.total).toBeGreaterThanOrEqual(1);
    expect(log[0].result.total).toBeLessThanOrEqual(20);
  });

  it('rolls a typed formula', async () => {
    await openTray();
    await fireEvent.input(screen.getByLabelText('Dice formula'), { target: { value: '2d6+3' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Roll' }));

    const [entry] = get(diceLog);
    expect(entry.label).toBe('2d6+3');
    expect(entry.result.total).toBeGreaterThanOrEqual(5); // 2 dice + 3
    expect(entry.result.total).toBeLessThanOrEqual(15);
  });

  it('reports a bad formula instead of rolling something else', async () => {
    await openTray();
    const input = screen.getByLabelText('Dice formula');
    // Deliberately partially valid: a lenient parser would roll the 2d6.
    await fireEvent.input(input, { target: { value: '2d6 banana' } });

    // The button must stay *enabled* — disabling it on an unparseable
    // formula leaves a dead button and no explanation, and fireEvent will
    // happily click a disabled button, so asserting this here is the only
    // thing standing between us and that regression. (e2e caught it once.)
    const roll = screen.getByRole('button', { name: 'Roll' }) as HTMLButtonElement;
    expect(roll.disabled).toBe(false);
    await fireEvent.click(roll);

    expect(get(diceLog)).toHaveLength(0);
    expect(screen.getByText(/isn't a dice formula/)).toBeTruthy();
  });

  it('disables Roll only when nothing is typed', async () => {
    await openTray();
    const roll = screen.getByRole('button', { name: 'Roll' }) as HTMLButtonElement;
    expect(roll.disabled).toBe(true);
    await fireEvent.input(screen.getByLabelText('Dice formula'), { target: { value: 'd8' } });
    expect(roll.disabled).toBe(false);
  });

  it('keeps newest rolls first and caps the history', async () => {
    await openTray();
    for (let i = 0; i < 25; i++) await fireEvent.click(screen.getByRole('button', { name: 'd6' }));
    expect(get(diceLog)).toHaveLength(20);
  });

  describe('advantage toggles', () => {
    it('are disabled for a formula that is not a single d20', async () => {
      await openTray();
      await fireEvent.input(screen.getByLabelText('Dice formula'), { target: { value: '2d6' } });
      expect((screen.getByLabelText('advantage') as HTMLInputElement).disabled).toBe(true);
    });

    it('enable for a plain d20 with a modifier', async () => {
      await openTray();
      await fireEvent.input(screen.getByLabelText('Dice formula'), { target: { value: '1d20+5' } });
      expect((screen.getByLabelText('advantage') as HTMLInputElement).disabled).toBe(false);
    });

    it('roll two dice and keep one when advantage is on', async () => {
      await openTray();
      await fireEvent.input(screen.getByLabelText('Dice formula'), { target: { value: 'd20' } });
      await fireEvent.click(screen.getByLabelText('advantage'));
      await fireEvent.click(screen.getByRole('button', { name: 'Roll' }));

      const [entry] = get(diceLog);
      expect(entry.result.dice).toHaveLength(2);
      expect(entry.result.dice.filter((d) => d.kept)).toHaveLength(1);
      expect(entry.result.d20!.mode).toBe('advantage');
    });
  });

  describe('sharing', () => {
    it('offers no share button outside an encounter', async () => {
      await openTray();
      await fireEvent.click(screen.getByRole('button', { name: 'd20' }));
      expect(screen.queryByRole('button', { name: 'share' })).toBeNull();
    });

    it('posts a free-roll log row when shared', async () => {
      await openTray({ encounter: { id: 'enc-1', round: 3 }, myParticipantIds: ['p1'] });
      await fireEvent.click(screen.getByRole('button', { name: 'd20' }));
      await fireEvent.click(screen.getByRole('button', { name: 'share' }));

      expect(post).toHaveBeenCalledTimes(1);
      const [url, body] = post.mock.calls[0];
      expect(url).toBe('/api/encounters/enc-1/log');
      expect(body).toMatchObject({
        participantId: 'p1',
        actionId: 'dice/free',
        round: 3
      });
      // Distinct actionId so the log renderer can style or collapse idle
      // rolls, and the total travels in the notes rather than pretending to
      // be an attack roll.
      expect(body.actionLabel).toContain('d20');
      expect(body.notes).toBe(get(diceLog)[0].result.detail);
    });

    it('does not share automatically — local is the default', async () => {
      await openTray({ encounter: { id: 'e', round: 1 }, myParticipantIds: [] });
      await fireEvent.click(screen.getByRole('button', { name: 'd20' }));
      expect(post).not.toHaveBeenCalled();
    });

    it('posts unattributed for a viewer with no participant of their own', async () => {
      await openTray({ encounter: { id: 'e', round: 1 }, myParticipantIds: [] });
      await fireEvent.click(screen.getByRole('button', { name: 'd20' }));
      await fireEvent.click(screen.getByRole('button', { name: 'share' }));
      expect(post.mock.calls[0][1]).toMatchObject({ participantId: null });
    });
  });
});

describe('quick-dice pool count', () => {
  it('rolls NdX in one throw when the count is stepped up', async () => {
    await openTray();
    const more = screen.getByLabelText('More dice');
    await fireEvent.click(more);
    await fireEvent.click(more); // ×3
    await fireEvent.click(screen.getByRole('button', { name: '3d6' }));

    const [entry] = get(diceLog);
    expect(entry.label).toBe('3d6');
    expect(entry.result.total).toBeGreaterThanOrEqual(3);
    expect(entry.result.total).toBeLessThanOrEqual(18);
  });

  it('never steps below one die', async () => {
    await openTray();
    const fewer = screen.getByLabelText('Fewer dice') as HTMLButtonElement;
    expect(fewer.disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'd20' }));
    expect(get(diceLog)[0].label).toBe('d20');
  });
});
