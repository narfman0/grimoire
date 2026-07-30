import { describe, expect, it } from 'vitest';
import { decodeRuns } from '../rle';
import { TEMPLATES, templateTiles } from '../templates';
import { tileById } from '../tileset';

describe('board templates', () => {
  it.each(TEMPLATES.map((t) => [t.slug, t] as const))(
    '%s decodes to its declared size with known tiles',
    (_slug, t) => {
      const seed = templateTiles(t.slug)!;
      expect(seed.w).toBe(t.w);
      expect(seed.h).toBe(t.h);
      const decoded = decodeRuns(seed.tiles, t.w * t.h);
      for (const id of decoded) {
        expect(tileById(id).id).toBe(id); // known tile, no fallback
      }
    }
  );

  it('is deterministic (same template, same tiles)', () => {
    expect(templateTiles('cavern')).toEqual(templateTiles('cavern'));
  });

  it('the blank room is walled with a door', () => {
    const seed = templateTiles('blank-room')!;
    const grid = decodeRuns(seed.tiles, seed.w * seed.h);
    expect(tileById(grid[0]).slug).toBe('wall');
    expect(
      Array.from(grid).some((id) => tileById(id).slug === 'door-closed')
    ).toBe(true);
  });

  it('returns null for an unknown template', () => {
    expect(templateTiles('nope')).toBeNull();
  });
});
