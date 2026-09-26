import { describe, expect, it } from 'vitest';

import type { Params, PlaceType } from '../core/types';

import { FILENAME_PREFIX, mapFilename } from './download';

function paramsFor(overrides: Partial<Params> = {}): Params {
  return {
    placeType: 'tavern_hall',
    size: { w: 16, h: 14 },
    light: 'dim',
    condition: 'lived_in',
    clutter: 0.4,
    features: [],
    doorCount: 2,
    seed: 4242,
    conflicts: [],
    ...overrides,
  };
}

describe('naming the exported map', () => {
  it('carries the kind of place and the seed', () => {
    // A folder of exports is the index of which number produced what. Both
    // halves have to be in the name or the map cannot be found again.
    const name = mapFilename(paramsFor());

    expect(name).toContain('tavern-hall');
    expect(name).toContain('4242');
  });

  it('is a PNG, under the project prefix', () => {
    const name = mapFilename(paramsFor());

    expect(name.startsWith(`${FILENAME_PREFIX}-`)).toBe(true);
    expect(name.endsWith('.png')).toBe(true);
  });

  it('gives two seeds of the same place two names', () => {
    expect(mapFilename(paramsFor({ seed: 1 }))).not.toBe(mapFilename(paramsFor({ seed: 2 })));
  });

  it('gives two kinds of place at one seed two names', () => {
    const names = (['tavern_hall', 'tavern_room', 'tavern_storeroom'] as PlaceType[]).map(
      (placeType) => mapFilename(paramsFor({ placeType })),
    );

    expect(new Set(names).size).toBe(3);
  });

  it('cannot be talked into a path', () => {
    // `placeType` is closed by the schema before it reaches here, but this name
    // is handed to an operating system, and a slash in one is worth a line to
    // make impossible rather than a paragraph to reason about.
    const name = mapFilename(paramsFor({ placeType: '../../etc/passwd' as PlaceType }));

    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
  });

  it('does not open the distinguishing part with a hyphen', () => {
    // A negative seed would otherwise produce `gridsmith-tavern-hall-semente--7`,
    // and a name beginning a segment with a hyphen is read as a flag by some
    // shells.
    const name = mapFilename(paramsFor({ seed: -7 }));

    expect(name).toContain('7');
    expect(name).not.toContain('--');
  });
});
