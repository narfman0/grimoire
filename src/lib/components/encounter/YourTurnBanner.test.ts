import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import YourTurnBanner from './YourTurnBanner.svelte';

const base = { characterName: 'Vortha', round: 3 } as const;

describe('YourTurnBanner', () => {
  it('names the character and the round', () => {
    const { getByTestId } = render(YourTurnBanner, { props: { ...base, notify: 'off' } });
    const banner = getByTestId('your-turn-banner');
    expect(banner.textContent).toContain('Your turn');
    expect(banner.textContent).toContain('Vortha');
    expect(banner.textContent).toContain('round 3');
  });

  it('announces itself to assistive tech', () => {
    const { getByTestId } = render(YourTurnBanner, { props: { ...base, notify: 'off' } });
    const banner = getByTestId('your-turn-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('assertive');
  });

  it('offers the opt-in bell when notifications are available', async () => {
    const onToggle = vi.fn();
    const { getByRole } = render(YourTurnBanner, {
      props: { ...base, notify: 'off' },
      events: { toggleNotify: () => onToggle() }
    });
    const button = getByRole('button');
    expect(button.textContent).toContain('Notify me');
    await fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('hides the bell entirely when the browser has no Notification API', () => {
    const { queryByRole } = render(YourTurnBanner, {
      props: { ...base, notify: 'unsupported' }
    });
    expect(queryByRole('button')).toBeNull();
  });

  it('shows a disabled, explanatory bell when the site is blocked', () => {
    const { getByRole } = render(YourTurnBanner, { props: { ...base, notify: 'denied' } });
    const button = getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('blocked');
  });

  it('reflects the on state', () => {
    const { getByRole } = render(YourTurnBanner, { props: { ...base, notify: 'on' } });
    expect(getByRole('button').textContent).toContain('Notify: on');
  });
});
