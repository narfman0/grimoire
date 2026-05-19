import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import SpellManagerModal from './SpellManagerModal.svelte';
import type { CharacterDocument } from '$lib/rules/types';

const document: CharacterDocument = {
  schemaVersion: 1,
  name: 'Test',
  classes: [],
  species: { slug: 'human', version: 1, choices: {} },
  background: { slug: 'sage', version: 1, choices: {} },
  abilityScores: { str: 10, dex: 10, con: 10, int: 16, wis: 12, cha: 8 },
  inventory: [],
  conditions: [],
  spells: {
    known: [
      { slug: 'fire-bolt', authorUserId: null },
      { slug: 'mage-armor', authorUserId: null }
    ],
    prepared: ['mage-armor']
  }
} as unknown as CharacterDocument;

const derived = {
  stats: {
    spellSlots: {
      1: { max: 4, used: 0 },
      2: { max: 2, used: 1 }
    }
  }
};

const spellOptions = [
  {
    slug: 'fire-bolt', name: 'Fire Bolt', source: 'PHB', level: 0, school: 'evocation',
    castingTime: '1 action', range: '120 feet', components: ['V', 'S'], duration: 'Instantaneous',
    concentration: false, ritual: false, attackKind: 'ranged spell', save: null,
    damage: [{ dice: '1d10', type: 'fire' }], description: '',
    pickerId: 'fire-bolt|', authorUserId: null, isHomebrew: false, isSubscribed: false
  },
  {
    slug: 'mage-armor', name: 'Mage Armor', source: 'PHB', level: 1, school: 'abjuration',
    castingTime: '1 action', range: 'Touch', components: ['V', 'S', 'M'], duration: '8 hours',
    concentration: false, ritual: false, attackKind: null, save: null, damage: null,
    description: '', pickerId: 'mage-armor|', authorUserId: null, isHomebrew: false, isSubscribed: false
  },
  {
    slug: 'shield', name: 'Shield', source: 'PHB', level: 1, school: 'abjuration',
    castingTime: '1 reaction', range: 'Self', components: ['V', 'S'], duration: '1 round',
    concentration: false, ritual: false, attackKind: null, save: null, damage: null,
    description: '', pickerId: 'shield|', authorUserId: null, isHomebrew: false, isSubscribed: false
  }
];

const callbacks = () => ({
  onAddSpell: vi.fn(),
  onRemoveSpell: vi.fn(),
  onTogglePrepared: vi.fn(),
  onClose: vi.fn()
});

describe('SpellManagerModal', () => {
  // Locks the open gate. The modal only renders when open && document &&
  // derived are all truthy — every nullable input must be non-null.
  it('renders nothing when open=false', () => {
    const { queryByRole } = render(SpellManagerModal, {
      props: {
        ...callbacks(),
        open: false,
        document,
        derived,
        spellOptions
      }
    });
    expect(queryByRole('dialog')).toBeNull();
  });

  it('renders nothing when derived is null', () => {
    const { queryByRole } = render(SpellManagerModal, {
      props: {
        ...callbacks(),
        open: true,
        document,
        derived: null,
        spellOptions
      }
    });
    expect(queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog with prepared and known counts', () => {
    const { getByRole, getByText } = render(SpellManagerModal, {
      props: {
        ...callbacks(),
        open: true,
        document,
        derived,
        spellOptions
      }
    });
    expect(getByRole('dialog')).not.toBeNull();
    // 1 prepared (mage-armor), 2 known (fire-bolt + mage-armor)
    expect(getByText('1 prepared · 2 known')).not.toBeNull();
  });

  // Locks the close callback wiring — both the Close button and the
  // backdrop click should fire it.
  it('Close button fires onClose', async () => {
    const cb = callbacks();
    const { getByText } = render(SpellManagerModal, {
      props: { ...cb, open: true, document, derived, spellOptions }
    });
    await fireEvent.click(getByText('Close'));
    expect(cb.onClose).toHaveBeenCalledOnce();
  });

  // Locks: clicking the Add button with a valid pickerKey calls onAddSpell
  // with that id. A regression where pickerKey isn't reactive would silently
  // call onAddSpell with the wrong id.
  it('Add button fires onAddSpell with the picker selection', async () => {
    const cb = callbacks();
    const { getByText } = render(SpellManagerModal, {
      props: { ...cb, open: true, document, derived, spellOptions }
    });
    // First available unknown option in the picker is "Shield" (the only
    // un-taken spell in the seed). The picker starts on the first non-taken
    // option in alphabetical order — defaults to whichever filtered[0] is.
    await fireEvent.click(getByText('Add'));
    expect(cb.onAddSpell).toHaveBeenCalledOnce();
  });

  // Locks the remove-button wiring. Each known spell row has a × button
  // that fires onRemoveSpell with (slug, authorUserId).
  it('clicking × on a known spell row fires onRemoveSpell with slug + authorUserId', async () => {
    const cb = callbacks();
    const { getAllByTitle } = render(SpellManagerModal, {
      props: { ...cb, open: true, document, derived, spellOptions }
    });
    const removeButtons = getAllByTitle('Remove from spellbook');
    expect(removeButtons.length).toBeGreaterThanOrEqual(1);

    await fireEvent.click(removeButtons[0]);
    expect(cb.onRemoveSpell).toHaveBeenCalledOnce();
    const [slug, authorId] = cb.onRemoveSpell.mock.calls[0];
    expect(['fire-bolt', 'mage-armor']).toContain(slug);
    expect(authorId).toBeNull();
  });
});
