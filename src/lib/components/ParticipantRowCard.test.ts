import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ParticipantRowCard from './ParticipantRowCard.svelte';

function baseParticipant(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Goblin',
    placeholderName: null,
    kind: 'npc',
    initiative: 12,
    currentHp: 7,
    tempHp: 0,
    maxHp: 12,
    hpBucket: null,
    reveals: { vitals: false, identity: false, combat: false, hidden: false },
    ...over
  };
}

function baseProps(over: Record<string, unknown> = {}) {
  return {
    p: baseParticipant(),
    role: 'dm' as const,
    isActive: false,
    isSelected: false,
    activeConds: [] as string[],
    concLabel: null as string | null,
    liveCurrentHp: undefined,
    liveTempHp: undefined,
    editingInitiative: false,
    busy: false,
    ...over
  };
}

describe('ParticipantRowCard', () => {
  it('renders DM HP as "current / max" with temp suffix', () => {
    const { container } = render(ParticipantRowCard, {
      props: baseProps({ liveCurrentHp: 5, liveTempHp: 3 })
    });
    expect(container.textContent).toMatch(/5\s*\/\s*12/);
    expect(container.textContent).toMatch(/\+3/);
  });

  it('shows HP bucket badge for player role on a hidden NPC', () => {
    const { container } = render(ParticipantRowCard, {
      props: baseProps({ role: 'player' as const, liveCurrentHp: 5 })
    });
    // No raw HP digits in bucket-only mode.
    expect(container.textContent).not.toMatch(/5\s*\/\s*12/);
  });

  it('dispatches select on row click', async () => {
    const onSelect = vi.fn();
    const { container, component } = render(ParticipantRowCard, { props: baseProps() });
    component.$on('select', onSelect);
    await fireEvent.click(container.querySelector('li')!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('dispatches commitInitiative with the typed number on Enter', async () => {
    const onCommit = vi.fn();
    const { getByPlaceholderText, component } = render(ParticipantRowCard, {
      props: baseProps({ editingInitiative: true, p: baseParticipant({ initiative: null }) })
    });
    component.$on('commitInitiative', onCommit);
    const input = getByPlaceholderText('init') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '17' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ detail: 17 }));
  });

  it('dispatches cancelEditInitiative on Escape', async () => {
    const onCancel = vi.fn();
    const { getByPlaceholderText, component } = render(ParticipantRowCard, {
      props: baseProps({ editingInitiative: true, p: baseParticipant({ initiative: 8 }) })
    });
    component.$on('cancelEditInitiative', onCancel);
    await fireEvent.keyDown(getByPlaceholderText('init'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the concentration glyph when concLabel is set', () => {
    const { container } = render(ParticipantRowCard, {
      props: baseProps({ concLabel: 'bless' })
    });
    expect(container.textContent).toContain('🌀');
  });

  it('shows conditions inline when present', () => {
    const { container } = render(ParticipantRowCard, {
      props: baseProps({ activeConds: ['prone', 'restrained'] })
    });
    expect(container.textContent).toContain('prone, restrained');
  });

  it('dispatches remove when the ✕ button is clicked (DM)', async () => {
    const onRemove = vi.fn();
    const { getByTitle, component } = render(ParticipantRowCard, { props: baseProps() });
    component.$on('remove', onRemove);
    await fireEvent.click(getByTitle('Remove npc from encounter'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders the participant name (no kind badge)', () => {
    const { container } = render(ParticipantRowCard, {
      props: baseProps({ p: baseParticipant({ name: 'Goblin Boss' }) })
    });
    expect(container.textContent).not.toContain('npc');
    expect(container.textContent).toContain('Goblin Boss');
  });
});
