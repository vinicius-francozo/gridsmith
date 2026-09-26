import { describe, expect, it } from 'vitest';

import { PIXELS_PER_CELL } from '../core/types';
import type { Cell, PlacedProp } from '../core/types';
import { cellRect, footprintCenter, footprintInBounds, offsetRect, propRect } from './geometry';

/** A placed prop, with the field under test overridden. */
function prop(overrides: Partial<PlacedProp> = {}): PlacedProp {
  return {
    assetId: 'anchor/bar_counter',
    cell: { x: 1, y: 2 },
    footprint: { w: 4, h: 1 },
    rotation: 0,
    layer: 'anchor',
    ...overrides,
  };
}

describe('cellRect', () => {
  it('puts the origin cell at the top-left of the canvas', () => {
    expect(cellRect({ x: 0, y: 0 })).toEqual({ x: 0, y: 0, w: 70, h: 70 });
  });

  it('keeps x and y in that order', () => {
    // A transposed conversion is invisible on a square map and wrong on every
    // other one, which is exactly the map that ships.
    expect(cellRect({ x: 3, y: 2 })).toEqual({ x: 210, y: 140, w: 70, h: 70 });
  });

  it('spans a multi-cell footprint', () => {
    expect(cellRect({ x: 1, y: 1 }, { w: 2, h: 3 })).toEqual({ x: 70, y: 70, w: 140, h: 210 });
  });

  it('rejects a cell that is not on whole coordinates', () => {
    // Half a cell of drift lines up at the top-left and is a full cell out by
    // the bottom-right, which is only noticed mid-session.
    expect(() => cellRect({ x: 2.5, y: 0 })).toThrow(RangeError);
    expect(() => cellRect({ x: 0, y: Number.NaN })).toThrow(RangeError);
  });

  it('rejects a footprint that is not a positive whole size', () => {
    expect(() => cellRect({ x: 0, y: 0 }, { w: 0, h: 1 })).toThrow(RangeError);
    expect(() => cellRect({ x: 0, y: 0 }, { w: 1.5, h: 1 })).toThrow(RangeError);
  });

  it('always lands on a multiple of the grid pitch', () => {
    for (let x = 0; x < 20; x += 1) {
      const rect = cellRect({ x, y: x });
      expect(rect.x % PIXELS_PER_CELL).toBe(0);
      expect(rect.y % PIXELS_PER_CELL).toBe(0);
    }
  });
});

describe('propRect', () => {
  it('covers the footprint the prop reserved', () => {
    expect(propRect(prop())).toEqual({ x: 70, y: 140, w: 280, h: 70 });
  });

  it('uses the placed footprint, not the rotation', () => {
    // `PlacedProp.footprint` is already turned, and the library hands back a
    // bitmap that is turned too. Re-applying the rotation here would turn it
    // twice.
    expect(propRect(prop({ rotation: 90, footprint: { w: 1, h: 4 } }))).toEqual({
      x: 70,
      y: 140,
      w: 70,
      h: 280,
    });
  });
});

describe('offsetRect', () => {
  it('moves the rectangle without resizing it', () => {
    expect(offsetRect({ x: 10, y: 20, w: 70, h: 140 }, 5, -3)).toEqual({
      x: 15,
      y: 17,
      w: 70,
      h: 140,
    });
  });
});

describe('footprintCenter', () => {
  it('puts a single cell’s centre half a cell in from its corner', () => {
    expect(footprintCenter({ x: 2, y: 3 })).toEqual({ x: 2.5, y: 3.5 });
  });

  it('centres a multi-cell footprint on the whole footprint', () => {
    expect(footprintCenter({ x: 0, y: 0 }, { w: 4, h: 1 })).toEqual({ x: 2, y: 0.5 });
  });
});

describe('footprintInBounds', () => {
  const map = { w: 20, h: 20 };

  it('accepts a footprint that ends on the last cell', () => {
    expect(footprintInBounds({ x: 16, y: 0 }, { w: 4, h: 1 }, map)).toBe(true);
  });

  it('rejects a footprint whose body hangs off the map', () => {
    // The anchor is in bounds and three of the four cells are not. Checking
    // the anchor alone is the mistake this exists to catch.
    const anchor: Cell = { x: 17, y: 0 };
    expect(footprintInBounds(anchor, { w: 1, h: 1 }, map)).toBe(true);
    expect(footprintInBounds(anchor, { w: 4, h: 1 }, map)).toBe(false);
  });

  it('checks both axes', () => {
    expect(footprintInBounds({ x: 0, y: 18 }, { w: 1, h: 3 }, map)).toBe(false);
    expect(footprintInBounds({ x: 0, y: 17 }, { w: 1, h: 3 }, map)).toBe(true);
  });

  it('rejects a negative anchor', () => {
    expect(footprintInBounds({ x: -1, y: 0 }, { w: 1, h: 1 }, map)).toBe(false);
  });

  it('rejects a footprint that is not a positive whole size', () => {
    expect(footprintInBounds({ x: 0, y: 0 }, { w: 0, h: 1 }, map)).toBe(false);
    expect(footprintInBounds({ x: 0, y: 0 }, { w: 1.5, h: 1 }, map)).toBe(false);
  });
});
