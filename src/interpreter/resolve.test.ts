import { describe, expect, it } from 'vitest';

import type { Constraints, PlaceType, Rng, Size } from '../core/types';

import {
  CLUTTER_NOT_A_NUMBER,
  CLUTTER_OUT_OF_RANGE,
  FEATURE_NOT_IN_PLACE,
  FEATURE_NOT_IN_VOCABULARY,
  FEATURE_OVER_BUDGET,
} from './codes';
import { featureBudget, jitterSize, resolve } from './resolve';

const PLACE_TYPES: PlaceType[] = ['tavern_hall', 'tavern_room', 'tavern_storeroom'];
const SIZE_HINTS = [undefined, 'small', 'medium', 'large'] as const;

/** Enough seeds to exercise the variation without turning this into a fuzz run. */
const SEEDS = Array.from({ length: 60 }, (_, i) => i - 30);

/**
 * The bounds the generator holds a size to, read from `minSize` and `maxSize`
 * on each profile in `src/generator/profiles.ts`.
 *
 * They are copied rather than imported because this layer does not depend on
 * that one — `Params` is the whole of what passes between them. They are
 * structural on the far side: below `minSize` the generator's own geometry
 * stops holding, so it clamps whatever `resolve` hands it into these bounds
 * before building anything.
 *
 * Which makes them the only place a size band can honestly be measured. A band
 * that starts under `minSize` does not produce a smaller place, it produces
 * the same place as the band above it with the difference clamped away, and a
 * test that reads `resolve`'s own output sees three bands where the map has
 * two.
 */
const GENERATOR_BOUNDS: Readonly<Record<PlaceType, { min: Size; max: Size }>> = {
  tavern_hall: { min: { w: 12, h: 10 }, max: { w: 20, h: 18 } },
  tavern_room: { min: { w: 6, h: 6 }, max: { w: 11, h: 10 } },
  tavern_storeroom: { min: { w: 8, h: 6 }, max: { w: 14, h: 12 } },
};

/** `size` as the generator's own `clampSize` would leave it. */
function asBuilt(size: Size, placeType: PlaceType): Size {
  const { min, max } = GENERATOR_BOUNDS[placeType];
  return {
    w: Math.min(max.w, Math.max(min.w, size.w)),
    h: Math.min(max.h, Math.max(min.h, size.h)),
  };
}

function constraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    placeType: 'tavern_hall',
    light: 'dim',
    condition: 'lived_in',
    clutter: 0.3,
    features: [],
    unresolved: [],
    ...overrides,
  };
}

describe('size', () => {
  it('never exceeds 20 by 20, for any place, any hint, any seed', () => {
    // The hard business rule. The largest hall sits at the ceiling on purpose,
    // so the variation has somewhere to overshoot and the cap has to hold.
    for (const placeType of PLACE_TYPES) {
      for (const sizeHint of SIZE_HINTS) {
        for (const seed of SEEDS) {
          const { size } = resolve(constraints({ placeType, sizeHint }), seed);
          expect(size.w).toBeLessThanOrEqual(20);
          expect(size.h).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it('is always whole cells, because there is no half a square on a grid', () => {
    for (const placeType of PLACE_TYPES) {
      for (const seed of SEEDS) {
        const { size } = resolve(constraints({ placeType }), seed);
        expect(Number.isInteger(size.w)).toBe(true);
        expect(Number.isInteger(size.h)).toBe(true);
      }
    }
  });

  it('always leaves floor inside the wall ring', () => {
    for (const placeType of PLACE_TYPES) {
      for (const sizeHint of SIZE_HINTS) {
        for (const seed of SEEDS) {
          const { size } = resolve(constraints({ placeType, sizeHint }), seed);
          expect(size.w).toBeGreaterThan(2);
          expect(size.h).toBeGreaterThan(2);
        }
      }
    }
  });

  it('makes a guest room smaller than the common room it sits above', () => {
    // The map's rule that a tavern room and a tavern hall are different
    // places, not one place with a dial. Compared at their extremes: the
    // largest room must still be smaller than the smallest hall.
    const largestRoom = Math.max(
      ...SEEDS.map((seed) => area(resolve(constraints({ placeType: 'tavern_room', sizeHint: 'large' }), seed).size)),
    );
    const smallestHall = Math.min(
      ...SEEDS.map((seed) => area(resolve(constraints({ placeType: 'tavern_hall', sizeHint: 'small' }), seed).size)),
    );

    expect(largestRoom).toBeLessThan(smallestHall);
  });

  it('grows with the size hint within one kind of place', () => {
    const small = median(SEEDS.map((s) => area(resolve(constraints({ sizeHint: 'small' }), s).size)));
    const medium = median(SEEDS.map((s) => area(resolve(constraints({ sizeHint: 'medium' }), s).size)));
    const large = median(SEEDS.map((s) => area(resolve(constraints({ sizeHint: 'large' }), s).size)));

    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
  });

  it('treats a missing hint as a middling place', () => {
    for (const seed of SEEDS) {
      expect(resolve(constraints({ sizeHint: undefined }), seed).size).toEqual(
        resolve(constraints({ sizeHint: 'medium' }), seed).size,
      );
    }
  });

  it('is not the same rectangle for every seed', () => {
    const shapes = new Set(SEEDS.map((seed) => JSON.stringify(resolve(constraints(), seed).size)));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('never asks for a place smaller than the generator will build', () => {
    // The floor is structural, not a preference: a 2x3 bed needs a room with
    // somewhere to stand beside it. Asked for less, the generator clamps —
    // and a band that lives under the clamp is a band nobody can tell from
    // the one above it.
    for (const placeType of PLACE_TYPES) {
      for (const sizeHint of SIZE_HINTS) {
        for (const seed of SEEDS) {
          const { size } = resolve(constraints({ placeType, sizeHint }), seed);
          const { min } = GENERATOR_BOUNDS[placeType];
          expect(size.w).toBeGreaterThanOrEqual(min.w);
          expect(size.h).toBeGreaterThanOrEqual(min.h);
        }
      }
    }
  });

  it('keeps the three hints apart, measured on the rooms that actually get built', () => {
    // The point of having three hints. Asking for a small storeroom and a
    // medium one used to hand back the same 8-wide room, because both bands
    // sat at or under the generator's floor and the clamp closed the gap.
    // So this compares the footprints as built, and asks that no two hints
    // ever produce the same one — not that the numbers in the table differ.
    for (const placeType of PLACE_TYPES) {
      const built = new Map<string, Set<string>>();
      for (const sizeHint of ['small', 'medium', 'large'] as const) {
        const footprints = SEEDS.map((seed) => {
          const { size } = resolve(constraints({ placeType, sizeHint }), seed);
          const { w, h } = asBuilt(size, placeType);
          return `${String(w)}x${String(h)}`;
        });
        built.set(sizeHint, new Set(footprints));
      }

      for (const [a, b] of [
        ['small', 'medium'],
        ['medium', 'large'],
        ['small', 'large'],
      ] as const) {
        const shared = [...(built.get(a) ?? [])].filter((footprint) => built.get(b)?.has(footprint));
        expect({ placeType, a, b, shared }).toEqual({ placeType, a, b, shared: [] });
      }
    }
  });

  it('gives each hint more than one rectangle to be, so the seed still says something', () => {
    for (const placeType of PLACE_TYPES) {
      for (const sizeHint of ['small', 'medium', 'large'] as const) {
        const built = new Set(
          SEEDS.map((seed) => JSON.stringify(asBuilt(resolve(constraints({ placeType, sizeHint }), seed).size, placeType))),
        );
        expect(built.size).toBeGreaterThan(1);
      }
    }
  });
});

describe('a place type outside the vocabulary', () => {
  it('is refused by name and by value, rather than failing on a missing field later', () => {
    // The cast is the point: nothing at run time stops the interface from
    // handing this straight through from a model's answer, and the failure it
    // used to produce read `Cannot read properties of undefined (reading
    // 'sizes')`, two files away and naming neither the field nor the word.
    const asked = constraints({ placeType: 'throne_room' as PlaceType });

    expect(() => resolve(asked, 1)).toThrow(RangeError);
    expect(() => resolve(asked, 1)).toThrow(/placeType/);
    expect(() => resolve(asked, 1)).toThrow(/throne_room/);
  });

  it('refuses the keys every object carries, rather than reading one as a profile', () => {
    // The table of profiles is an object literal, so it answers to everything
    // `Object.prototype` answers to. Each of these reads back as something
    // other than `undefined` — a function, a method, an object — walks past a
    // guard written against `undefined`, and dies on a missing `sizes` one
    // line later with the raw `TypeError` the guard exists to replace.
    for (const key of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      const asked = constraints({ placeType: key as PlaceType });

      expect(() => resolve(asked, 1)).toThrow(RangeError);
      expect(() => resolve(asked, 1)).toThrow(/placeType/);
      expect(() => resolve(asked, 1)).toThrow(key);
    }
  });

  it('accepts every kind of place the vocabulary does have', () => {
    for (const placeType of PLACE_TYPES) {
      expect(() => resolve(constraints({ placeType }), 1)).not.toThrow();
    }
  });
});

describe('the size cap, reached directly', () => {
  /**
   * An rng that always varies upwards, so nothing but the cap is in the way.
   *
   * The tests above cannot get at this: the tallest profile is 15 cells, so
   * no seed drives the height anywhere near 20 and an assertion about the
   * taller side through `resolve` holds whether the cap is there or not.
   */
  const alwaysUp: Rng = {
    int: () => 1,
    float: () => 1,
    pick: (xs) => xs[0],
  };

  it('holds on both sides of a footprint already at the ceiling', () => {
    expect(jitterSize({ w: 20, h: 20 }, alwaysUp)).toEqual({ w: 20, h: 20 });
  });

  it('holds the taller side alone when only that one is at the ceiling', () => {
    expect(jitterSize({ w: 10, h: 20 }, alwaysUp)).toEqual({ w: 11, h: 20 });
  });

  it('leaves a footprint with room above it free to grow', () => {
    expect(jitterSize({ w: 10, h: 8 }, alwaysUp)).toEqual({ w: 11, h: 9 });
  });
});

describe('the feature budget, reached directly', () => {
  it('never drops below one, however little floor there is', () => {
    // The smallest profile leaves a 4x3 floor, so `resolve` never asks this
    // of a room small enough for the floor to matter. The interface can.
    expect(featureBudget({ w: 3, h: 3 })).toBe(1);
    expect(featureBudget({ w: 2, h: 2 })).toBe(1);
    expect(featureBudget({ w: 1, h: 30 })).toBe(1);
  });

  it('is one feature for every six cells of floor above that', () => {
    expect(featureBudget({ w: 6, h: 5 })).toBe(2);
    expect(featureBudget({ w: 20, h: 15 })).toBe(39);
  });
});

describe('determinism', () => {
  it('gives the same params for the same constraints and seed', () => {
    const asked = constraints({ features: ['bar', 'throne'], clutter: 1.5 });
    expect(resolve(asked, 4242)).toEqual(resolve(asked, 4242));
  });

  it('passes the seed on, so the generator hangs off the same number', () => {
    expect(resolve(constraints(), 99).seed).toBe(99);
  });

  it('refuses a seed that is not an integer', () => {
    // A fractional seed would name a map that cannot be found again.
    expect(() => resolve(constraints(), 1.5)).toThrow(TypeError);
    expect(() => resolve(constraints(), Number.NaN)).toThrow(TypeError);
  });
});

describe('doors', () => {
  it('gives a guest room exactly one way in', () => {
    for (const seed of SEEDS) {
      expect(resolve(constraints({ placeType: 'tavern_room' }), seed).doorCount).toBe(1);
    }
  });

  it('gives the common room at least two, being a room the public walks through', () => {
    for (const seed of SEEDS) {
      const { doorCount } = resolve(constraints({ placeType: 'tavern_hall' }), seed);
      expect(doorCount).toBeGreaterThanOrEqual(2);
      expect(doorCount).toBeLessThanOrEqual(3);
    }
  });

  it('always gives every place a way in, so no floor is sealed off', () => {
    for (const placeType of PLACE_TYPES) {
      for (const seed of SEEDS) {
        expect(resolve(constraints({ placeType }), seed).doorCount).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('carrying the request through', () => {
  it('leaves the fields the generator can honour exactly as asked', () => {
    const asked = constraints({ placeType: 'tavern_storeroom', light: 'dark', condition: 'ruined', clutter: 0.75 });
    const params = resolve(asked, 1);

    expect(params.placeType).toBe('tavern_storeroom');
    expect(params.light).toBe('dark');
    expect(params.condition).toBe('ruined');
    expect(params.clutter).toBe(0.75);
  });

  it('records nothing when everything asked for could be done', () => {
    const params = resolve(constraints({ features: ['bar', 'hearth'] }), 1);

    expect(params.conflicts).toEqual([]);
    expect(params.features).toEqual(['bar', 'hearth']);
  });

  it('keeps a feature the place can hold', () => {
    expect(resolve(constraints({ placeType: 'tavern_room', features: ['bunks'] }), 1).features).toEqual(['bunks']);
  });

  it('normalises a feature the model shouted or padded', () => {
    expect(resolve(constraints({ features: ['  Bar  '] }), 1).features).toEqual(['bar']);
  });

  it('keeps a repeated feature once, and does not call a repeat a conflict', () => {
    const params = resolve(constraints({ features: ['bar', 'bar', 'BAR'] }), 1);

    expect(params.features).toEqual(['bar']);
    expect(params.conflicts).toEqual([]);
  });

  it('ignores an empty feature string without comment', () => {
    const params = resolve(constraints({ features: ['', '  '] }), 1);

    expect(params.features).toEqual([]);
    expect(params.conflicts).toEqual([]);
  });
});

describe('conflicts', () => {
  it('drops a feature the generator has never heard of, and says which word', () => {
    const params = resolve(constraints({ features: ['bar', 'throne'] }), 1);

    expect(params.features).toEqual(['bar']);
    expect(params.conflicts).toEqual([`${FEATURE_NOT_IN_VOCABULARY}:throne`]);
  });

  it('reports the word as the model wrote it, so the person recognises what they asked for', () => {
    const params = resolve(constraints({ features: ['Marble Fountain'] }), 1);

    expect(params.conflicts).toEqual([`${FEATURE_NOT_IN_VOCABULARY}:Marble Fountain`]);
  });

  it('drops a real feature that does not belong in this kind of place', () => {
    // A bar in a bedroom is ordinary input from somebody talking quickly, not
    // an error to refuse. Which bedroom it was is in `placeType`, so the code
    // does not carry it twice.
    const params = resolve(constraints({ placeType: 'tavern_room', features: ['bar'] }), 1);

    expect(params.features).toEqual([]);
    expect(params.conflicts).toEqual([`${FEATURE_NOT_IN_PLACE}:bar`]);
    expect(params.placeType).toBe('tavern_room');
  });

  it('tells the two kinds of dropped feature apart by code, not by wording', () => {
    const unknown = resolve(constraints({ placeType: 'tavern_room', features: ['throne'] }), 1).conflicts[0];
    const unsuited = resolve(constraints({ placeType: 'tavern_room', features: ['bar'] }), 1).conflicts[0];

    expect(unknown).toBe(`${FEATURE_NOT_IN_VOCABULARY}:throne`);
    expect(unsuited).toBe(`${FEATURE_NOT_IN_PLACE}:bar`);
  });

  it('drops features a small place has no floor for, and names each one dropped', () => {
    // Every one of these suits a guest room; the room simply cannot hold them all.
    const params = resolve(
      constraints({ placeType: 'tavern_room', sizeHint: 'small', features: ['hearth', 'alcove', 'shelving', 'bunks'] }),
      1,
    );

    expect(params.features.length).toBeLessThan(4);
    expect(params.conflicts.length).toBeGreaterThan(0);
    expect(params.conflicts.every((line) => line.startsWith(`${FEATURE_OVER_BUDGET}:`))).toBe(true);
    for (const line of params.conflicts) {
      expect(['hearth', 'alcove', 'shelving', 'bunks']).toContain(line.slice(FEATURE_OVER_BUDGET.length + 1));
    }
  });

  it('never drops a feature for want of floor without recording it', () => {
    for (const seed of SEEDS) {
      const asked = ['hearth', 'alcove', 'shelving', 'bunks'];
      const params = resolve(
        constraints({ placeType: 'tavern_room', sizeHint: 'small', features: asked }),
        seed,
      );
      expect(params.conflicts).toHaveLength(asked.length - params.features.length);
    }
  });

  it('keeps at least one feature even in the smallest place', () => {
    for (const seed of SEEDS) {
      const params = resolve(
        constraints({ placeType: 'tavern_room', sizeHint: 'small', features: ['bunks', 'hearth'] }),
        seed,
      );
      expect(params.features.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('clamps clutter above the range and reports the value it was given', () => {
    const params = resolve(constraints({ clutter: 1.4 }), 1);

    expect(params.clutter).toBe(1);
    expect(params.conflicts).toEqual([`${CLUTTER_OUT_OF_RANGE}:1.4`]);
  });

  it('clamps clutter below the range', () => {
    const params = resolve(constraints({ clutter: -0.5 }), 1);

    expect(params.clutter).toBe(0);
    expect(params.conflicts).toEqual([`${CLUTTER_OUT_OF_RANGE}:-0.5`]);
  });

  it('reads clutter that is not a number as an empty floor rather than multiplying by it', () => {
    // Left alone this would reach the generator and be multiplied into a count
    // of props, producing a NaN that surfaces far from here. Nothing useful
    // can be said about the value, so this code carries no detail.
    const params = resolve(constraints({ clutter: Number.NaN }), 1);

    expect(params.clutter).toBe(0);
    expect(params.conflicts).toEqual([CLUTTER_NOT_A_NUMBER]);
  });

  it('reads a clutter that is not a number at all the same way, instead of passing it on', () => {
    // The field is typed `number`, and the value came out of a model through
    // JSON, so the type is a claim rather than a fact. Each of these used to
    // sail through untouched — no conflict, and the word `"lots"` sitting in
    // `Params.clutter` for the generator to multiply a prop count by.
    for (const clutter of [undefined, null, 'lots', {}, [], true] as unknown as number[]) {
      const params = resolve(constraints({ clutter }), 1);

      expect(params.clutter).toBe(0);
      expect(params.conflicts).toEqual([CLUTTER_NOT_A_NUMBER]);
    }
  });

  it('leaves clutter at the edges of the range alone', () => {
    expect(resolve(constraints({ clutter: 0 }), 1).conflicts).toEqual([]);
    expect(resolve(constraints({ clutter: 1 }), 1).conflicts).toEqual([]);
  });

  it('collects every separate reason rather than reporting only the first', () => {
    const params = resolve(constraints({ placeType: 'tavern_room', features: ['bar', 'throne'], clutter: 2 }), 1);

    expect(params.conflicts).toHaveLength(3);
  });
});

function area(size: { w: number; h: number }): number {
  return size.w * size.h;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
