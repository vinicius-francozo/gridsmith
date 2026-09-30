import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AssetDef, AssetKind, AssetLibrary, Rotation } from '../core/types';
import { PIXELS_PER_CELL, validateCatalog } from './contract';
import {
  MATERIAL_VARIANTS,
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

  it('serves no floor tile at all', () => {
    // A labelled box is right for a prop and wrong for a floor: the same box,
    // border and anchor wedge repeated in every cell hides the map. Floors are
    // the flat colour `materialColor` derives from material and variant, and
    // one catalogued tile variant among four is worse than none — it patches
    // the floor with labelled squares wherever that one variant landed.
    expect(PLACEHOLDER_CATALOG.filter((def) => def.kind === 'tile')).toEqual([]);
  });

  it('spells every id as <kind>/<name>, which is the frozen scheme', () => {
    for (const def of PLACEHOLDER_CATALOG) {
      expect(def.id).toBe(`${def.kind}/${def.id.slice(def.id.indexOf('/') + 1)}`);
      expect(def.id).toMatch(/^(anchor|group|scatter)\/[a-z0-9_]+$/);
    }
  });

  it('gives every id one footprint, and every name one id', () => {
    // The mirror of the generator's own guard, and the failure that slipped
    // through the frozen vocabulary: one name carrying two footprints. The
    // library is a map keyed by id, and `validatePlacement` demands
    // `prop.footprint === rotatedFootprint(def.footprint, rotation)` — 3x2 can
    // never satisfy that for 2x1. Two sizes therefore need two names, which is
    // why `hearth` and `hearth_small` are separate entries rather than one.
    //
    // Names are checked without their `<kind>/` prefix too, and for a
    // different reason than the ids are — not the same trap wearing a hat.
    // Under the `<kind>/<name>` scheme `group/crate` and `scatter/crate`
    // are two ids that resolve independently, so nothing is drawn wrong and
    // no footprint check is confused. What breaks is the map: `readableName`
    // strips the prefix, so both markers are labelled `crate`, and a library
    // whose entire purpose is to say on the image which asset landed where
    // stops being able to say it.
    const ids = PLACEHOLDER_CATALOG.map((def) => def.id);
    expect([...new Set(ids)]).toEqual(ids);

    const names = PLACEHOLDER_CATALOG.map((def) => def.id.slice(def.id.indexOf('/') + 1));
    expect([...new Set(names)]).toEqual(names);
  });

  it('carries the generator’s names and footprints, which are the structural ones', () => {
    // Placement is computed from these: a 5x2 counter behaves differently from
    // a 4x1 one, and a disagreement here fails `validatePlacement` on every
    // scene that contains the prop.
    const footprint = (id: string): string => {
      const def = catalogued(id);
      return `${def.footprint.w}x${def.footprint.h}`;
    };
    expect(footprint('anchor/bar_counter')).toBe('5x2');
    expect(footprint('anchor/hearth')).toBe('3x2');
    expect(footprint('anchor/hearth_small')).toBe('2x1');
    expect(footprint('anchor/stairs_up')).toBe('2x3');
    expect(footprint('anchor/bed')).toBe('2x3');
    expect(footprint('anchor/bunk_beds')).toBe('2x3');
    expect(footprint('anchor/wardrobe')).toBe('2x1');
    expect(footprint('anchor/shelf_row')).toBe('4x1');
    expect(footprint('anchor/shelf_row_short')).toBe('3x1');
    expect(footprint('group/table_round')).toBe('2x2');
    expect(footprint('group/table_long')).toBe('3x1');
    expect(footprint('group/table_small')).toBe('1x1');
    expect(footprint('group/chair')).toBe('1x1');
    expect(footprint('group/bench')).toBe('3x1');
    expect(footprint('group/crate')).toBe('2x1');
    expect(footprint('group/crate_small')).toBe('1x1');
    expect(footprint('group/barrel')).toBe('1x1');
    for (const id of ['mug', 'stool', 'bottle', 'straw', 'sack', 'shard']) {
      expect(footprint(`scatter/${id}`)).toBe('1x1');
    }
  });
});

describe('MATERIAL_VARIANTS', () => {
  it('records the frozen material vocabulary, unchanged, and nothing more', () => {
    // The literal is deliberately a copy: this pins the record against an
    // accidental edit, which is all a table with no consumer can be pinned
    // against. It does not and cannot catch the generator adding a material —
    // nothing here would fail — and the docstring says so rather than
    // claiming otherwise.
    expect(MATERIAL_VARIANTS).toEqual({
      void: 1,
      wood_plank: 4,
      flagstone: 4,
      stone_floor: 3,
      dirt_floor: 3,
      stone_wall: 3,
      plaster_wall: 2,
      timber_wall: 2,
      tufa_column: 1,
      forge_floor: 3,
      forge_wall: 3,
      mosaic_floor: 3,
      sanctum_wall: 3,
      oak_floor: 3,
      archive_floor: 3,
      library_wall: 3,
      slate_floor: 3,
      slate_wall: 3,
      gravel_floor: 3,
      shoring_wall: 3,
    });
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
    expect(marker.footprint).toEqual({ w: 2, h: 5 });
    expect(marker.size).toEqual({ w: 2 * PIXELS_PER_CELL, h: 5 * PIXELS_PER_CELL });
  });

  it('carries a readable name and the footprint, which is what a marker is for', () => {
    const marker = placeholderMarker(catalogued('anchor/bar_counter'), 0);
    expect(marker.label).toBe('bar counter');
    expect(marker.sublabel).toBe('5x2 anchor');
  });

  it('moves the anchor wedge to the corner the rotation put it in', () => {
    const def = catalogued('anchor/bar_counter');
    expect(placeholderMarker(def, 0).anchorMark).toMatchObject({ x: 0, y: 0 });

    const turned = placeholderMarker(def, 90);
    // 2x5 after the turn: the original top-left is now the top-right.
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
      placeholderMarker(catalogued('anchor/stairs_up'), 0).background,
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
  // Built inside a hook, not in the describe body. A catalogue fault raised
  // while vitest is collecting is not a test failure: the file is dropped, the
  // 32 tests in it are never counted, and the run still reports every
  // remaining test passing.
  let library: AssetLibrary;
  beforeAll(() => {
    library = createPlaceholderLibrary();
  });

  it('covers every kind of prop the generator places', () => {
    // The marking library exists so the engine can be exercised end to end. A
    // prop kind with nothing in it is a stage of generation with nothing to
    // draw. `tile` is the deliberate exception: floors are flat colour.
    for (const kind of ['anchor', 'group', 'scatter'] as AssetKind[]) {
      const found = library.query([], kind);
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((def) => def.kind === kind)).toBe(true);
    }
    expect(library.query([], 'tile')).toEqual([]);
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
    expect(library.query(['wood'], 'anchor').every((def) => def.kind === 'anchor')).toBe(true);
    expect(library.query(['hearth'], 'scatter')).toEqual([]);
  });

  it('returns nothing for a tag no asset carries', () => {
    expect(library.query(['dragon'])).toEqual([]);
  });
});

describe('get', () => {
  let library: AssetLibrary;
  beforeAll(() => {
    library = createPlaceholderLibrary();
  });

  it('finds a catalogued asset', () => {
    expect(library.get('anchor/hearth')?.footprint).toEqual({ w: 3, h: 2 });
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

  it('rejects a rotation outside the closed set, in its own words', async () => {
    // The message matters, not just the type. `rotatedFootprint` refuses the
    // same value a frame deeper with wording that used to be identical, so
    // deleting the library's own guard left this test green: it could see
    // that *something* threw and not which guard it was, which is the same
    // way a test passes for the wrong reason.
    const library = createPlaceholderLibrary();
    await expect(library.bitmap('anchor/hearth', 45 as Rotation)).rejects.toThrow(
      /the placeholder library was asked for rotation 45/,
    );
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
    expect(bitmap.width).toBe(5 * PIXELS_PER_CELL);
    expect(bitmap.height).toBe(2 * PIXELS_PER_CELL);
  });

  it('hands back a turned bitmap for a turned asset', async () => {
    installFakeCanvas();
    const library = createPlaceholderLibrary();
    const bitmap = await library.bitmap('anchor/bar_counter', 90);
    expect(bitmap.width).toBe(2 * PIXELS_PER_CELL);
    expect(bitmap.height).toBe(5 * PIXELS_PER_CELL);
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
