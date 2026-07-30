import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BoardCanvas from './BoardCanvas.svelte';

// jsdom has no layout and no 2d context. The component sizes its cells from
// the wrapper's clientWidth (via bind:clientWidth, which needs a
// ResizeObserver) and skips drawing when getContext returns null — so stub
// just enough for the pointer maths to be real: 10 columns at 40 px.
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
          [{ target: el, contentRect: { width: CELL * 10, height: CELL * 3 } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      }
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => CELL * 10
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: CELL * 10, height: CELL * 3, right: CELL * 10, bottom: CELL * 3 })
  });
});

/** 10×3 all-floor board. `maxCellPx` matches the stubbed width so a cell is
 *  exactly CELL px and the pointer maths below are readable. */
const board = { w: 10, h: 3, tiles: `1x30`, maxCellPx: CELL };

const at = (x: number, y: number) => ({
  clientX: x * CELL + CELL / 2,
  clientY: y * CELL + CELL / 2,
  pointerId: 1,
  button: 0
});

function renderCanvas(props: Record<string, unknown>, events: Record<string, () => void> = {}) {
  const utils = render(BoardCanvas, { props: { ...board, ...props }, events });
  const canvas = utils.container.querySelector('canvas')!;
  // setPointerCapture doesn't exist in jsdom.
  canvas.setPointerCapture = () => {};
  return canvas;
}

const token = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  x: 2,
  y: 1,
  sizeCells: 1,
  label: 'GB',
  color: '#f00',
  draggable: true,
  ...over
});

describe('BoardCanvas pointer semantics', () => {
  it('reports a plain click on an empty cell', async () => {
    const cellclick = vi.fn();
    const paintend = vi.fn();
    const canvas = renderCanvas({}, { cellclick, paintend });
    await fireEvent.pointerDown(canvas, at(4, 1));
    await fireEvent.pointerUp(canvas, at(4, 1));
    expect(cellclick).toHaveBeenCalledOnce();
    expect(cellclick.mock.calls[0][0].detail).toEqual({ x: 4, y: 1 });
    expect(paintend).toHaveBeenCalledOnce();
  });

  // Regression: a paint stroke used to fall through to cellclick on release,
  // so ending a fog stroke also fired whatever cellclick was wired to.
  it('does not report a click at the end of a paint stroke', async () => {
    const cellclick = vi.fn();
    const paintmove = vi.fn();
    const paintend = vi.fn();
    const canvas = renderCanvas({}, { cellclick, paintmove, paintend });
    await fireEvent.pointerDown(canvas, at(1, 1));
    await fireEvent.pointerMove(canvas, at(2, 1));
    await fireEvent.pointerMove(canvas, at(3, 1));
    await fireEvent.pointerUp(canvas, at(3, 1));
    expect(paintmove).toHaveBeenCalledTimes(2);
    expect(paintend).toHaveBeenCalledOnce();
    expect(cellclick).not.toHaveBeenCalled();
  });

  it('reports a token drop only when the token actually moved', async () => {
    const tokendrop = vi.fn();
    const tokenclick = vi.fn();
    const canvas = renderCanvas({ tokens: [token()] }, { tokendrop, tokenclick });
    await fireEvent.pointerDown(canvas, at(2, 1));
    await fireEvent.pointerMove(canvas, at(5, 2));
    await fireEvent.pointerUp(canvas, at(5, 2));
    expect(tokendrop.mock.calls[0][0].detail).toEqual({ id: 't1', x: 5, y: 2 });
    expect(tokenclick).not.toHaveBeenCalled();
  });

  // Regression: dropping a token on its own cell POSTed the same coordinates
  // back, bumping the board version so every other tab refetched for nothing.
  it('treats a press-and-release on a token as a click, not a move', async () => {
    const tokendrop = vi.fn();
    const tokenclick = vi.fn();
    const canvas = renderCanvas({ tokens: [token()] }, { tokendrop, tokenclick });
    await fireEvent.pointerDown(canvas, at(2, 1));
    await fireEvent.pointerUp(canvas, at(2, 1));
    expect(tokendrop).not.toHaveBeenCalled();
    expect(tokenclick.mock.calls[0][0].detail).toEqual({ id: 't1' });
  });

  it('reports a click on a token nobody may drag', async () => {
    const tokenclick = vi.fn();
    const cellclick = vi.fn();
    const canvas = renderCanvas(
      { tokens: [token({ draggable: false })] },
      { tokenclick, cellclick }
    );
    await fireEvent.pointerDown(canvas, at(2, 1));
    await fireEvent.pointerUp(canvas, at(2, 1));
    expect(tokenclick.mock.calls[0][0].detail).toEqual({ id: 't1' });
    // The cell click still goes through — the board's other tools need it.
    expect(cellclick).toHaveBeenCalledOnce();
  });

  it('hit-tests a big token across its whole footprint, topmost first', async () => {
    const tokenclick = vi.fn();
    const canvas = renderCanvas(
      { tokens: [token({ id: 'huge', sizeCells: 3, draggable: false }), token({ id: 'small', x: 3, y: 2, draggable: false })] },
      { tokenclick }
    );
    // (4,2) is inside the Huge footprint (2..4) but only 'small' is there too
    // and draws later, so it wins.
    await fireEvent.pointerDown(canvas, at(3, 2));
    await fireEvent.pointerUp(canvas, at(3, 2));
    expect(tokenclick.mock.calls[0][0].detail).toEqual({ id: 'small' });
    // A footprint cell with nothing on top reports the big token.
    await fireEvent.pointerDown(canvas, at(4, 1));
    await fireEvent.pointerUp(canvas, at(4, 1));
    expect(tokenclick.mock.calls[1][0].detail).toEqual({ id: 'huge' });
  });

  it('stays silent when not interactive', async () => {
    const cellclick = vi.fn();
    const tokenclick = vi.fn();
    const canvas = renderCanvas(
      { interactive: false, tokens: [token()] },
      { cellclick, tokenclick }
    );
    await fireEvent.pointerDown(canvas, at(2, 1));
    await fireEvent.pointerUp(canvas, at(2, 1));
    expect(cellclick).not.toHaveBeenCalled();
    expect(tokenclick).not.toHaveBeenCalled();
  });

  it('reports hover as the pointer crosses cells, and null on leave', async () => {
    const cellhover = vi.fn();
    const canvas = renderCanvas({}, { cellhover });
    await fireEvent.pointerMove(canvas, at(1, 0));
    await fireEvent.pointerMove(canvas, at(1, 0)); // same cell — no repeat
    await fireEvent.pointerMove(canvas, at(2, 0));
    await fireEvent.pointerLeave(canvas);
    expect(cellhover.mock.calls.map((c) => c[0].detail)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      null
    ]);
  });
});
