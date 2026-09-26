import { afterEach, describe, expect, it } from 'vitest';

import type { AssetDef, Rotation } from '../core/types';
import { ASSET_KINDS, PIXELS_PER_CELL, validateCatalog } from './contract';
import {
  PLACEHOLDER_CATALOG,
  anchorCorner,
  createPlaceholderLibrary,
  paintMarker,
  placeholderMarker,
} from './placeholder';

/** A definition for the asset the catalogue is asked about, by id. */
function catalogued(id: string): AssetDef {
  const found = PLACEHOLDER_CATALOG.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`the test expects ${id} in the placeholder catalogue`);
  }
  return found;
}

// --- A canvas stand-in ------------------------------------------------------
//
// The tests run under Node, where no canvas exists. These two globals let the
// browser-only half of the placeholder be exercised for the one property that
// actually matters and that a human cannot eyeball reliably: the bitmap comes
// back at exactly the footprint's pixel size. Everything else about the
// painting is judged by looking at it.

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}

  getContext(): unknown {
    return new Proxy(
      {},
      {
        get: () => () => undefined,
        set: () => true,
      },
    );
  }
}

const savedCanvas = Reflect.get(globalThis, 'OffscreenCanvas') as unknown;
const savedCreateBitmap = Reflect.get(globalThis, 'createImageBitmap') as unknown;

function installFakeCanvas(): void {
  Reflect.set(globalThis, 'OffscreenCanvas', FakeOffscreenCanvas);
  Reflect.set(globalThis, 'createImageBitmap', (source: unknown) => Promise.resolve(source));
}

function restoreCanvas(): void {
  if (savedCanvas === undefined) {
    Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
  } else {
    Reflect.set(globalThis, 'OffscreenCanvas', savedCanvas);
  }
  if (savedCreateBitmap === undefined) {
    Reflect.deleteProperty(globalThis, 'createImageBitmap');
  } else {
    Reflect.set(globalThis, 'createImageBitmap', savedCreateBitmap);
  }
}

afterEach(restoreCanvas);

describe('PLACEHOLDER_CATALOG', () => {
  it('honours the asset contract it is validated by', () => {
    expect(validateCatalog(PLACEHOLDER_CATALOG)).toEqual([]);
  });

  it('spells its tile ids the way tileAssetId does', () => {
    // The tile ids are the join between a TileRef's material and variant and a
    // library key. If the catalogue spelled them differently, tile art would
    // simply never resolve and nobody would see an error.
    for (const def of PLACEHOLDER_CATALOG.filter((entry) => entry.kind === 'tile')) {
      expect(def.id).toMatch(/^tile\/[a-z0-9_]+\/\d+$/);
    }
  });
});

describe('anchorCorner', () => {
  it('walks the corners clockwise with the rotation', () => {
    expect(anchorCorner(0)).toBe('nw');
    expect(anchorCorner(90)).toBe('ne');
    expect(anchorCorner(180)).toBe('se');
    expect(anchorCorner(270)).toBe('sw');
  });

  it('rejects a rotation outside the closed set', () => {
    expect(() => anchorCorner(45 as Rotation)).toThrow(RangeError);
  });
});

describe('placeholderMarker', () => {
  it('is the footprint at the grid pitch', () => {
    const marker = placeholderMarker(catalogued('group/table_round'), 0);
    expect(marker.size).toEqual({ w: 2 * PIXELS_PER_CELL, h: 2 * PIXELS_PER_CELL });
    expect(marker.footprint).toEqual({ w: 2, h: 2 });
  });

  it('turns with the rotation', () => {
    const marker = placeholderMarker(catalogued('anchor/bar_counter'), 90);
    expect(marker.footprint).toEqual({ w: 1, h: 4 });
    expect(marker.size).toEqual({ w: PIXELS_PER_CELL, h: 4 * PIXELS_PER_CELL });
  });

  it('carries a readable name and the footprint, which is what a marker is for', () => {
    const marker = placeholderMarker(catalogued('anchor/bar_counter'), 0);
    expect(marker.label).toBe('bar counter');
    expect(marker.sublabel).toBe('4x1 anchor');
  });

  it('moves the anchor wedge to the corner the rotation put it in', () => {
    const def = catalogued('anchor/bar_counter');
    expect(placeholderMarker(def, 0).anchorMark).toMatchObject({ x: 0, y: 0 });

    const turned = placeholderMarker(def, 90);
    // 1x4 after the turn: the original top-left is now the top-right.
    expect(turned.anchorMark.x).toBe(turned.size.w - turned.anchorMark.w);
    expect(turned.anchorMark.y).toBe(0);

    const half = placeholderMarker(def, 180);
    expect(half.anchorMark.x).toBe(half.size.w - half.anchorMark.w);
    expect(half.anchorMark.y).toBe(half.size.h - half.anchorMark.h);
  });

  it('keeps the anchor wedge inside the marker', () => {
    for (const def of PLACEHOLDER_CATALOG) {
      for (const rotation of [0, 90, 180, 270] as Rotation[]) {
        const marker = placeholderMarker(def, rotation);
        const mark = marker.anchorMark;
        expect(mark.x).toBeGreaterThanOrEqual(0);
        expect(mark.y).toBeGreaterThanOrEqual(0);
        expect(mark.x + mark.w).toBeLessThanOrEqual(marker.size.w);
        expect(mark.y + mark.h).toBeLessThanOrEqual(marker.size.h);
      }
    }
  });

  it('derives its colours from the id, so the same asset is always the same colour', () => {
    const def = catalogued('anchor/hearth');
    expect(placeholderMarker(def, 0).background).toBe(placeholderMarker(def, 270).background);
    expect(placeholderMarker(def, 0).background).not.toBe(
      placeholderMarker(catalogued('anchor/stairs'), 0).background,
    );
  });

  it('rejects a rotation outside the closed set', () => {
    expect(() => placeholderMarker(catalogued('anchor/hearth'), 45 as Rotation)).toThrow(RangeError);
  });
});

describe('createPlaceholderLibrary', () => {
  it('refuses a catalogue that breaks the contract', () => {
    expect(() =>
      createPlaceholderLibrary([
        { id: 'Bad Id', kind: 'group', footprint: { w: 1, h: 1 }, tags: [], againstWall: false },
      ]),
    ).toThrow(TypeError);
  });

  it('refuses a catalogue with a duplicate id', () => {
    const def = catalogued('anchor/hearth');
    expect(() => createPlaceholderLibrary([def, def])).toThrow(/declared twice/);
  });
});

describe('query', () => {
  const library = createPlaceholderLibrary();

  it('covers every asset kind', () => {
    // The marking library exists so the engine can be exercised end to end. A
    // kind with nothing in it is a stage of generation with nothing to draw.
    for (const kind of ASSET_KINDS) {
      const found = library.query([], kind);
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((def) => def.kind === kind)).toBe(true);
    }
  });

  it('returns the whole catalogue when asked for nothing in particular', () => {
    expect(library.query([])).toHaveLength(PLACEHOLDER_CATALOG.length);
  });

  it('requires every tag, not just one of them', () => {
    const both = library.query(['table', 'seating']);
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((def) => def.tags.includes('table') && def.tags.includes('seating'))).toBe(
      true,
    );
    expect(library.query(['table', 'stairs'])).toEqual([]);
  });

  it('narrows a tag search by kind', () => {
    expect(library.query(['wood'], 'tile').every((def) => def.kind === 'tile')).toBe(true);
    expect(library.query(['hearth'], 'scatter')).toEqual([]);
  });

  it('returns nothing for a tag no asset carries', () => {
    expect(library.query(['dragon'])).toEqual([]);
  });
});

describe('get', () => {
  const library = createPlaceholderLibrary();

  it('finds a catalogued asset', () => {
    expect(library.get('anchor/hearth')?.footprint).toEqual({ w: 2, h: 1 });
  });

  it('returns undefined for an id nobody declared', () => {
    expect(library.get('anchor/throne')).toBeUndefined();
  });
});

describe('bitmap', () => {
  it('rejects an id that is not in the catalogue', async () => {
    const library = createPlaceholderLibrary();
    await expect(library.bitmap('anchor/throne', 0)).rejects.toThrow(RangeError);
  });

  it('rejects a rotation outside the closed set', async () => {
    const library = createPlaceholderLibrary();
    await expect(library.bitmap('anchor/hearth', 45 as Rotation)).rejects.toThrow(RangeError);
  });

  it('says plainly that it needs a browser when there is no canvas', async () => {
    restoreCanvas();
    Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
    const library = createPlaceholderLibrary();
    await expect(library.bitmap('anchor/hearth', 0)).rejects.toThrow(/OffscreenCanvas/);
  });

  it('hands back a bitmap of exactly the footprint’s pixel size', async () => {
    installFakeCanvas();
    const library = createPlaceholderLibrary();
    const bitmap = await library.bitmap('anchor/bar_counter', 0);
    expect(bitmap.width).toBe(4 * PIXELS_PER_CELL);
    expect(bitmap.height).toBe(1 * PIXELS_PER_CELL);
  });

  it('hands back a turned bitmap for a turned asset', async () => {
    installFakeCanvas();
    const library = createPlaceholderLibrary();
    const bitmap = await library.bitmap('anchor/bar_counter', 90);
    expect(bitmap.width).toBe(1 * PIXELS_PER_CELL);
    expect(bitmap.height).toBe(4 * PIXELS_PER_CELL);
  });

  it('sizes every catalogued asset at the grid pitch, at every rotation', async () => {
    installFakeCanvas();
    const library = createPlaceholderLibrary();
    for (const def of PLACEHOLDER_CATALOG) {
      for (const rotation of [0, 90, 180, 270] as Rotation[]) {
        const bitmap = await library.bitmap(def.id, rotation);
        const expected = placeholderMarker(def, rotation).size;
        expect([bitmap.width, bitmap.height]).toEqual([expected.w, expected.h]);
        expect(bitmap.width % PIXELS_PER_CELL).toBe(0);
        expect(bitmap.height % PIXELS_PER_CELL).toBe(0);
      }
    }
  });
});

describe('paintMarker', () => {
  it('refuses to paint where there is no OffscreenCanvas', () => {
    restoreCanvas();
    Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
    const marker = placeholderMarker(catalogued('anchor/hearth'), 0);
    expect(() => paintMarker(marker)).toThrow(/OffscreenCanvas/);
  });

  it('sizes the canvas to the marker', () => {
    installFakeCanvas();
    const canvas = paintMarker(placeholderMarker(catalogued('group/table_round'), 0));
    expect(canvas.width).toBe(2 * PIXELS_PER_CELL);
    expect(canvas.height).toBe(2 * PIXELS_PER_CELL);
  });
});
