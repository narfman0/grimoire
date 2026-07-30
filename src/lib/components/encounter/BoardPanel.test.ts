import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { encodeRuns, decodeRuns } from '$lib/board/rle';
import { tileBySlug } from '$lib/board/tileset';

// The panel talks to the board API on every edit; the interesting behaviour
// here is which clicks become which writes, so the client is a spy.
const { apiMock } = vi.hoisted(() => {
  const patch = vi.fn();
  const base = Object.assign(vi.fn(), {
    get: vi.fn(async () => ({ maps: [] })),
    post: vi.fn(async () => ({})),
    patch,
    del: vi.fn(async () => ({}))
  });
  return { apiMock: base };
});
vi.mock('$lib/client/api', () => ({ api: apiMock }));

import BoardPanel from './BoardPanel.svelte';

// Same jsdom canvas scaffolding as BoardCanvas.test.ts: no layout, no 2d
// context — stub enough that the pointer→cell maths are real.
const CELL = 40;
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        this.cb(
          [{ target: el, contentRect: { width: CELL * 4, height: CELL * 2 } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      }
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => CELL * 4
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: CELL * 4, height: CELL * 2, right: CELL * 4, bottom: CELL * 2 })
  });
});

const FLOOR = tileBySlug('floor')!.id;
const DOOR_CLOSED = tileBySlug('door-closed')!.id;
const DOOR_OPEN = tileBySlug('door-open')!.id;

/** 4×2 board: closed door at (1,0), open door at (2,0), floor elsewhere. */
function boardFixture(over: Record<string, unknown> = {}) {
  return {
    encounterId: 'E',
    sourceMapId: null,
    w: 4,
    h: 2,
    cellFt: 5,
    tiles: encodeRuns([FLOOR, DOOR_CLOSED, DOOR_OPEN, FLOOR, FLOOR, FLOOR, FLOOR, FLOOR]),
    revealed: encodeRuns(new Array(8).fill(1)),
    background: null,
    annotations: {},
    version: 1,
    ...over
  };
}

const at = (x: number, y: number) => ({
  clientX: x * CELL + CELL / 2,
  clientY: y * CELL + CELL / 2,
  pointerId: 1,
  button: 0
});

function renderPanel(
  props: Record<string, unknown>,
  events: Record<string, (e: CustomEvent) => void> = {}
) {
  const utils = render(BoardPanel, {
    props: { encounterId: 'E', boardVersion: 1, tokens: [], unplaced: [], ...props },
    events
  });
  const canvas = utils.container.querySelector('canvas')!;
  canvas.setPointerCapture = () => {};
  return { ...utils, canvas };
}

const click = async (canvas: HTMLCanvasElement, x: number, y: number) => {
  await fireEvent.pointerDown(canvas, at(x, y));
  await fireEvent.pointerUp(canvas, at(x, y));
};

beforeEach(() => {
  apiMock.patch.mockReset();
  apiMock.patch.mockImplementation(async (_path: string, body: { tiles?: string }) =>
    boardFixture({ version: 2, ...(body.tiles ? { tiles: body.tiles } : {}) })
  );
});

describe('BoardPanel note readout', () => {
  const notes = { '1,1': { note: '10 ft ledge' } };

  // Regression: the marks rendered for everyone but the note text lived only
  // in the DM-gated chips list — a player saw a triangle they could not read.
  it('shows a hovered note to a player, and clears it on leave', async () => {
    const { canvas } = renderPanel({ role: 'player', board: boardFixture({ annotations: notes }) });
    await fireEvent.pointerMove(canvas, at(1, 1));
    expect(screen.getByTestId('note-readout').textContent).toContain('10 ft ledge');
    await fireEvent.pointerLeave(canvas);
    expect(screen.queryByTestId('note-readout')).toBeNull();
  });

  it('shows nothing over an unnoted cell', async () => {
    const { canvas } = renderPanel({ role: 'player', board: boardFixture({ annotations: notes }) });
    await fireEvent.pointerMove(canvas, at(3, 1));
    expect(screen.queryByTestId('note-readout')).toBeNull();
  });

  it('labels a DM-only note as such for the DM', async () => {
    const { canvas } = renderPanel({
      role: 'dm',
      board: boardFixture({ annotations: { '1,1': { note: 'trap resets', dmOnly: true } } })
    });
    await fireEvent.pointerMove(canvas, at(1, 1));
    expect(screen.getByTestId('note-readout').textContent).toContain('dm only');
  });
});

describe('BoardPanel door toggle', () => {
  it('DM click on a closed door opens it in place', async () => {
    const { canvas } = renderPanel({ role: 'dm', board: boardFixture() });
    await click(canvas, 1, 0);
    expect(apiMock.patch).toHaveBeenCalledOnce();
    const sent = decodeRuns(apiMock.patch.mock.calls[0][1].tiles, 8);
    expect(sent[1]).toBe(DOOR_OPEN);
    expect(sent[2]).toBe(DOOR_OPEN); // untouched neighbour
  });

  it('DM click on an open door closes it when nothing else claims the click', async () => {
    const { canvas } = renderPanel({ role: 'dm', board: boardFixture() });
    await click(canvas, 2, 0);
    const sent = decodeRuns(apiMock.patch.mock.calls[0][1].tiles, 8);
    expect(sent[2]).toBe(DOOR_CLOSED);
  });

  it('plain floor clicks write nothing', async () => {
    const { canvas } = renderPanel({ role: 'dm', board: boardFixture() });
    await click(canvas, 0, 0);
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  it('players cannot toggle doors', async () => {
    const { canvas } = renderPanel({ role: 'player', board: boardFixture() });
    await click(canvas, 1, 0);
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  it('click-to-plan onto an open doorway wins over closing it', async () => {
    const planned: Array<{ x: number; y: number }> = [];
    const { canvas } = renderPanel(
      {
        role: 'dm',
        board: boardFixture(),
        tokens: [
          {
            id: 'p1',
            x: 3,
            y: 0,
            sizeCells: 1,
            label: 'V',
            color: '#0f0',
            draggable: false,
            team: 'pc'
          }
        ],
        selected: { id: 'p1', speedFt: 30, kind: 'pc', plannable: true }
      },
      {
        planMove: (e) =>
          planned.push({ x: (e as CustomEvent).detail.x, y: (e as CustomEvent).detail.y })
      }
    );
    // (2,0) is an open door inside p1's reach: the click must become a plan,
    // not slam the door in their face.
    await click(canvas, 2, 0);
    expect(planned).toEqual([{ x: 2, y: 0 }]);
    expect(apiMock.patch).not.toHaveBeenCalled();
  });
});
