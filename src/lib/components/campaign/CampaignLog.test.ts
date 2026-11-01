import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import CampaignLog from './CampaignLog.svelte';
import type { TimelineEntry } from '$lib/dashboard/types';

const HERO = '00000000-0000-4000-8000-000000000001';

function entry(over: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: crypto.randomUUID(),
    at: Date.now(),
    source: 'session',
    kind: 'hp',
    isPrivate: false,
    amendsId: null,
    amendedById: null,
    actorName: 'dm',
    restorable: false,
    characterIds: [HERO],
    summary: '',
    encounterName: null,
    round: null,
    hpBefore: null,
    hpAfter: null,
    redacted: false,
    ...over
  };
}

const ENTRIES = [
  entry({ summary: 'Hero took 7 HP (20 → 13)', restorable: true, hpBefore: 20, hpAfter: 13 }),
  entry({ kind: 'note', summary: 'Secret plot', isPrivate: true, characterIds: [] }),
  entry({ source: 'combat', kind: 'combat', summary: 'Hero: Longsword → Enemy 1 (hit, 6 dmg)', actorName: null })
];

function stubFetch(entries: TimelineEntry[]) {
  const fn = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ entries }), { status: 200 })
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CampaignLog', () => {
  it('renders the timeline with DM controls for the DM', async () => {
    const fetchFn = stubFetch(ENTRIES);
    const { getAllByTestId, getByText, queryByText } = render(CampaignLog, {
      props: { code: 'QRWTSK', isDM: true, characters: [{ id: HERO, name: 'Hero' }] }
    });
    await waitFor(() => expect(getAllByTestId('log-row')).toHaveLength(3));
    expect(String(fetchFn.mock.calls[0][0])).toContain('/api/campaigns/QRWTSK/log?limit=50');
    expect(getByText('private')).toBeTruthy();
    expect(getByText('↶ Restore HP')).toBeTruthy();
    expect(getByText('Amend')).toBeTruthy();
    expect(getByText('Add note')).toBeTruthy();
    expect(queryByText(/HP 20→13/)).toBeNull(); // session HP rows carry it in the summary
  });

  it('shows players the log without any controls', async () => {
    stubFetch([ENTRIES[0], ENTRIES[2]]);
    const { getAllByTestId, queryByText, container } = render(CampaignLog, {
      props: { code: 'QRWTSK', isDM: false, characters: [{ id: HERO, name: 'Hero' }] }
    });
    await waitFor(() => expect(getAllByTestId('log-row')).toHaveLength(2));
    expect(queryByText('↶ Restore HP')).toBeNull();
    expect(queryByText('Amend')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });
});
