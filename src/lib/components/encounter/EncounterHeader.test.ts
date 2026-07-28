import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import EncounterHeader from './EncounterHeader.svelte';

const baseProps = {
  name: 'Goblin Ambush',
  role: 'dm' as const,
  busy: false,
  connStatus: 'open' as const,
  status: 'live',
  totalXp: 0,
  xpPerChar: 0,
  party: { size: 3, avgLevel: 2 },
  participantCount: 4,
  encountersHref: '/c/ABCD/encounters'
};

function renderHeader(props: Partial<typeof baseProps> & { renaming?: boolean } = {}) {
  const onRename = vi.fn();
  const utils = render(EncounterHeader, {
    props: { ...baseProps, ...props },
    events: { rename: (e: CustomEvent<string>) => onRename(e.detail) }
  });
  return { ...utils, onRename };
}

describe('EncounterHeader rename', () => {
  // Regression: `save` fires blur *then* click, and the parent can't dedupe
  // (its `trimmed === encounterName` guard only closes after the first PATCH
  // resolves) — so one click sent two PATCHes.
  it('sends one rename when the DM clicks save', async () => {
    const user = userEvent.setup();
    const { container, getByRole, onRename } = renderHeader({ renaming: true });
    const input = container.querySelector('input') as HTMLInputElement;
    await user.click(input);
    await user.clear(input);
    await user.type(input, 'Kobold Ambush');
    await user.click(getByRole('button', { name: 'save' }));
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('Kobold Ambush');
  });

  it('sends one rename when the DM presses Enter and the input then blurs', async () => {
    const { container, onRename } = renderHeader({ renaming: true });
    const input = container.querySelector('input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Renamed' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('Renamed');
  });

  it('still saves on a bare blur (click-away)', async () => {
    const { container, onRename } = renderHeader({ renaming: true });
    const input = container.querySelector('input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Blurred' } });
    await fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the DM cancels, blur included', async () => {
    const user = userEvent.setup();
    const { container, getByRole, onRename } = renderHeader({ renaming: true });
    const input = container.querySelector('input') as HTMLInputElement;
    await user.click(input);
    await user.type(input, ' discarded');
    await user.click(getByRole('button', { name: 'cancel' }));
    expect(onRename).not.toHaveBeenCalled();
  });

  it('sends nothing on Escape', async () => {
    const { container, onRename } = renderHeader({ renaming: true });
    const input = container.querySelector('input') as HTMLInputElement;
    await fireEvent.keyDown(input, { key: 'Escape' });
    await fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
  });

  // The latch is per-rename, not per-mount: reopening the editor must work.
  it('re-arms after the editor is reopened', async () => {
    const { container, getByRole, getByLabelText, onRename, rerender } = renderHeader();
    await fireEvent.click(getByLabelText('Rename encounter'));
    let input = container.querySelector('input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'First' } });
    await fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(1);

    // Parent closes the editor once its PATCH settles, then the DM reopens.
    await rerender({ renaming: false, name: 'First' });
    await fireEvent.click(getByLabelText('Rename encounter'));
    input = container.querySelector('input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Second' } });
    await fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(2);
    expect(onRename).toHaveBeenLastCalledWith('Second');
  });
});
