// Reactivity contract tests for the encounter page's condsFor pattern.
//
// Background: a function called from a Svelte template — e.g.
// `{@const active = condsFor(p)}` — only re-runs when an identifier
// visible in the call expression changes. If condsFor closes over a
// `let` reactive var, the template won't re-evaluate when that var
// updates, and the UI silently goes stale. We hit this in production
// when toggling an NPC condition didn't refresh the chip list
// (b/78eda29 fix).
//
// The fix is to thread the reactive value through as an explicit
// argument, so Svelte's template-dep analysis sees the dep. These
// tests lock that pattern via the CondsReactivityHarness fixture.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import Harness from './fixtures/CondsReactivityHarness.svelte';

describe('conditions reactivity (encounter page pattern)', () => {
  // Non-PC participants source from the live conditions map. The bug class
  // was that the template `{@const}` didn't re-evaluate when the map
  // updated — this test fails if the harness regresses to a closure-only
  // dep without an explicit argument.
  it('non-PC chip text updates when liveConditions changes', async () => {
    const participants = [{ id: 'm1', kind: 'npc', conditions: [] }];
    const { getByTestId, component } = render(Harness, {
      props: { participants, liveConditions: {}, pcConditions: {} }
    });
    expect(getByTestId('chips-m1').textContent).toBe('');

    component.$set({ liveConditions: { m1: ['blinded'] } });
    await tick();
    expect(getByTestId('chips-m1').textContent).toBe('blinded');

    component.$set({ liveConditions: { m1: ['blinded', 'prone'] } });
    await tick();
    expect(getByTestId('chips-m1').textContent).toBe('blinded,prone');

    // Clearing also flips back.
    component.$set({ liveConditions: { m1: [] } });
    await tick();
    expect(getByTestId('chips-m1').textContent).toBe('');
  });

  it('non-PC chip falls back to SSR seed conditions when live map is empty', () => {
    const participants = [{ id: 'm1', kind: 'npc', conditions: ['poisoned'] }];
    const { getByTestId } = render(Harness, {
      props: { participants, liveConditions: {}, pcConditions: {} }
    });
    expect(getByTestId('chips-m1').textContent).toBe('poisoned');
  });

  // PC participants source from the pcConditions mirror (the optimistic
  // local map that flips when the DM toggles a PC condition). Same dep
  // visibility requirement applies.
  it('PC chip text updates when pcConditions mirror changes', async () => {
    const participants = [{ id: 'p1', kind: 'pc', conditions: ['ignored'] }];
    const { getByTestId, component } = render(Harness, {
      props: { participants, liveConditions: {}, pcConditions: {} }
    });
    expect(getByTestId('chips-p1').textContent).toBe('');

    component.$set({ pcConditions: { p1: ['frightened'] } });
    await tick();
    expect(getByTestId('chips-p1').textContent).toBe('frightened');
  });

  // Multiple participants in one render — the @const should re-evaluate
  // per-row when its own slot of the map changes, not all rows at once.
  it('updates the right row only when one map entry changes', async () => {
    const participants = [
      { id: 'a', kind: 'npc', conditions: [] },
      { id: 'b', kind: 'npc', conditions: [] }
    ];
    const { getByTestId, component } = render(Harness, {
      props: { participants, liveConditions: { a: ['x'] }, pcConditions: {} }
    });
    expect(getByTestId('chips-a').textContent).toBe('x');
    expect(getByTestId('chips-b').textContent).toBe('');

    component.$set({ liveConditions: { a: ['x'], b: ['y'] } });
    await tick();
    expect(getByTestId('chips-a').textContent).toBe('x');
    expect(getByTestId('chips-b').textContent).toBe('y');
  });
});
