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

  // Locks the click → pick contract.
  it('clicking a monster row dispatches pick with the full MonsterOption', async () => {
    const onPick = vi.fn();
    const { getByText, component } = render(MonsterPicker, { props: { monsters } });
    component.$on('pick', (e) => onPick(e.detail));

    await fireEvent.click(getByText('Orc'));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'orc', name: 'Orc', cr: '1/2' })
    );
  });

  // Locks the Escape → close contract.
  it('Escape dispatches close', async () => {
    const onClose = vi.fn();
    const { getByPlaceholderText, component } = render(MonsterPicker, {
      props: { monsters }
    });
    component.$on('close', onClose);

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
