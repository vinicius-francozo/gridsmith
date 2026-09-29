import { describe, expect, it } from 'vitest';

import { createPlaceholderLibrary } from '../assets/placeholder';
import { cellAt, cellKey, inBounds } from '../core/grid';
import { createRng } from '../core/prng';
import type { Params, Place, Scene } from '../core/types';
import { floorCells } from './floorplan';
import { generate } from './generate';
import { profileFor } from './profiles';
import { paramsFor } from './test-fixtures';
import { validateScene } from './validate';

/**
 * The marking library, built once.
 *
 * `generate` reads it to draw a variant for each concept a profile names, and
 * it is a parameter rather than something the generator reaches for so that a
 * real library can take its place without the generator knowing.
 */
const library = createPlaceholderLibrary();

const PLACE_TYPES: Place[] = [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'tavern', room: 'storeroom' }];

describe('the six building-room pairs', () => {
  for (const building of ['tavern', 'dungeon'] as const) {
    for (const room of ['hall', 'room', 'storeroom'] as const) {
      it(`generates a valid ${building}_${room} with its own palette`, () => {
        const place = { building, room };
        const params = paramsFor(place, { size: profileFor(place).maxSize, seed: 42 });
        const scene = generate(params, createRng(42), library);
        expect(validateScene(scene)).toEqual([]);
        expect(scene.props.length).toBeGreaterThan(0);
        expect(scene.props.every((prop) =>
          building === 'tavern' ? !prop.assetId.includes('weapon_') : !prop.assetId.includes('bar_counter'),
        )).toBe(true);
      });
    }
  }
});

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
function busy(place: Place, overrides: Partial<Params> = {}): Params {
  return paramsFor(place, {
    size: profileFor(place).maxSize,
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
    for (const place of PLACE_TYPES) {
      const params = busy(place);
      for (const seed of [0, 1, 42, 9_999]) {
        const first = generate(params, createRng(seed), library);
        const second = generate(params, createRng(seed), library);
        expect(stable(second)).toBe(stable(first));
      }
    }
  });

  it('gives back a different scene for a different seed', () => {
    // A generator that ignored its rng would pass the test above perfectly.
    for (const place of PLACE_TYPES) {
      const params = busy(place);
      const scenes = new Set<string>();
      for (let seed = 0; seed < 12; seed += 1) {
        scenes.add(stable(generate(params, createRng(seed), library)));
      }
      expect(`${place}: ${scenes.size} distinct`).toBe(`${place}: 12 distinct`);
    }
  });

  it('gives back a different scene when the params change under one seed', () => {
    // One param at a time, so that a change satisfied by the scatter layer
    // alone cannot stand in for one that should have moved the groups.
    const scene = (overrides: Partial<Params>): Scene =>
      generate(busy({ building: 'tavern', room: 'hall' }, overrides), createRng(5), library);

    const bare = scene({ clutter: 0, condition: 'lived_in' });
    const full = scene({ clutter: 1, condition: 'lived_in' });
    expect(stable(full)).not.toBe(stable(bare));

    const empty = scene({ furnishing: 0 });
    const packed = scene({ furnishing: 1 });
    expect(stable(packed)).not.toBe(stable(empty));

    const tidy = scene({ clutter: 0.5, condition: 'tidy' });
    const ruined = scene({ clutter: 0.5, condition: 'ruined' });
    expect(stable(ruined)).not.toBe(stable(tidy));
  });

  it('counts furniture off furnishing and dirt off clutter, and neither off the other', () => {
    // Defect D3. "um ambiente sujo" reached `condition: 'ruined'`, which the
    // interpreters turn into `clutter` 0.85, which used to drive the group
    // count — so a filthy hall of 195 floor cells came back with about nine war
    // tables in it. The person asked for dirt and got furniture.
    //
    // Counted rather than compared as whole scenes: the two layers draw from
    // one `Rng`, so moving either number moves the sequence and every scene
    // differs from every other. What must not move is the *count*.
    const scene = (overrides: Partial<Params>, seed = 5): Scene =>
      generate(busy({ building: 'tavern', room: 'hall' }, overrides), createRng(seed), library);
    const countOf = (of: Scene, layer: 'group' | 'scatter'): number =>
      of.props.filter((prop) => prop.layer === layer).length;

    // Clutter across its whole range, furnishing held still: the group count
    // is the same number every time.
    const groupsByClutter = [0, 0.5, 1].map((clutter) =>
      countOf(scene({ clutter, furnishing: 0.5 }), 'group'),
    );
    expect(`groups at clutter 0 / 0.5 / 1: ${groupsByClutter.join(' / ')}`).toBe(
      `groups at clutter 0 / 0.5 / 1: ${String(groupsByClutter[0])} / ${String(groupsByClutter[0])} / ${String(groupsByClutter[0])}`,
    );

    // And furnishing is what does move it — over a run of seeds rather than on
    // one, because a single plan can tie at both ends. Measured on these twelve
    // with all seven features asked for: 238 group props at furnishing 0
    // against 345 at furnishing 1, higher on eleven of them, and seed 5 the
    // exception at 17 either way — a hall carrying three anchors, pillars and
    // an alcove has as much furniture on it as the circulation rule will allow
    // before the dial is consulted. Never *fewer* is held seed by seed, which
    // is the half a tie cannot hide.
    const seeds = Array.from({ length: 12 }, (_, seed) => seed);
    const groupsAt = (furnishing: number): number[] =>
      seeds.map((seed) => countOf(scene({ furnishing, clutter: 0.5 }, seed), 'group'));
    const sparseBySeed = groupsAt(0);
    const crowdedBySeed = groupsAt(1);
    for (const seed of seeds) {
      expect(`seed ${String(seed)}: ${String(crowdedBySeed[seed])} >= ${String(sparseBySeed[seed])}`).toBe(
        `seed ${String(seed)}: ${String(Math.max(crowdedBySeed[seed], sparseBySeed[seed]))} >= ${String(sparseBySeed[seed])}`,
      );
    }
    const total = (counts: number[]): number => counts.reduce((sum, count) => sum + count, 0);
    const sparse = total(sparseBySeed);
    const crowded = total(crowdedBySeed);
    expect(`groups at furnishing 0 / 1 over ${String(seeds.length)} seeds: ${String(sparse)} / ${String(crowded)}`).toBe(
      `groups at furnishing 0 / 1 over ${String(seeds.length)} seeds: ${String(sparse)} / ${String(Math.max(crowded, sparse + 1))}`,
    );

    // The other direction. A bare floor has nothing strewn on it whatever the
    // furniture does, and a hall at full clutter has a great deal — measured on
    // `clutter: 0` rather than as a second inequality, because the scatter
    // chance is the one place the two layers could still be tangled.
    for (const furnishing of [0, 1]) {
      expect(countOf(scene({ clutter: 0, furnishing }), 'scatter')).toBe(0);
      expect(countOf(scene({ clutter: 1, furnishing }), 'scatter')).toBeGreaterThan(0);
    }
  });

  it('produces a scene that passes its own validation, over every place and seed', () => {
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 25; seed += 1) {
        const scene = generate(busy(place), createRng(seed), library);
        const issues = validateScene(scene);
        expect(`${place}/${seed}: ${issues.map((i) => i.message).join('; ')}`).toBe(
          `${place}/${seed}: `,
        );
      }
    }
  });

  it('produces a valid scene at the extremes of clutter and repair', () => {
    for (const place of PLACE_TYPES) {
      for (const clutter of [0, 1]) {
        for (const condition of ['tidy', 'ruined'] as Params['condition'][]) {
          for (let seed = 0; seed < 8; seed += 1) {
            const params = busy(place, { clutter, condition });
            expect(validateScene(generate(params, createRng(seed), library))).toEqual([]);
          }
        }
      }
    }
  });

  it('produces a valid scene at the smallest size each place allows', () => {
    for (const place of PLACE_TYPES) {
      const params = busy(place, { size: profileFor(place).minSize, doorCount: 1 });
      for (let seed = 0; seed < 15; seed += 1) {
        expect(validateScene(generate(params, createRng(seed), library))).toEqual([]);
      }
    }
  });

  it('refuses a place type it has no profile for', () => {
    expect(() => generate(paramsFor({ building: 'tavern', room: 'cellar' } as unknown as Place), createRng(1), library)).toThrow(
      'unknown place',
    );
  });

  it('refuses a condition outside the closed vocabulary', () => {
    // `Params` can arrive from a language model through JSON, and the API
    // does not enforce the schema. Unguarded, the scatter factor is
    // `undefined`, the chance is `NaN`, `rng.float() >= NaN` is false, and
    // every free cell in the room takes a piece of debris — in a scene that
    // still passes `validateScene`, so nothing downstream notices either.
    const params = busy({ building: 'tavern', room: 'hall' }, { condition: 'scorched' as Params['condition'] });
    expect(() => generate(params, createRng(1), library)).toThrow('unknown condition');
  });

  it('refuses a light level outside the closed vocabulary', () => {
    // `dark` is a deliberate `null` in the lamp table, so an unknown level
    // comes back `undefined` and slips past a `!== null` test into a raw
    // `TypeError` from inside the generator.
    const params = busy({ building: 'tavern', room: 'hall' }, { light: 'candlelit' as Params['light'] });
    expect(() => generate(params, createRng(1), library)).toThrow('unknown light level');
  });

  it('refuses a condition that is only a key of Object.prototype', () => {
    // The two tests above are satisfied by a word nothing declares anywhere.
    // These are the other half of the same vocabulary, and the half a lookup
    // against `undefined` lets through: every object literal answers to
    // `toString`, so `CONDITION_SCATTER['toString']` is a function, not
    // `undefined`. `JSON.parse('{"condition":"toString"}')` yields exactly
    // this string, so it arrives by the same route a model's output does —
    // and unguarded it carpeted a 20x18 hall with 167 pieces of debris over
    // 254 floor cells, in a scene `validateScene` had no complaint about.
    for (const key of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      const params = busy({ building: 'tavern', room: 'hall' }, { condition: key as Params['condition'] });
      expect(() => generate(params, createRng(1), library)).toThrow(`unknown condition '${key}'`);
    }
  });

  it('refuses a light level that is only a key of Object.prototype', () => {
    // Same class, and here it does not even throw on its own: a function is
    // not `null`, so `!== null` passes, `.spacing` is `undefined`, the
    // lattice loop starts at `NaN` and never runs, and the room comes back
    // silently unlit but for its hearth.
    for (const key of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      const params = busy({ building: 'tavern', room: 'hall' }, { light: key as Params['light'] });
      expect(() => generate(params, createRng(1), library)).toThrow(`unknown light level '${key}'`);
    }
  });

  it('refuses a place type that is only a key of Object.prototype', () => {
    for (const key of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(() => generate(paramsFor({ building: key, room: 'hall' } as unknown as Place), createRng(1), library)).toThrow(
        `unknown place '${key}_hall'`,
      );
    }
  });
});

describe('the scene generate returns', () => {
  const scenes = (): { place: Place; seed: number; scene: Scene }[] =>
    PLACE_TYPES.flatMap((place) =>
      [0, 1, 2, 3, 4].map((seed) => ({
        place,
        seed,
        scene: generate(busy(place), createRng(seed), library),
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
    for (const { place, seed, scene } of scenes()) {
      const keys = scene.zones.flatMap((zone) => zone.cells.map(cellKey));
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys.length).toBe(floorCells(scene.floorplan).length);
      // The union and the absence of duplicates are both satisfied by
      // dropping every cell into zone 0: one material over the whole room,
      // every other zone empty, and "material by region" quietly undone
      // without a cell being covered twice or left out.
      const empty = scene.zones.filter((zone) => zone.cells.length === 0).length;
      expect(`${place}/${seed}: ${empty} of ${scene.zones.length} zones empty`).toBe(
        `${place}/${seed}: 0 of ${scene.zones.length} zones empty`,
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
    const scene = generate(busy({ building: 'tavern', room: 'hall' }, { light: 'dark' }), createRng(2), library);
    const hearth = scene.props.filter((prop) => prop.assetId === 'anchor/hearth');
    expect(hearth).toHaveLength(1);
    expect(scene.lights).toHaveLength(1);
    expect(scene.lights[0].cell.x).toBeGreaterThanOrEqual(hearth[0].cell.x);
    expect(scene.lights[0].cell.x).toBeLessThan(hearth[0].cell.x + hearth[0].footprint.w);
    expect(scene.lights[0].cell.y).toBeGreaterThanOrEqual(hearth[0].cell.y);
    expect(scene.lights[0].cell.y).toBeLessThan(hearth[0].cell.y + hearth[0].footprint.h);
  });

  it('hangs no lamp in a room described as dark', () => {
    const scene = generate(busy({ building: 'tavern', room: 'storeroom' }, { light: 'dark', features: [] }), createRng(3), library);
    expect(scene.lights).toEqual([]);
  });

  it('hangs more lamps the brighter the room is', () => {
    // The ambient level costs no draw from the rng, so the three rooms are
    // furnished identically and the only difference is the lamps.
    const count = (light: Params['light']): number =>
      generate(busy({ building: 'tavern', room: 'hall' }, { light, features: [] }), createRng(4), library).lights.length;
    expect(count('bright')).toBeGreaterThan(count('dim'));
    expect(count('dim')).toBeGreaterThan(count('dark'));
  });

  it('puts every light on a floor cell, inside the grid', () => {
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 8; seed += 1) {
        const scene = generate(busy(place, { light: 'bright' }), createRng(seed), library);
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
