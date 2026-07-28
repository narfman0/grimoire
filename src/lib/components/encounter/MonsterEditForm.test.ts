import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import MonsterEditForm from './MonsterEditForm.svelte';

const monsterOptions = [
  { slug: 'goblin', name: 'Goblin', cr: '1/4' },
  { slug: 'orc', name: 'Orc', cr: '1/2' }
];

function nameInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input') as HTMLInputElement;
}
function slugSelect(container: HTMLElement): HTMLSelectElement {
  return container.querySelector('select') as HTMLSelectElement;
}

describe('MonsterEditForm', () => {
  // Regression: the drafts were parent-owned bindings only ever written by an
  // `openMonsterEdit()` that nothing called, so the form rendered blank and
  // `save` stayed disabled until the DM retyped the name.
  it('prefills the drafts from the selected participant', () => {
    const { container, getByRole } = render(MonsterEditForm, {
      props: {
        participant: { id: 'p1', name: 'Goblin Boss', statblockSlug: 'goblin' },
        monsterOptions,
        busy: false
      }
    });
    expect(nameInput(container).value).toBe('Goblin Boss');
    expect(slugSelect(container).value).toBe('goblin');
    expect((getByRole('button', { name: 'save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('re-seeds the drafts when the selected participant changes', async () => {
    const { container, rerender } = render(MonsterEditForm, {
      props: {
        participant: { id: 'p1', name: 'Goblin Boss', statblockSlug: 'goblin' },
        monsterOptions,
        busy: false
      }
    });
    await fireEvent.input(nameInput(container), { target: { value: 'edited' } });
    expect(nameInput(container).value).toBe('edited');

    await rerender({ participant: { id: 'p2', name: 'Orc Grunt', statblockSlug: 'orc' } });
    expect(nameInput(container).value).toBe('Orc Grunt');
    expect(slugSelect(container).value).toBe('orc');
  });

  it('keeps DM keystrokes when the parent re-renders the same participant', async () => {
    const { container, rerender } = render(MonsterEditForm, {
      props: {
        participant: { id: 'p1', name: 'Goblin Boss', statblockSlug: 'goblin' },
        monsterOptions,
        busy: false
      }
    });
    await fireEvent.input(nameInput(container), { target: { value: 'Bugbear' } });
    await rerender({ busy: true });
    expect(nameInput(container).value).toBe('Bugbear');
  });

  it('renders an ad-hoc participant with no statblock as the blank option', () => {
    const { container } = render(MonsterEditForm, {
      props: {
        participant: { id: 'p3', name: 'Mystery Blob', statblockSlug: null },
        monsterOptions,
        busy: false
      }
    });
    expect(nameInput(container).value).toBe('Mystery Blob');
    expect(slugSelect(container).value).toBe('');
  });

  it('dispatches save with the current drafts', async () => {
    const saved: Array<{ name: string; slug: string }> = [];
    const { container, getByRole } = render(MonsterEditForm, {
      props: {
        participant: { id: 'p1', name: 'Goblin Boss', statblockSlug: 'goblin' },
        monsterOptions,
        busy: false
      },
      events: { save: (e: CustomEvent<{ name: string; slug: string }>) => saved.push(e.detail) }
    });
    await fireEvent.input(nameInput(container), { target: { value: 'Hobgoblin' } });
    await fireEvent.change(slugSelect(container), { target: { value: 'orc' } });
    await fireEvent.click(getByRole('button', { name: 'save' }));
    expect(saved).toEqual([{ name: 'Hobgoblin', slug: 'orc' }]);
  });
});
