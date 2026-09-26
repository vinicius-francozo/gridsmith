import { describe, expect, it } from 'vitest';

import { cellAt, cellKey, inBounds } from '../core/grid';
import { createRng } from '../core/prng';
import type { Params, PlaceType, Scene } from '../core/types';
import { floorCells } from './floorplan';
import { generate } from './generate';
import { profileFor } from './profiles';
import { paramsFor } from './testing';
import { validateScene } from './validate';

const PLACE_TYPES: PlaceType[] = ['tavern_hall', 'tavern_room', 'tavern_storeroom'];

/**
 * A serialisation that does not depend on the order keys were written in.
 *
 * Two scenes built the same way will always have their keys in the same
 * order, so plain `JSON.stringify` would compare equal even if the generator
 * had started building objects differently. Sorting the keys means the
 * comparison is about the map and nothing else.
 */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return raw;
    }
    const record = raw as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  });
}

/** Params that exercise as much of a profile as its place allows. */
function busy(placeType: PlaceType, overrides: Partial<Params> = {}): Params {
  return paramsFor(placeType, {
    size: profileFor(placeType).maxSize,
    doorCount: 2,
    clutter: 0.6,
    features: ['bar', 'hearth', 'stairs', 'pillars', 'alcove', 'shelving', 'bunks'],
    ...overrides,
  });
}

describe('stable', () => {
  it('sees through the order the keys were written in', () => {
    expect(stable({ b: 1, a: 2 })).toBe(stable({ a: 2, b: 1 }));
  });

  it('still separates two different values', () => {
    expect(stable({ a: 1 })).not.toBe(stable({ a: 2 }));
  });

  it('keeps the order of an array, which is part of the value', () => {
    expect(stable([1, 2])).not.toBe(stable([2, 1]));
  });
});

describe('generate', () => {
  it('gives back the same scene, cell for cell, for the same params and seed', () => {
    // The invariant the whole project rests on. Without it a map cannot be
    // regenerated, shared by seed, or edited a piece at a time later on.
    for (const placeType of PLACE_TYPES) {
      const params = busy(placeType);
      for (const seed of [0, 1, 42, 9_999]) {
        const first = generate(params, createRng(seed));
        const second = generate(params, createRng(seed));
        expect(stable(second)).toBe(stable(first));
      }
    }
  });

  it('gives back a different scene for a different seed', () => {
    // A generator that ignored its rng would pass the test above perfectly.
    for (const placeType of PLACE_TYPES) {
      const params = busy(placeType);
      const scenes = new Set<string>();
      for (let seed = 0; seed < 12; seed += 1) {
        scenes.add(stable(generate(params, createRng(seed))));
      }
      expect(`${placeType}: ${scenes.size} distinct`).toBe(`${placeType}: 12 distinct`);
    }
  });

  it('gives back a different scene when the params change under one seed', () => {
    // One param at a time. Moving clutter and condition together is satisfied
    // by the scatter layer alone, and clutter's other job — how many groups a
    // room of this size wants — is then left with no test at all.
    const scene = (overrides: Partial<Params>): Scene =>
      generate(busy('tavern_hall', overrides), createRng(5));
    const groupCount = (of: Scene): number =>
      of.props.filter((prop) => prop.layer === 'group').length;

    const bare = scene({ clutter: 0, condition: 'lived_in' });
    const full = scene({ clutter: 1, condition: 'lived_in' });
    expect(stable(full)).not.toBe(stable(bare));
    expect(`groups at clutter 0 / 1: ${groupCount(bare)} / ${groupCount(full)}`).toBe(
      `groups at clutter 0 / 1: ${groupCount(bare)} / ${Math.max(groupCount(full), groupCount(bare) + 1)}`,
    );

    const tidy = scene({ clutter: 0.5, condition: 'tidy' });
    const ruined = scene({ clutter: 0.5, condition: 'ruined' });
    expect(stable(ruined)).not.toBe(stable(tidy));
  });

  it('produces a scene that passes its own validation, over every place and seed', () => {
    for (const placeType of PLACE_TYPES) {
      for (let seed = 0; seed < 25; seed += 1) {
        const scene = generate(busy(placeType), createRng(seed));
        const issues = validateScene(scene);
        expect(`${placeType}/${seed}: ${issues.map((i) => i.message).join('; ')}`).toBe(
          `${placeType}/${seed}: `,
        );
      }
    }
  });

  it('produces a valid scene at the extremes of clutter and repair', () => {
    for (const placeType of PLACE_TYPES) {
      for (const clutter of [0, 1]) {
        for (const condition of ['tidy', 'ruined'] as Params['condition'][]) {
          for (let seed = 0; seed < 8; seed += 1) {
            const params = busy(placeType, { clutter, condition });
            expect(validateScene(generate(params, createRng(seed)))).toEqual([]);
          }
        }
      }
    }
  });

  it('produces a valid scene at the smallest size each place allows', () => {
    for (const placeType of PLACE_TYPES) {
      const params = busy(placeType, { size: profileFor(placeType).minSize, doorCount: 1 });
      for (let seed = 0; seed < 15; seed += 1) {
        expect(validateScene(generate(params, createRng(seed)))).toEqual([]);
      }
    }
  });

  it('refuses a place type it has no profile for', () => {
    expect(() => generate(paramsFor('tavern_cellar' as PlaceType), createRng(1))).toThrow(
      'unknown place type',
    );
  });
});

describe('the scene generate returns', () => {
  const scenes = (): { placeType: PlaceType; seed: number; scene: Scene }[] =>
    PLACE_TYPES.flatMap((placeType) =>
      [0, 1, 2, 3, 4].map((seed) => ({
        placeType,
        seed,
        scene: generate(busy(placeType), createRng(seed)),
      })),
    );

  it('sizes the tile grid to the plan, row for row', () => {
    for (const { scene } of scenes()) {
      expect(scene.tiles).toHaveLength(scene.floorplan.size.h);
      for (const row of scene.tiles) {
        expect(row).toHaveLength(scene.floorplan.size.w);
      }
    }
  });

  it('stays inside the twenty-cell ceiling of the project', () => {
    for (const { scene } of scenes()) {
      expect(scene.floorplan.size.w).toBeLessThanOrEqual(20);
      expect(scene.floorplan.size.h).toBeLessThanOrEqual(20);
    }
  });

  it('covers every floor cell with a zone, no cell twice, and leaves no zone empty', () => {
    for (const { placeType, seed, scene } of scenes()) {
      const keys = scene.zones.flatMap((zone) => zone.cells.map(cellKey));
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.length).toBe(floorCells(scene.floorplan).length);
      // The union and the absence of duplicates are both satisfied by
      // dropping every cell into zone 0: one material over the whole room,
      // every other zone empty, and "material by region" quietly undone
      // without a cell being covered twice or left out.
      const empty = scene.zones.filter((zone) => zone.cells.length === 0).length;
      expect(`${placeType}/${seed}: ${empty} of ${scene.zones.length} zones empty`).toBe(
        `${placeType}/${seed}: 0 of ${scene.zones.length} zones empty`,
      );
    }
  });

  it('keeps every prop on the floor and inside the grid', () => {
    for (const { scene } of scenes()) {
      for (const prop of scene.props) {
        for (let dy = 0; dy < prop.footprint.h; dy += 1) {
          for (let dx = 0; dx < prop.footprint.w; dx += 1) {
            const cell = { x: prop.cell.x + dx, y: prop.cell.y + dy };
            expect(inBounds(cell, scene.floorplan.size)).toBe(true);
            expect(cellAt(scene.floorplan.cells, cell)).toBe('floor');
          }
        }
      }
    }
  });
});

describe('the lights of a scene', () => {
  it('lights a hearth from where the hearth stands', () => {
    const scene = generate(busy('tavern_hall', { light: 'dark' }), createRng(2));
    const hearth = scene.props.filter((prop) => prop.assetId === 'anchor/hearth');
    expect(hearth).toHaveLength(1);
    expect(scene.lights).toHaveLength(1);
    expect(scene.lights[0].cell.x).toBeGreaterThanOrEqual(hearth[0].cell.x);
    expect(scene.lights[0].cell.x).toBeLessThan(hearth[0].cell.x + hearth[0].footprint.w);
    expect(scene.lights[0].cell.y).toBeGreaterThanOrEqual(hearth[0].cell.y);
    expect(scene.lights[0].cell.y).toBeLessThan(hearth[0].cell.y + hearth[0].footprint.h);
  });

  it('hangs no lamp in a room described as dark', () => {
    const scene = generate(busy('tavern_storeroom', { light: 'dark', features: [] }), createRng(3));
    expect(scene.lights).toEqual([]);
  });

  it('hangs more lamps the brighter the room is', () => {
    // The ambient level costs no draw from the rng, so the three rooms are
    // furnished identically and the only difference is the lamps.
    const count = (light: Params['light']): number =>
      generate(busy('tavern_hall', { light, features: [] }), createRng(4)).lights.length;
    expect(count('bright')).toBeGreaterThan(count('dim'));
    expect(count('dim')).toBeGreaterThan(count('dark'));
  });

  it('puts every light on a floor cell, inside the grid', () => {
    for (const placeType of PLACE_TYPES) {
      for (let seed = 0; seed < 8; seed += 1) {
        const scene = generate(busy(placeType, { light: 'bright' }), createRng(seed));
        for (const source of scene.lights) {
          expect(inBounds(source.cell, scene.floorplan.size)).toBe(true);
          expect(cellAt(scene.floorplan.cells, source.cell)).toBe('floor');
          expect(source.radiusCells).toBeGreaterThan(0);
          expect(source.colorHex).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
  });
});
