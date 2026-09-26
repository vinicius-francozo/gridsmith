import { describe, expect, it } from 'vitest';

import { createRng } from '../core/prng';
import type { Cell } from '../core/types';
import type { ShapeName } from './profiles';
import { buildFootprint, rectArea, rectContains } from './shapes';
import type { Rect } from './shapes';
import { maxRng, minRng } from './testing';

const SHAPES: ShapeName[] = ['rectangle', 'l_shape', 't_shape', 'alcove'];

/** Every cell covered by `rects`, deduplicated. */
function cover(rects: Rect[]): Set<string> {
  const cells = new Set<string>();
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        cells.add(`${x},${y}`);
      }
    }
  }
  return cells;
}

/** Whether the covered cells form one orthogonally connected blob. */
function isConnected(rects: Rect[]): boolean {
  const cells = cover(rects);
  const first = [...cells][0];
  if (first === undefined) {
    return false;
  }
  const queue: Cell[] = [{ x: Number(first.split(',')[0]), y: Number(first.split(',')[1]) }];
  const seen = new Set<string>([first]);
  for (let head = 0; head < queue.length; head += 1) {
    const { x, y } = queue[head];
    for (const next of [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ]) {
      const key = `${next.x},${next.y}`;
      if (cells.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return seen.size === cells.size;
}

describe('rectContains', () => {
  const rect: Rect = { x: 2, y: 3, w: 4, h: 2 };

  it('includes the top-left cell and excludes the cell past the far edge', () => {
    expect(rectContains(rect, 2, 3)).toBe(true);
    expect(rectContains(rect, 5, 4)).toBe(true);
    expect(rectContains(rect, 6, 4)).toBe(false);
    expect(rectContains(rect, 2, 5)).toBe(false);
  });

  it('excludes a cell before the top-left corner in a single axis', () => {
    expect(rectContains(rect, 1, 3)).toBe(false);
    expect(rectContains(rect, 2, 2)).toBe(false);
  });
});

describe('rectArea', () => {
  it('counts the cells of a rectangle', () => {
    expect(rectArea({ x: 5, y: 5, w: 4, h: 3 })).toBe(12);
  });
});

describe('buildFootprint', () => {
  const interior: Rect = { x: 1, y: 1, w: 12, h: 10 };

  it('fills the whole interior for a rectangle', () => {
    expect(buildFootprint('rectangle', interior, minRng())).toEqual([interior]);
  });

  it('bites a corner out of an L, leaving the rest', () => {
    // With the randomness pinned low the cut is the smallest the grammar
    // allows: a quarter of each side, rounded up.
    expect(buildFootprint('l_shape', interior, minRng())).toEqual([
      { x: 1, y: 1, w: 12, h: 7 },
      { x: 1, y: 8, w: 9, h: 3 },
    ]);
  });

  it('turns the shape over when the randomness runs the other way', () => {
    const low = buildFootprint('l_shape', interior, minRng());
    const high = buildFootprint('l_shape', interior, maxRng());
    expect(high).not.toEqual(low);
    expect(cover(high).size).toBeLessThan(rectArea(interior));
  });

  it('keeps every shape inside the interior it was given', () => {
    for (const shape of SHAPES) {
      for (let seed = 0; seed < 40; seed += 1) {
        for (const rect of buildFootprint(shape, interior, createRng(seed))) {
          expect(rect.x).toBeGreaterThanOrEqual(interior.x);
          expect(rect.y).toBeGreaterThanOrEqual(interior.y);
          expect(rect.x + rect.w).toBeLessThanOrEqual(interior.x + interior.w);
          expect(rect.y + rect.h).toBeLessThanOrEqual(interior.y + interior.h);
          expect(rect.w).toBeGreaterThan(0);
          expect(rect.h).toBeGreaterThan(0);
        }
      }
    }
  });

  it('never leaves a shape in two pieces', () => {
    // A footprint that came out in two separate blobs would put a room on the
    // far side of a wall with no way through, and the door rule would then
    // happily open onto only one of them.
    for (const shape of SHAPES) {
      for (let seed = 0; seed < 40; seed += 1) {
        expect(isConnected(buildFootprint(shape, interior, createRng(seed)))).toBe(true);
      }
    }
  });

  it('actually cuts the interior for every shape but the rectangle', () => {
    for (const shape of SHAPES) {
      const covered = cover(buildFootprint(shape, interior, createRng(3))).size;
      if (shape === 'rectangle') {
        expect(covered).toBe(rectArea(interior));
      } else {
        expect(covered).toBeLessThan(rectArea(interior));
      }
    }
  });

  it('falls back to a plain rectangle in a frame too small for the shape', () => {
    // A T in a four-cell-wide room has no stem worth the name. Emitting the
    // degenerate shape anyway would read as a mistake on the finished map.
    const tiny: Rect = { x: 1, y: 1, w: 3, h: 3 };
    for (const shape of SHAPES) {
      expect(buildFootprint(shape, tiny, createRng(1))).toEqual([tiny]);
    }
  });

  it('reaches every orientation over a run of seeds', () => {
    const shapes = new Set<string>();
    for (let seed = 0; seed < 60; seed += 1) {
      shapes.add(JSON.stringify(buildFootprint('l_shape', interior, createRng(seed))));
    }
    // Four corners, times the sizes of the cut.
    expect(shapes.size).toBeGreaterThanOrEqual(4);
  });
});
