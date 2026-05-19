import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import HpBucketBadge from './HpBucketBadge.svelte';
import { HP_BUCKET_LABELS, type HpBucket } from '$lib/realtime/reveals';

const COLORS: Record<HpBucket, RegExp> = {
  healthy: /emerald/,
  wounded: /yellow/,
  bloodied: /orange/,
  critical: /red/,
  defeated: /slate.*line-through|line-through.*slate/,
  unknown: /slate/
};

describe('HpBucketBadge', () => {
  // The visual contract players see when `vitals` is hidden. Locks the
  // bucket→colour mapping so a Tailwind palette refactor can't silently
  // show "bloodied" as healthy-emerald.
  for (const bucket of Object.keys(COLORS) as HpBucket[]) {
    it(`renders the ${bucket} bucket with its expected palette + label`, () => {
      const { container } = render(HpBucketBadge, { props: { value: bucket } });
      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.textContent?.trim()).toBe(HP_BUCKET_LABELS[bucket]);
      expect(span!.className).toMatch(COLORS[bucket]);
    });
  }

  it('defaults to unknown when value prop is omitted', () => {
    const { container } = render(HpBucketBadge, { props: {} });
    expect(container.querySelector('span')!.textContent?.trim()).toBe(
      HP_BUCKET_LABELS.unknown
    );
  });
});
