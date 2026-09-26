import { describe, expect, it } from 'vitest';

import type { Constraints, PlaceType } from '../core/types';

import { resolve } from './resolve';

const PLACE_TYPES: PlaceType[] = ['tavern_hall', 'tavern_room', 'tavern_storeroom'];
const SIZE_HINTS = [undefined, 'small', 'medium', 'large'] as const;

/** Enough seeds to exercise the variation without turning this into a fuzz run. */
const SEEDS = Array.from({ length: 60 }, (_, i) => i - 30);

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
    expect(params.conflicts).toHaveLength(1);
    expect(params.conflicts[0]).toContain('throne');
  });

  it('reports the word as the model wrote it, so the person recognises what they asked for', () => {
    const params = resolve(constraints({ features: ['Marble Fountain'] }), 1);

    expect(params.conflicts[0]).toContain('Marble Fountain');
  });

  it('drops a real feature that does not belong in this kind of place', () => {
    // A bar in a bedroom is ordinary input from somebody talking quickly, not
    // an error to refuse.
    const params = resolve(constraints({ placeType: 'tavern_room', features: ['bar'] }), 1);

    expect(params.features).toEqual([]);
    expect(params.conflicts).toHaveLength(1);
    expect(params.conflicts[0]).toContain('bar');
    expect(params.conflicts[0]).toContain('tavern room');
  });

  it('tells the two kinds of dropped feature apart in words', () => {
    const unknown = resolve(constraints({ placeType: 'tavern_room', features: ['throne'] }), 1).conflicts[0];
    const unsuited = resolve(constraints({ placeType: 'tavern_room', features: ['bar'] }), 1).conflicts[0];

    expect(unknown).not.toEqual(unsuited);
    expect(unknown).toContain('not something the generator can build');
    expect(unsuited).toContain('does not belong');
  });

  it('drops features a small place has no floor for, and says how many fit', () => {
    // Every one of these suits a guest room; the room simply cannot hold them all.
    const params = resolve(
      constraints({ placeType: 'tavern_room', sizeHint: 'small', features: ['hearth', 'alcove', 'shelving', 'bunks'] }),
      1,
    );

    expect(params.features.length).toBeLessThan(4);
    expect(params.conflicts.length).toBeGreaterThan(0);
    expect(params.conflicts.some((line) => line.includes('floor for'))).toBe(true);
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

  it('clamps clutter above the range and says what it did', () => {
    const params = resolve(constraints({ clutter: 1.4 }), 1);

    expect(params.clutter).toBe(1);
    expect(params.conflicts).toHaveLength(1);
    expect(params.conflicts[0]).toContain('1.4');
  });

  it('clamps clutter below the range', () => {
    const params = resolve(constraints({ clutter: -0.5 }), 1);

    expect(params.clutter).toBe(0);
    expect(params.conflicts).toHaveLength(1);
  });

  it('reads clutter that is not a number as an empty floor rather than multiplying by it', () => {
    // Left alone this would reach the generator and be multiplied into a count
    // of props, producing a NaN that surfaces far from here.
    const params = resolve(constraints({ clutter: Number.NaN }), 1);

    expect(params.clutter).toBe(0);
    expect(params.conflicts).toHaveLength(1);
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
