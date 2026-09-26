import { describe, expect, it } from 'vitest';

import {
  assertValidSize,
  bfs,
  cellKey,
  cellToPixel,
  inBounds,
  neighbors,
  pixelToCell,
  sameCell,
  sizeToPixels,
  step,
} from './grid';
import { PIXELS_PER_CELL } from './types';
import type { Cell, Size } from './types';

/**
 * Builds a grid from ASCII art, one character per cell, for readable tests.
 * `#` is impassable, anything else is passable.
 */
function gridFrom(rows: string[]): { size: Size; isPassable: (cell: Cell) => boolean } {
  const size: Size = { w: rows[0].length, h: rows.length };
  return {
    size,
    isPassable: (cell) => inBounds(cell, size) && rows[cell.y][cell.x] !== '#',
  };
}

describe('cellKey and sameCell', () => {
  it('gives equal cells the same key', () => {
    expect(cellKey({ x: 2, y: 3 })).toBe(cellKey({ x: 2, y: 3 }));
    expect(sameCell({ x: 2, y: 3 }, { x: 2, y: 3 })).toBe(true);
  });

  it('separates transposed coordinates', () => {
    expect(cellKey({ x: 2, y: 3 })).not.toBe(cellKey({ x: 3, y: 2 }));
    expect(sameCell({ x: 2, y: 3 }, { x: 3, y: 2 })).toBe(false);
  });
});

describe('step', () => {
  it('treats north as decreasing y, matching the [y][x] cell layout', () => {
    const origin: Cell = { x: 4, y: 4 };
    expect(step(origin, 'n')).toEqual({ x: 4, y: 3 });
    expect(step(origin, 's')).toEqual({ x: 4, y: 5 });
    expect(step(origin, 'e')).toEqual({ x: 5, y: 4 });
    expect(step(origin, 'w')).toEqual({ x: 3, y: 4 });
  });

  it('may leave the grid — bounds are the responsibility of the caller', () => {
    expect(step({ x: 0, y: 0 }, 'w')).toEqual({ x: -1, y: 0 });
  });
});

describe('assertValidSize', () => {
  it('accepts a one-cell grid', () => {
    expect(() => assertValidSize({ w: 1, h: 1 })).not.toThrow();
  });

  it('rejects empty, negative and fractional sizes', () => {
    expect(() => assertValidSize({ w: 0, h: 5 })).toThrow(RangeError);
    expect(() => assertValidSize({ w: 5, h: 0 })).toThrow(RangeError);
    expect(() => assertValidSize({ w: -1, h: 5 })).toThrow(RangeError);
    expect(() => assertValidSize({ w: 2.5, h: 5 })).toThrow(RangeError);
  });
});

describe('inBounds', () => {
  const size: Size = { w: 3, h: 2 };

  it('includes both corners', () => {
    expect(inBounds({ x: 0, y: 0 }, size)).toBe(true);
    expect(inBounds({ x: 2, y: 1 }, size)).toBe(true);
  });

  it('excludes the row and column just past the edge', () => {
    expect(inBounds({ x: 3, y: 0 }, size)).toBe(false);
    expect(inBounds({ x: 0, y: 2 }, size)).toBe(false);
    expect(inBounds({ x: -1, y: 0 }, size)).toBe(false);
  });

  it('excludes fractional coordinates, which address no cell', () => {
    expect(inBounds({ x: 1.5, y: 0 }, size)).toBe(false);
  });
});

describe('neighbors', () => {
  const size: Size = { w: 3, h: 3 };

  it('gives an interior cell four neighbours, in FACINGS order', () => {
    expect(neighbors({ x: 1, y: 1 }, size)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 1 },
    ]);
  });

  it('clips at a corner', () => {
    expect(neighbors({ x: 0, y: 0 }, size)).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);
  });

  it('never returns diagonals', () => {
    expect(neighbors({ x: 1, y: 1 }, size)).not.toContainEqual({ x: 0, y: 0 });
  });

  it('works from outside the grid, returning only the cells inside it', () => {
    expect(neighbors({ x: -1, y: 0 }, size)).toEqual([{ x: 0, y: 0 }]);
  });

  it('rejects an invalid size', () => {
    expect(() => neighbors({ x: 0, y: 0 }, { w: 0, h: 0 })).toThrow(RangeError);
  });
});

describe('bfs', () => {
  it('reaches every passable cell of an open room', () => {
    const { size, isPassable } = gridFrom([
      '...',
      '...',
    ]);
    expect(bfs({ x: 0, y: 0 }, size, isPassable)).toHaveLength(6);
  });

  it('visits every cell in breadth-first order, nearest first', () => {
    // A square grid flooded from a corner: the full order is asserted, not
    // just the first ring, because the first ring of a flood is the same
    // under any traversal that records a cell as it is discovered. Only
    // breadth-first produces the whole sequence below — a stack-based flood
    // would dive down one column first. Distance order is a contract: F2's
    // circulation clearance reads it, and a map generated once has to be
    // reproducible.
    const { size, isPassable } = gridFrom([
      '....',
      '....',
      '....',
      '....',
    ]);
    const order = bfs({ x: 0, y: 0 }, size, isPassable);
    expect(order.map(cellKey)).toEqual([
      '0,0',
      '1,0',
      '0,1',
      '2,0',
      '1,1',
      '0,2',
      '3,0',
      '2,1',
      '1,2',
      '0,3',
      '3,1',
      '2,2',
      '1,3',
      '3,2',
      '2,3',
      '3,3',
    ]);
  });

  it('does not cross a wall, so an isolated cell stays unreached', () => {
    // A room split in two by a solid column: the right half is walled off.
    const { size, isPassable } = gridFrom([
      '.#.',
      '.#.',
      '.#.',
    ]);
    const reached = bfs({ x: 0, y: 0 }, size, isPassable);
    expect(reached).toHaveLength(3);
    expect(reached).not.toContainEqual({ x: 2, y: 0 });
  });

  it('passes through a door gap in an otherwise solid wall', () => {
    const { size, isPassable } = gridFrom([
      '.#.',
      '...',
      '.#.',
    ]);
    expect(bfs({ x: 0, y: 0 }, size, isPassable)).toHaveLength(7);
  });

  it('does not revisit a cell when two paths meet', () => {
    const { size, isPassable } = gridFrom([
      '...',
      '...',
    ]);
    const reached = bfs({ x: 0, y: 0 }, size, isPassable);
    expect(new Set(reached.map(cellKey)).size).toBe(reached.length);
  });

  it('returns nothing when the start itself is impassable', () => {
    const { size, isPassable } = gridFrom([
      '#..',
      '...',
    ]);
    expect(bfs({ x: 0, y: 0 }, size, isPassable)).toEqual([]);
  });

  it('rejects a start outside the grid', () => {
    const { size, isPassable } = gridFrom(['...']);
    expect(() => bfs({ x: 5, y: 0 }, size, isPassable)).toThrow(RangeError);
    expect(() => bfs({ x: -1, y: 0 }, size, isPassable)).toThrow(RangeError);
  });
});

describe('cell to pixel conversion', () => {
  it('maps a cell to its top-left pixel', () => {
    expect(cellToPixel({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(cellToPixel({ x: 2, y: 3 })).toEqual({ x: 140, y: 210 });
  });

  it('maps a pixel back to the cell containing it', () => {
    expect(pixelToCell(0, 0)).toEqual({ x: 0, y: 0 });
    expect(pixelToCell(69, 69)).toEqual({ x: 0, y: 0 });
    expect(pixelToCell(70, 70)).toEqual({ x: 1, y: 1 });
  });

  it('round-trips a cell through its top-left pixel', () => {
    for (const cell of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 19, y: 19 }]) {
      const pixel = cellToPixel(cell);
      expect(pixelToCell(pixel.x, pixel.y)).toEqual(cell);
    }
  });

  it('keeps negative pixels on negative cells rather than rounding to zero', () => {
    expect(pixelToCell(-1, -1)).toEqual({ x: -1, y: -1 });
  });

  it('sizes an image in exact multiples of the grid', () => {
    const pixels = sizeToPixels({ w: 20, h: 12 });
    expect(pixels).toEqual({ w: 1400, h: 840 });
    expect(pixels.w % PIXELS_PER_CELL).toBe(0);
    expect(pixels.h % PIXELS_PER_CELL).toBe(0);
  });

  it('rejects an invalid size instead of producing a zero-pixel image', () => {
    expect(() => sizeToPixels({ w: 0, h: 5 })).toThrow(RangeError);
  });
});
