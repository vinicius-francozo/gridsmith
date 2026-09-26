import { describe, expect, it } from 'vitest';

import type { AssetDef, AssetKind, PlacedProp, Rotation } from '../core/types';
import {
  ASSET_KINDS,
  MAX_FOOTPRINT_CELLS,
  PIXELS_PER_CELL,
  ROTATIONS,
  assertAssetDef,
  expectedBitmapSize,
  rotatedFootprint,
  tileAssetId,
  validateAssetDef,
  validateBitmapSize,
  validateCatalog,
  validatePlacement,
} from './contract';

/** A contract-clean definition, with the field under test overridden. */
function def(overrides: Partial<AssetDef> = {}): AssetDef {
  return {
    id: 'group/table_long',
    kind: 'group',
    footprint: { w: 3, h: 1 },
    tags: ['table', 'wood'],
    againstWall: false,
    ...overrides,
  };
}

/** A placement of `asset`, with the field under test overridden. */
function placement(asset: AssetDef, overrides: Partial<PlacedProp> = {}): PlacedProp {
  return {
    assetId: asset.id,
    cell: { x: 2, y: 3 },
    footprint: asset.footprint,
    rotation: 0,
    layer: 'group',
    ...overrides,
  };
}

describe('the kind and rotation tables', () => {
  it('lists every asset kind', () => {
    expect([...ASSET_KINDS].sort()).toEqual(['anchor', 'group', 'scatter', 'tile']);
  });

  it('lists every rotation in turning order', () => {
    expect([...ROTATIONS]).toEqual([0, 90, 180, 270]);
  });
});

describe('tileAssetId', () => {
  it('joins a material and a variant into one key', () => {
    expect(tileAssetId('oak_plank', 2)).toBe('tile/oak_plank/2');
  });

  it('separates variants of the same material', () => {
    expect(tileAssetId('oak_plank', 0)).not.toBe(tileAssetId('oak_plank', 1));
  });

  it('rejects an empty material name', () => {
    expect(() => tileAssetId('', 0)).toThrow(RangeError);
  });

  it('rejects a variant that is not a non-negative integer', () => {
    expect(() => tileAssetId('oak_plank', -1)).toThrow(RangeError);
    expect(() => tileAssetId('oak_plank', 0.5)).toThrow(RangeError);
  });
});

describe('rotatedFootprint', () => {
  it('leaves the footprint alone on a half turn', () => {
    expect(rotatedFootprint({ w: 3, h: 1 }, 0)).toEqual({ w: 3, h: 1 });
    expect(rotatedFootprint({ w: 3, h: 1 }, 180)).toEqual({ w: 3, h: 1 });
  });

  it('swaps the axes on a quarter turn', () => {
    // A 4x1 bar counter laid along the north wall is 1x4 against the east one.
    expect(rotatedFootprint({ w: 4, h: 1 }, 90)).toEqual({ w: 1, h: 4 });
    expect(rotatedFootprint({ w: 4, h: 1 }, 270)).toEqual({ w: 1, h: 4 });
  });

  it('rejects a rotation outside the closed set', () => {
    // External data can carry a 45 that TypeScript never saw.
    expect(() => rotatedFootprint({ w: 1, h: 1 }, 45 as Rotation)).toThrow(RangeError);
  });
});

describe('expectedBitmapSize', () => {
  it('is the placed footprint at the grid pitch', () => {
    expect(expectedBitmapSize(def({ footprint: { w: 2, h: 1 } }), 0)).toEqual({
      w: 2 * PIXELS_PER_CELL,
      h: 1 * PIXELS_PER_CELL,
    });
  });

  it('follows the quarter turn', () => {
    expect(expectedBitmapSize(def({ footprint: { w: 2, h: 1 } }), 90)).toEqual({
      w: 1 * PIXELS_PER_CELL,
      h: 2 * PIXELS_PER_CELL,
    });
  });

  it('rejects a footprint that is not a positive whole size', () => {
    expect(() => expectedBitmapSize(def({ footprint: { w: 0, h: 1 } }), 0)).toThrow(RangeError);
  });
});

describe('validateAssetDef', () => {
  it('passes a clean definition', () => {
    expect(validateAssetDef(def())).toEqual([]);
  });

  it('rejects an id that is not a slug', () => {
    for (const id of ['', 'Group/Table', 'group table', '/leading', 'café']) {
      expect(validateAssetDef(def({ id })).join(' ')).toContain('is not a slug');
    }
  });

  it('accepts the slug characters a real library needs', () => {
    for (const id of ['tile/oak_plank/0', 'anchor/bar-counter', 'scatter/shard.a']) {
      expect(validateAssetDef(def({ id }))).toEqual([]);
    }
  });

  it('rejects a kind outside the closed set', () => {
    expect(validateAssetDef(def({ kind: 'prop' as AssetKind })).join(' ')).toContain(
      'is not one of',
    );
  });

  it('rejects a footprint that is not a positive whole number of cells', () => {
    expect(validateAssetDef(def({ footprint: { w: 0, h: 1 } })).join(' ')).toContain('footprint.w');
    expect(validateAssetDef(def({ footprint: { w: 2, h: -1 } })).join(' ')).toContain('footprint.h');
    expect(validateAssetDef(def({ footprint: { w: 1.5, h: 1 } })).join(' ')).toContain('footprint.w');
  });

  it('rejects a footprint larger than the map it would sit on', () => {
    const tooWide = MAX_FOOTPRINT_CELLS + 1;
    expect(validateAssetDef(def({ footprint: { w: tooWide, h: 1 } })).join(' ')).toContain(
      'map cap',
    );
    expect(validateAssetDef(def({ footprint: { w: MAX_FOOTPRINT_CELLS, h: 1 } }))).toEqual([]);
  });

  it('rejects a tile that claims more than one cell', () => {
    // A TileRef describes exactly one cell, so a 2x1 tile would be drawn once
    // per cell it covers and overlap itself.
    const issues = validateAssetDef(
      def({ id: 'tile/oak_plank/0', kind: 'tile', footprint: { w: 2, h: 1 } }),
    );
    expect(issues.join(' ')).toContain('covers exactly one cell');
  });

  it('rejects a tile that claims to be against a wall', () => {
    const issues = validateAssetDef(
      def({ id: 'tile/oak_plank/0', kind: 'tile', footprint: { w: 1, h: 1 }, againstWall: true }),
    );
    expect(issues.join(' ')).toContain('cannot be against a wall');
  });

  it('passes a well-formed tile', () => {
    expect(
      validateAssetDef(
        def({ id: 'tile/oak_plank/0', kind: 'tile', footprint: { w: 1, h: 1 }, tags: ['wood'] }),
      ),
    ).toEqual([]);
  });

  it('rejects an empty or repeated tag', () => {
    expect(validateAssetDef(def({ tags: ['table', ''] })).join(' ')).toContain('empty string');
    expect(validateAssetDef(def({ tags: ['table', 'table'] })).join(' ')).toContain('listed twice');
  });

  it('rejects a definition with no id at all, which the slug test would pass', () => {
    // `RegExp.test` coerces: an absent id becomes the string "undefined",
    // which is a valid slug. Tracked end to end, such an asset is reported
    // clean, accepted by the library, returned by `query()` so the generator
    // picks it — and never resolves through `get()`, because it was indexed
    // under the key `undefined`. It lands on the map as a magenta rectangle,
    // out of a library the validator called sound.
    const issues = validateAssetDef({ ...def(), id: undefined } as unknown as AssetDef);
    expect(issues.join(' ')).toContain('id must be a string');
  });

  it('rejects an id that is not a string at all', () => {
    for (const id of [undefined, null, 7, {}]) {
      const issues = validateAssetDef({ ...def(), id } as unknown as AssetDef);
      expect(issues.join(' ')).toContain('id must be a string');
    }
  });

  it('rejects a missing or malformed againstWall instead of reading it as false', () => {
    // It steers prop placement: an asset that never says whether it belongs
    // against a wall would be placed as if it did not, silently.
    for (const againstWall of [undefined, null, 'true', 1]) {
      const issues = validateAssetDef({ ...def(), againstWall } as unknown as AssetDef);
      expect(issues.join(' ')).toContain('againstWall must be a boolean');
    }
    expect(validateAssetDef(def({ againstWall: true }))).toEqual([]);
  });

  it('reports a malformed shape instead of throwing on it', () => {
    // The whole point of returning a list is that a report over a library
    // names every fault at once. Throwing on a missing field means one bad
    // line in a manifest takes the entire report down with it.
    for (const broken of [
      { ...def(), footprint: undefined },
      { ...def(), footprint: null },
      { ...def(), footprint: 'big' },
      { ...def(), tags: undefined },
      { ...def(), tags: 'table' },
      { ...def(), tags: 7 },
    ]) {
      const call = (): string[] => validateAssetDef(broken as unknown as AssetDef);
      expect(call).not.toThrow();
      expect(call().length).toBeGreaterThan(0);
    }
  });

  it('names a missing footprint and a missing tag list for what they are', () => {
    expect(
      validateAssetDef({ ...def(), footprint: undefined } as unknown as AssetDef).join(' '),
    ).toContain('footprint must be a size in cells, got undefined');
    expect(
      validateAssetDef({ ...def(), tags: undefined } as unknown as AssetDef).join(' '),
    ).toContain('tags must be an array');
  });

  it('says null rather than object for a footprint that is null', () => {
    // `typeof null` is "object", which is the one answer the reader of a
    // report cannot act on: a footprint that really is an object has a shape
    // to fix, and one that is null has a field to supply.
    expect(
      validateAssetDef({ ...def(), footprint: null } as unknown as AssetDef).join(' '),
    ).toContain('footprint must be a size in cells, got null');
  });

  it('rejects a tag that is not a string', () => {
    expect(
      validateAssetDef({ ...def(), tags: ['table', 7] } as unknown as AssetDef).join(' '),
    ).toContain('tags must be strings');
  });

  it('reports every fault at once rather than only the first', () => {
    const issues = validateAssetDef(
      def({ id: 'Bad Id', kind: 'prop' as AssetKind, footprint: { w: 0, h: 0 } }),
    );
    expect(issues.length).toBeGreaterThanOrEqual(4);
  });
});

describe('assertAssetDef', () => {
  it('says nothing about a clean definition', () => {
    expect(() => assertAssetDef(def())).not.toThrow();
  });

  it('throws naming the asset and the violation', () => {
    expect(() => assertAssetDef(def({ id: 'Bad Id' }))).toThrow(TypeError);
    expect(() => assertAssetDef(def({ tags: ['a', 'a'] }))).toThrow(/listed twice/);
  });
});

describe('validateCatalog', () => {
  it('passes a clean catalogue', () => {
    expect(validateCatalog([def(), def({ id: 'anchor/hearth', kind: 'anchor' })])).toEqual([]);
  });

  it('catches an asset with no id, which would be indexed under `undefined`', () => {
    const issues = validateCatalog([{ ...def(), id: undefined } as unknown as AssetDef]);
    expect(issues.join(' ')).toContain('id must be a string');
  });

  it('survives a malformed entry and still reports the rest of the library', () => {
    const issues = validateCatalog([
      { ...def(), id: 'group/a', footprint: undefined } as unknown as AssetDef,
      def({ id: 'group/b', tags: ['a', 'a'] }),
    ]);
    expect(issues.join(' ')).toContain('group/a: footprint must be a size in cells');
    expect(issues.join(' ')).toContain('group/b: tag "a" is listed twice');
  });

  it('catches a duplicate id, which no single definition can be wrong about', () => {
    // `get()` would resolve to whichever entry won, and the map would draw the
    // wrong prop forever without a single definition being invalid.
    const issues = validateCatalog([def(), def()]);
    expect(issues.join(' ')).toContain('declared twice');
  });

  it('prefixes each definition’s issues with the asset it came from', () => {
    expect(validateCatalog([def({ id: 'group/x', tags: ['a', 'a'] })])).toEqual([
      'group/x: tag "a" is listed twice',
    ]);
  });
});

describe('validateBitmapSize', () => {
  it('passes a bitmap drawn at the grid pitch', () => {
    const asset = def({ footprint: { w: 2, h: 1 } });
    expect(validateBitmapSize(asset, 0, { w: 140, h: 70 })).toEqual([]);
  });

  it('follows the rotation rather than the declared footprint', () => {
    const asset = def({ footprint: { w: 2, h: 1 } });
    expect(validateBitmapSize(asset, 90, { w: 70, h: 140 })).toEqual([]);
    expect(validateBitmapSize(asset, 90, { w: 140, h: 70 }).join(' ')).toContain('expected 70x140');
  });

  it('catches art drawn at the wrong pixels per cell', () => {
    // 64px-per-cell art is the most common mistake a downloaded pack makes,
    // and it lines up at the top-left and drifts from there.
    const asset = def({ footprint: { w: 2, h: 1 } });
    expect(validateBitmapSize(asset, 0, { w: 128, h: 64 }).join(' ')).toContain('expected 140x70');
  });
});

describe('validatePlacement', () => {
  it('passes a placement that matches its asset', () => {
    const asset = def();
    expect(validatePlacement(asset, placement(asset))).toEqual([]);
  });

  it('refuses to judge a placement of a different asset', () => {
    const asset = def();
    const issues = validatePlacement(asset, placement(asset, { assetId: 'anchor/hearth' }));
    expect(issues.join(' ')).toContain('was checked against');
  });

  it('rejects a floor tile placed as a prop', () => {
    const tile = def({ id: 'tile/oak_plank/0', kind: 'tile', footprint: { w: 1, h: 1 } });
    const issues = validatePlacement(tile, placement(tile, { layer: 'scatter' }));
    expect(issues.join(' ')).toContain('cannot be placed as a prop');
  });

  it('rejects an asset placed on a layer that is not its kind', () => {
    const asset = def();
    const issues = validatePlacement(asset, placement(asset, { layer: 'scatter' }));
    expect(issues.join(' ')).toContain('placed on the scatter layer');
  });

  it('rejects a rotation that disagrees with the reserved footprint', () => {
    // The generator reserves cells in map space; if the rotation says the
    // asset is 1x3 and the reservation says 3x1, one of the two is painting
    // somewhere nothing was cleared for it.
    const asset = def({ footprint: { w: 3, h: 1 } });
    const issues = validatePlacement(
      asset,
      placement(asset, { rotation: 90, footprint: { w: 3, h: 1 } }),
    );
    expect(issues.join(' ')).toContain('occupies 1x3 cells');
  });

  it('accepts a turned placement whose reservation was turned with it', () => {
    const asset = def({ footprint: { w: 3, h: 1 } });
    expect(
      validatePlacement(asset, placement(asset, { rotation: 90, footprint: { w: 1, h: 3 } })),
    ).toEqual([]);
  });
});
