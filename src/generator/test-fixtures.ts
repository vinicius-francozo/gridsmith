/**
 * Fixtures the generator's tests are written against — **test code only**.
 *
 * Nothing in `src/generator/` outside a `*.test.ts` file may import this
 * module. The name says so because nothing else can: the file has to be
 * reachable from several test files, so it cannot be a `*.test.ts` itself,
 * and no lint rule is configured to enforce the boundary. A stub `Rng` or a
 * plan drawn as art reaching production would look exactly like the real
 * thing and would silently pin the randomness the whole project rests on.
 *
 * A generated plan is a poor thing to assert against: it is twenty cells
 * square and it changes whenever the grammar does. The helpers here build a
 * plan from ASCII art instead, so the wall a test is about is visible in the
 * test, and build the small stubs — a scene around a plan, a run of `Rng`
 * that always takes the low road — that let a stage be exercised one rule at
 * a time.
 */

import { cellAt, inBounds, step } from '../core/grid';
import type {
  CellKind,
  Door,
  Facing,
  Floorplan,
  Params,
  Place,
  PlacedProp,
  Rng,
  Scene,
  Size,
  TileRef,
} from '../core/types';
import { segmentWalls } from './floorplan';

/**
 * A plan drawn as art, one character per cell:
 *
 * - `#` wall
 * - `.` floor
 * - `D` a wall cell holding a door
 * - a space, void
 *
 * @throws {Error} if a row is a different length from the first — a short row
 *                 would read past its end as `undefined`, which is neither
 *                 wall nor floor and would quietly change what is being
 *                 tested — or if a `D` has no single floor cell beside it to
 *                 say which way it faces.
 */
export function planFrom(rows: string[]): Floorplan {
  const size: Size = { w: rows[0].length, h: rows.length };
  rows.forEach((row, y) => {
    if (row.length !== size.w) {
      throw new Error(
        `planFrom(): row ${y} is ${row.length} characters, expected ${size.w} — ragged art`,
      );
    }
  });

  const cells: CellKind[][] = rows.map((row) =>
    [...row].map((glyph) => (glyph === '.' ? 'floor' : glyph === ' ' ? 'void' : 'wall')),
  );

  const doors: Door[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((glyph, x) => {
      if (glyph !== 'D') {
        return;
      }
      const cell = { x, y };
      const facings: Facing[] = ['n', 'e', 's', 'w'];
      const inward = facings.filter((facing) => {
        const next = step(cell, facing);
        return inBounds(next, size) && cellAt(cells, next) === 'floor';
      });
      if (inward.length !== 1) {
        throw new Error(
          `planFrom(): the door at ${x},${y} has ${inward.length} floor cells beside it, so it faces nowhere in particular`,
        );
      }
      const opposites: Record<Facing, Facing> = { n: 's', s: 'n', e: 'w', w: 'e' };
      doors.push({ cell, facing: opposites[inward[0]] });
    });
  });

  return { size, cells, doors, walls: segmentWalls(cells, size) };
}

/**
 * A scene wrapped around a plan and a prop list, with one flat tile per cell.
 *
 * The tiles are filler: the validation pass never reads them, and a test
 * about a blocked door should not have to describe a floor.
 */
export function sceneFrom(floorplan: Floorplan, props: PlacedProp[] = []): Scene {
  const tiles: TileRef[][] = Array.from({ length: floorplan.size.h }, () =>
    new Array<TileRef>(floorplan.size.w).fill({ material: 'stone_floor', variant: 0, rotation: 0 }),
  );
  return { floorplan, zones: [], tiles, props, lights: [] };
}

/** Concrete params for `place`, with whatever a test cares about changed. */
export function paramsFor(place: Place, overrides: Partial<Params> = {}): Params {
  const base: Params = {
    place,
    size: { w: 14, h: 12 },
    light: 'dim',
    condition: 'lived_in',
    clutter: 0.5,
    // The same figure `clutter` carries, so that the tests written when one
    // number drove both the scatter layer and the group count keep asserting
    // the counts they were written against. The split is what is new; the
    // midpoint is not.
    furnishing: 0.5,
    features: [],
    excluded: [],
    doorCount: 1,
    seed: 1,
    conflicts: [],
  };
  return { ...base, ...overrides };
}

/**
 * An `Rng` that always takes the lowest value on offer.
 *
 * Randomness is what makes a generated plan hard to assert against, so a
 * stage's *rule* is tested with the randomness pinned and its *variety* is
 * tested over a spread of real seeds.
 */
export function minRng(): Rng {
  return {
    float: () => 0,
    int: (min) => min,
    pick: <T>(xs: T[]): T => xs[0],
  };
}

/** An `Rng` that always takes the highest value on offer. */
export function maxRng(): Rng {
  return {
    float: () => 0.999_999,
    int: (_min, max) => max,
    pick: <T>(xs: T[]): T => xs[xs.length - 1],
  };
}
