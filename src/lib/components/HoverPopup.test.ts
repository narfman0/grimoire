import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import HoverPopup from './HoverPopup.svelte';

// HoverPopup is pure CSS — the only behaviour is mapping the `position`
// prop to one of three Tailwind anchoring classes. If a refactor drops a
// branch (e.g. forgets the 'above' case), this catches it.
describe('HoverPopup', () => {
  function popupClasses(container: HTMLElement): string {
    // The popup is the second nested <span> inside the wrapper.
    const spans = container.querySelectorAll('span');
    return spans[spans.length - 1].className;
  }

  it('positions the popup below-left by default', () => {
    const { container } = render(HoverPopup);
    expect(popupClasses(container)).toMatch(/top-full/);
    expect(popupClasses(container)).toMatch(/left-0/);
  });

  it('positions to the right when position="right"', () => {
    const { container } = render(HoverPopup, { props: { position: 'right' } });
    expect(popupClasses(container)).toMatch(/left-full/);
    expect(popupClasses(container)).toMatch(/top-0/);
  });

  it('positions above when position="above"', () => {
    const { container } = render(HoverPopup, { props: { position: 'above' } });
    expect(popupClasses(container)).toMatch(/bottom-full/);
    expect(popupClasses(container)).toMatch(/left-0/);
  });

  it('applies the width prop class', () => {
    const { container } = render(HoverPopup, { props: { width: 'w-96' } });
    expect(popupClasses(container)).toContain('w-96');
  });
});
