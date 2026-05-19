import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import RevealChip from './RevealChip.svelte';

describe('RevealChip', () => {
  // Visual contract: on-state uses emerald palette; off-state slate; danger
  // tone uses red when on. Locks the reveal-toggle look so a Tailwind class
  // rename doesn't silently flip player-facing redaction UI.
  it('renders emerald palette when on=true normal tone', () => {
    const { getByRole } = render(RevealChip, {
      props: { label: 'identity', on: true, tone: 'normal' }
    });
    const btn = getByRole('button');
    expect(btn.className).toMatch(/emerald/);
    expect(btn.className).not.toMatch(/red/);
  });

  it('renders red palette when on=true danger tone (hidden reveal)', () => {
    const { getByRole } = render(RevealChip, {
      props: { label: 'hidden', on: true, tone: 'danger' }
    });
    expect(getByRole('button').className).toMatch(/red/);
  });

  it('renders slate (off) palette when on=false', () => {
    const { getByRole } = render(RevealChip, {
      props: { label: 'vitals', on: false }
    });
    const className = getByRole('button').className;
    expect(className).toMatch(/slate/);
    expect(className).not.toMatch(/emerald/);
  });

  // Locks the click → toggle contract. Parent owns the boolean; the chip
  // just flips it. Regression here would silently break every reveal
  // toggle on the encounter page at once.
  it('dispatches toggle with the inverted value', async () => {
    const onToggle = vi.fn();
    const { getByRole, component } = render(RevealChip, {
      props: { label: 'identity', on: false }
    });
    component.$on('toggle', (e) => onToggle(e.detail));

    await fireEvent.click(getByRole('button'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('renders the disabled attribute when disabled=true (browser blocks the click)', () => {
    const { getByRole } = render(RevealChip, {
      props: { label: 'identity', on: false, disabled: true }
    });
    expect((getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
