// The duration picker's contract with its parent.
//
// The armed round count used to be two-way bound to a single page-scoped
// variable, so a duration armed while looking at one creature applied to the
// next condition switched on for *any* creature. It is now reported upward
// and owned per participant id, which turns the failure mode from "a silent
// wrong duration on the wrong creature" into "no duration, visibly".

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ConditionChips from './ConditionChips.svelte';

const baseProps = {
  activeConds: [] as string[],
  implied: new Map<string, string>(),
  role: 'dm' as const,
  busy: false,
  timers: [],
  round: 3,
  pendingDuration: 0
};

function renderChips(props: Partial<typeof baseProps> = {}) {
  const onPending = vi.fn();
  const utils = render(ConditionChips, {
    props: { ...baseProps, ...props },
    events: { pendingDuration: (e: CustomEvent<number>) => onPending(e.detail) }
  });
  return { ...utils, onPending };
}

describe('ConditionChips duration picker', () => {
  it('reports a chosen duration instead of mutating a shared binding', async () => {
    const { container, onPending } = renderChips();
    const select = container.querySelector('select') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: '3' } });
    expect(onPending).toHaveBeenCalledTimes(1);
    expect(onPending).toHaveBeenCalledWith(3);
  });

  it('reports the disarm too', async () => {
    const { container, onPending } = renderChips({ pendingDuration: 3 });
    const select = container.querySelector('select') as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: '0' } });
    expect(onPending).toHaveBeenCalledWith(0);
  });

  it('renders whatever the parent says this participant has armed', () => {
    const { container } = renderChips({ pendingDuration: 5 });
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('5');
  });

  // An armed count has to be noticeable — a duration the DM forgot about is
  // the whole hazard.
  it('highlights the picker while a duration is armed', () => {
    const armed = renderChips({ pendingDuration: 3 }).container.querySelector('select')!;
    expect(armed.className).toMatch(/amber/);
    const idle = renderChips().container.querySelector('select')!;
    expect(idle.className).not.toMatch(/amber/);
  });

  it('offers no picker to players', () => {
    const { container } = renderChips({ role: 'player' as never });
    expect(container.querySelector('select')).toBeNull();
  });
});
