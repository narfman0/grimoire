// "Your turn" signalling. The banner is for the one viewer whose character
// is active — not for everyone looking at the active row — and the browser
// notification must stay opt-in, background-only, and silent when the
// browser says no.

import { describe, it, expect } from 'vitest';
import {
  isViewersTurn,
  notifyState,
  shouldNotifyTurn,
  type TurnNotifyInput
} from '../turn-notify';

describe('isViewersTurn', () => {
  it('is true when the active participant is one of the viewer\'s characters', () => {
    expect(isViewersTurn('p2', ['p1', 'p2'])).toBe(true);
  });

  it('is false for someone else\'s turn — a spectator must not get the callout', () => {
    expect(isViewersTurn('p3', ['p1', 'p2'])).toBe(false);
  });

  it('is false for a viewer with no characters in the fight (the usual DM)', () => {
    expect(isViewersTurn('p1', [])).toBe(false);
    expect(isViewersTurn('p1', undefined)).toBe(false);
  });

  it('is false when nobody is active', () => {
    expect(isViewersTurn(null, ['p1'])).toBe(false);
    expect(isViewersTurn(undefined, ['p1'])).toBe(false);
  });
});

describe('shouldNotifyTurn', () => {
  const base: TurnNotifyInput = {
    enabled: true,
    supported: true,
    permission: 'granted',
    tabVisible: false,
    wasMyTurn: false,
    isMyTurn: true,
    encounterLive: true
  };

  it('fires on the rising edge of the viewer\'s turn in a background tab', () => {
    expect(shouldNotifyTurn(base)).toBe(true);
  });

  it('never fires when the tab is focused', () => {
    expect(shouldNotifyTurn({ ...base, tabVisible: true })).toBe(false);
  });

  it('never fires without an explicit opt-in', () => {
    expect(shouldNotifyTurn({ ...base, enabled: false })).toBe(false);
  });

  it('degrades silently when the API is missing or permission is not granted', () => {
    expect(shouldNotifyTurn({ ...base, supported: false })).toBe(false);
    expect(shouldNotifyTurn({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldNotifyTurn({ ...base, permission: 'default' })).toBe(false);
  });

  it('does not re-fire while the same turn stays active', () => {
    expect(shouldNotifyTurn({ ...base, wasMyTurn: true })).toBe(false);
  });

  it('does not fire when the turn moves off the viewer', () => {
    expect(shouldNotifyTurn({ ...base, wasMyTurn: true, isMyTurn: false })).toBe(false);
  });

  it('stays quiet outside a live encounter', () => {
    expect(shouldNotifyTurn({ ...base, encounterLive: false })).toBe(false);
  });
});

describe('notifyState', () => {
  it('reports unsupported browsers as a dead end, not an off switch', () => {
    expect(notifyState({ supported: false, permission: 'default', enabled: true })).toBe(
      'unsupported'
    );
  });

  it('reports a site-level block as denied even when the pref is on', () => {
    expect(notifyState({ supported: true, permission: 'denied', enabled: true })).toBe('denied');
  });

  it('is only "on" with both the pref and the grant', () => {
    expect(notifyState({ supported: true, permission: 'granted', enabled: true })).toBe('on');
    expect(notifyState({ supported: true, permission: 'granted', enabled: false })).toBe('off');
    expect(notifyState({ supported: true, permission: 'default', enabled: true })).toBe('off');
  });
});
