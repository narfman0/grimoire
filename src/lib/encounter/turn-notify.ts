// "Your turn" signalling — the decision layer, kept out of the Svelte
// component so it can be tested without a browser.
//
// Two distinct things live here:
//   1. `isMyTurn` — whether the *viewer* owns the active participant. This
//      is deliberately not the same as "this is the active row": everyone
//      watching the encounter sees the active row highlighted, only the
//      player whose character is up gets the callout.
//   2. `shouldNotifyTurn` — whether to raise a browser notification. Opt-in
//      only, never while the tab is focused, and silently inert when the
//      Notification API is missing or permission was refused.

export type NotificationPermissionLike = 'default' | 'granted' | 'denied';

/** True when the active participant is one of the viewer's own characters. */
export function isViewersTurn(
  activeParticipantId: string | null | undefined,
  myParticipantIds: readonly string[] | undefined
): boolean {
  if (!activeParticipantId || !myParticipantIds || myParticipantIds.length === 0) return false;
  return myParticipantIds.includes(activeParticipantId);
}

export interface TurnNotifyInput {
  /** The user turned notifications on for this device (persisted). */
  enabled: boolean;
  /** The Notification API exists in this browser at all. */
  supported: boolean;
  permission: NotificationPermissionLike;
  /** Tab is focused / visible — never interrupt someone already watching. */
  tabVisible: boolean;
  /** Previous value of isMyTurn; notifications fire on the rising edge only,
   *  so a poll that merely re-confirms the same turn stays quiet. */
  wasMyTurn: boolean;
  isMyTurn: boolean;
  /** Encounter must actually be running. */
  encounterLive: boolean;
}

export function shouldNotifyTurn(i: TurnNotifyInput): boolean {
  if (!i.enabled || !i.supported) return false;
  if (i.permission !== 'granted') return false;
  if (i.tabVisible) return false;
  if (!i.encounterLive) return false;
  return i.isMyTurn && !i.wasMyTurn;
}

/** The four states the notify toggle can be in. `unsupported` and `denied`
 *  are dead ends — the UI shows them as an explanation rather than a
 *  control that silently does nothing. */
export type NotifyState = 'unsupported' | 'denied' | 'on' | 'off';

export function notifyState(opts: {
  supported: boolean;
  permission: NotificationPermissionLike;
  enabled: boolean;
}): NotifyState {
  if (!opts.supported) return 'unsupported';
  if (opts.permission === 'denied') return 'denied';
  return opts.enabled && opts.permission === 'granted' ? 'on' : 'off';
}
