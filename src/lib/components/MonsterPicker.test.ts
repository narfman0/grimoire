import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MonsterPicker, { type MonsterOption } from './MonsterPicker.svelte';

const monsters: MonsterOption[] = [
  { slug: 'goblin', name: 'Goblin', source: 'MM', cr: '1/4', maxHp: 7, ac: 15, type: 'humanoid', size: 'small' },
  { slug: 'orc', name: 'Orc', source: 'MM', cr: '1/2', maxHp: 15, ac: 13, type: 'humanoid', size: 'medium' },
  { slug: 'dragon', name: 'Young Red Dragon', source: 'MM', cr: '10', maxHp: 178, ac: 18, type: 'dragon', size: 'large' },
  { slug: 'commoner', name: 'Commoner', source: 'MM', cr: '0', maxHp: 4, ac: 10, type: 'humanoid', size: 'medium' }
];

describe('MonsterPicker', () => {

  // Locks the search-by-name contract.
  it('filters by name query', async () => {
    const { getByPlaceholderText, queryByText } = render(MonsterPicker, {
      props: { monsters }
    });
    const input = getByPlaceholderText('Search monsters…') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'dragon' } });

    expect(queryByText('Young Red Dragon')).not.toBeNull();
    expect(queryByText('Goblin')).toBeNull();
  });

  // Locks the CR filter — distinct from name search, easy to disconnect.
  it('CR dropdown filter restricts the result list', async () => {
    const { getAllByRole, queryByText } = render(MonsterPicker, {
      props: { monsters }
    });
    // Find the CR select by its first option "Any CR"
    const selects = getAllByRole('combobox') as HTMLSelectElement[];
    const crSelect = selects.find((s) =>
      Array.from(s.options).some((o) => o.text === 'Any CR')
    )!;
    await fireEvent.change(crSelect, { target: { value: '1/4' } });

    expect(queryByText('Goblin')).not.toBeNull();
    expect(queryByText('Orc')).toBeNull();
  });

  // Locks the two-stage select: click → preview, never an immediate pick.
  it('clicking a monster row does NOT dispatch pick (it opens the preview)', async () => {
    const onPick = vi.fn();
    const { getByText } = render(MonsterPicker, {
      props: { monsters },
      events: { pick: (e) => onPick(e.detail) }

    });

    await fireEvent.click(getByText('Orc'));
    expect(onPick).not.toHaveBeenCalled();
  });

  // Locks the explicit confirm flow: preview must be open + Add button click
  // → pick dispatches with the previewed MonsterOption.
  it('clicking Add after preview dispatches pick with the previewed monster', async () => {
    const onPick = vi.fn();
    const { getByText } = render(MonsterPicker, {
      props: { monsters },
      events: { pick: (e) => onPick(e.detail) }

    });

    await fireEvent.click(getByText('Orc'));
    const addBtn = getByText(/^Add Orc$/);
    await fireEvent.click(addBtn);
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'orc', name: 'Orc', cr: '1/2' })
    );
  });

  // Locks that preview uses the embedded `data` field directly — no fetch,
  // works for any pack source (including ones outside PUBLIC_SOURCES). The
  // fetch-based version 404'd on private packs; this test prevents that
  // regression.
  it('preview renders the statblock from embedded data without any fetch', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 404 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as typeof fetch;
    try {
      const withData: MonsterOption[] = [
        {
          ...monsters[0],
          data: {
            cr: '1/4',
            ac: 15,
            hp: { max: 7 },
            size: 'small',
            type: 'humanoid',
            abilityScores: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 }
          }
        }
      ];
      const { container, getByText } = render(MonsterPicker, { props: { monsters: withData } });
      await fireEvent.click(getByText('Goblin'));
      // Statblock view emits the Saves: section + ability rows with mods —
      // proof that monsterDerive ran on the embedded data.
      expect(container.textContent).toMatch(/Saves:/);
      expect(container.textContent).toMatch(/str\s*8\s*-1/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Locks the graceful fallback when a caller embeds the picker without
  // supplying `data` — the preview should still render the summary fields.
  it('preview falls back to summary line when no data field is supplied', async () => {
    const { container, getByText } = render(MonsterPicker, { props: { monsters } });
    await fireEvent.click(getByText('Orc'));
    // Summary fallback shows size + type · AC X · HP Y · CR Z.
    expect(container.textContent).toMatch(/medium\s+humanoid/);
    expect(container.textContent).toMatch(/AC\s*13/);
  });

  // Add button is disabled until a monster is previewed.
  it('Add button is disabled when nothing is previewed', () => {
    const { getByText } = render(MonsterPicker, { props: { monsters } });
    const addBtn = getByText('Add') as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
  });

  // Locks the Escape → close contract.
  it('Escape dispatches close', async () => {
    const onClose = vi.fn();
    const { getByPlaceholderText } = render(MonsterPicker, {
      props: { monsters },
      events: { close: onClose }
    });

    await fireEvent.keyDown(getByPlaceholderText('Search monsters…'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  // Locks the "clear filters" affordance — only renders when any filter is
  // active.
  it('clear filters button appears only when a filter is set', async () => {
    const { queryByText, getAllByRole } = render(MonsterPicker, {
      props: { monsters }
    });
    expect(queryByText('clear filters')).toBeNull();

    const selects = getAllByRole('combobox') as HTMLSelectElement[];
    const typeSelect = selects.find((s) =>
      Array.from(s.options).some((o) => o.text === 'Any type')
    )!;
    await fireEvent.change(typeSelect, { target: { value: 'dragon' } });
    expect(queryByText('clear filters')).not.toBeNull();
  });
});
