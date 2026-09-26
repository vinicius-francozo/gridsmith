/**
 * Turning what was asked for into what can be built.
 *
 * `Constraints` is a wish. `Params` is a plan: every value concrete, every
 * size legal, and every part of the wish that did not survive written down in
 * `conflicts` with the reason. The distinction matters because an incoherent
 * description — a bar in a bedroom, a floor that is 140% covered — is ordinary
 * input from somebody talking quickly at a table, not an error. Refusing it
 * would be the wrong answer; silently dropping it would be worse, because the
 * map would come back missing something and nothing would say why.
 *
 * This is a pure function. It reaches the network never, `Math.random` never,
 * and the clock never: the same constraints and the same seed give the same
 * `Params` forever, which is the whole basis of being able to regenerate a map
 * from a description and a number.
 */

import { createRng } from '../core/prng';
import type { Constraints, Params, PlaceType, Rng, Size } from '../core/types';

import { featureSuits, isFeature } from './vocabulary';
import type { Feature } from './vocabulary';

/** No map is larger than this on either side. From the map's business rules. */
const MAX_SIDE = 20;

/**
 * Floor cells a place needs before it can carry one more feature.
 *
 * Features become anchors — a bar, a hearth, a stair — and an anchor eats wall
 * and the floor in front of it. Six cells apiece is what keeps a small room
 * from being asked to hold four of them and coming back impassable.
 */
const CELLS_PER_FEATURE = 6;

/** How large a place of a given kind is, and how many ways in it has. */
type PlaceProfile = {
  /** Footprint including the wall ring, by `sizeHint`. */
  readonly sizes: Readonly<Record<NonNullable<Constraints['sizeHint']>, Size>>;
  /** The range of doors this kind of place has. Inclusive. */
  readonly doors: { readonly min: number; readonly max: number };
};

/**
 * The three kinds of tavern space, at their three sizes.
 *
 * These are footprints, so the wall ring is included: a 6x5 room has a 4x3
 * floor inside it. The relative scale is the point — the largest guest room,
 * varied upwards, is still smaller than the smallest common room varied
 * downwards, because they are different kinds of place and not one place with
 * a dial on it. `resolve.test.ts` holds the tables to that.
 */
const PROFILES: Readonly<Record<PlaceType, PlaceProfile>> = {
  tavern_room: {
    sizes: { small: { w: 6, h: 5 }, medium: { w: 8, h: 6 }, large: { w: 10, h: 8 } },
    // A guest room has one way in. That is what makes it a place you can be
    // cornered in, which is the reason to fight in one.
    doors: { min: 1, max: 1 },
  },
  tavern_storeroom: {
    sizes: { small: { w: 6, h: 6 }, medium: { w: 8, h: 7 }, large: { w: 11, h: 9 } },
    // The stair down, and often a hatch to the street for deliveries.
    doors: { min: 1, max: 2 },
  },
  tavern_hall: {
    sizes: { small: { w: 13, h: 10 }, medium: { w: 16, h: 12 }, large: { w: 20, h: 15 } },
    // A room the public uses has a front door and a way into the back.
    doors: { min: 2, max: 3 },
  },
};

/** What a place is when the description said nothing about size. */
const DEFAULT_SIZE_HINT = 'medium';

/**
 * The concrete parameters for `constraints`, at `seed`.
 *
 * The seed is both used and passed on: it settles the choices left open here —
 * the exact footprint within the kind, how many doors — and then travels in
 * `Params.seed` so the generator's own choices hang off the same number. One
 * seed, one map, all the way down.
 *
 * @throws {TypeError} if `seed` is not an integer, from `createRng`. A
 *                     fractional seed would name a map that cannot be found
 *                     again.
 */
export function resolve(constraints: Constraints, seed: number): Params {
  const rng = createRng(seed);
  const conflicts: string[] = [];

  const profile = PROFILES[constraints.placeType];
  const size = jitterSize(profile.sizes[constraints.sizeHint ?? DEFAULT_SIZE_HINT], rng);
  const doorCount = rng.int(profile.doors.min, profile.doors.max);

  const features = resolveFeatures(constraints, size, conflicts);
  const clutter = resolveClutter(constraints.clutter, conflicts);

  return {
    placeType: constraints.placeType,
    size,
    light: constraints.light,
    condition: constraints.condition,
    clutter,
    features,
    doorCount,
    seed,
    conflicts,
  };
}

/**
 * The profile footprint, varied by a cell on each side and capped.
 *
 * Two halls generated from the same words should not be the same rectangle;
 * the kind of place fixes the scale, the seed fixes the room. The cap is the
 * hard rule — nothing is ever wider or taller than `MAX_SIDE` — and it is
 * applied after the variation, not before, because that is where it can
 * actually be exceeded.
 */
function jitterSize(base: Size, rng: Rng): Size {
  return {
    w: Math.min(MAX_SIDE, base.w + rng.int(-1, 1)),
    h: Math.min(MAX_SIDE, base.h + rng.int(-1, 1)),
  };
}

/**
 * The features that survive, appending a line to `conflicts` for each that
 * does not.
 *
 * Three ways to lose one, and they are different things to be told: the
 * generator has never heard the word, the word is real but not for this kind
 * of place, or the place is too small to hold one more.
 */
function resolveFeatures(constraints: Constraints, size: Size, conflicts: string[]): string[] {
  const kept: Feature[] = [];
  const seen = new Set<string>();

  for (const raw of constraints.features) {
    const word = raw.trim().toLowerCase();
    if (word === '' || seen.has(word)) {
      // A blank or a repeat is not an unmet request — nothing was lost, and
      // saying the same thing twice in `conflicts` only makes it harder to read.
      continue;
    }
    seen.add(word);
    if (!isFeature(word)) {
      conflicts.push(`"${raw}" is not something the generator can build, so it was left out.`);
      continue;
    }
    if (!featureSuits(word, constraints.placeType)) {
      conflicts.push(
        `"${word}" does not belong in a ${readablePlace(constraints.placeType)}, so it was left out.`,
      );
      continue;
    }
    kept.push(word);
  }

  const budget = featureBudget(size);
  if (kept.length <= budget) {
    return kept;
  }

  for (const dropped of kept.slice(budget)) {
    conflicts.push(
      `a ${readablePlace(constraints.placeType)} of ${String(size.w)}x${String(size.h)} has floor for ` +
        `${String(budget)} feature${budget === 1 ? '' : 's'}, so "${dropped}" was left out.`,
    );
  }
  return kept.slice(0, budget);
}

/**
 * How many features fit inside `size`.
 *
 * Measured on the floor, not the footprint: the wall ring is a cell deep on
 * every side and nothing stands on it. Always at least one, because a place
 * with no room for a single feature is a place not worth generating.
 */
function featureBudget(size: Size): number {
  const floorArea = Math.max(0, size.w - 2) * Math.max(0, size.h - 2);
  return Math.max(1, Math.floor(floorArea / CELLS_PER_FEATURE));
}

/**
 * `clutter` brought into 0..1, appending to `conflicts` if it had to move.
 *
 * The schema declares the range, but the API sends it to the model as advice
 * rather than as grammar, and `resolve` is a public function that the tests
 * and the interface can call with anything. A value outside the range would
 * otherwise reach the generator and be multiplied into a count of props.
 */
function resolveClutter(clutter: number, conflicts: string[]): number {
  if (Number.isNaN(clutter)) {
    conflicts.push('clutter was not a number, so it was read as 0.');
    return 0;
  }
  if (clutter < 0 || clutter > 1) {
    const clamped = Math.min(1, Math.max(0, clutter));
    conflicts.push(`clutter was ${String(clutter)}, outside 0 to 1, so it was read as ${String(clamped)}.`);
    return clamped;
  }
  return clutter;
}

/** A place type as it reads in a sentence. */
function readablePlace(placeType: PlaceType): string {
  return placeType.replace('_', ' ');
}
