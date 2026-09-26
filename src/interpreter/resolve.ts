/**
 * Turning what was asked for into what can be built.
 *
 * `Constraints` is a wish. `Params` is a plan: every value concrete, every
 * size legal, and every part of the wish that did not survive written down in
 * `conflicts` as a code from `codes.ts`. The distinction matters because an incoherent
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
import { MAX_SIDE } from '../core/types';
import type { Constraints, Params, PlaceType, Rng, Size } from '../core/types';

import {
  CLUTTER_NOT_A_NUMBER,
  CLUTTER_OUT_OF_RANGE,
  entry,
  FEATURE_NOT_IN_PLACE,
  FEATURE_NOT_IN_VOCABULARY,
  FEATURE_OVER_BUDGET,
} from './codes';
import { featureSuits, isFeature } from './vocabulary';
import type { Feature } from './vocabulary';

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
 * These are footprints, so the wall ring is included: a 7x7 room has a 5x5
 * floor inside it. Two things fix where each band sits, and neither is taste.
 *
 * The bottom of every band is the generator's. Each profile in
 * `src/generator/profiles.ts` declares a `minSize` below which its own
 * geometry stops holding — a wall ring, a door set back from the corners, a
 * 2x3 bed with somewhere to stand beside it — and it clamps whatever arrives
 * into it. A band starting below that is not a smaller place, it is the same
 * place with the difference clamped away. So every band here starts at or
 * above the generator's minimum: 12x10 for a hall, 6x6 for a guest room, 8x6
 * for a storeroom.
 *
 * The spacing is what keeps the three hints worth asking for. `jitterSize`
 * moves each side by a cell, so bands whose bases sit a cell or two apart
 * hand back the same rectangles and "small" and "medium" stop being different
 * requests. Every pair of bands here is therefore separated on at least one
 * side by more than the variation can close, and measured against the
 * generator's bounds rather than against these numbers, because those bounds
 * are what the map is finally built to. `resolve.test.ts` holds them to it.
 *
 * The relative scale is the last point — the largest guest room, varied
 * upwards, is still smaller than the smallest common room varied downwards,
 * because they are different kinds of place and not one place with a dial on
 * it. `resolve.test.ts` holds the tables to that too.
 */
const PROFILES: Readonly<Record<PlaceType, PlaceProfile>> = {
  tavern_room: {
    // The tightest of the three: the generator will build a guest room no
    // smaller than 6x6 and no larger than 11x10, which is not six cells of
    // width and five of height for three bands that have to clear each other.
    // So the room widens first and deepens second, and the large band's top
    // cell of height is the one place any band here reaches past what the
    // generator will build — it arrives as a 10.
    sizes: { small: { w: 7, h: 7 }, medium: { w: 10, h: 7 }, large: { w: 9, h: 10 } },
    // A guest room has one way in. That is what makes it a place you can be
    // cornered in, which is the reason to fight in one.
    doors: { min: 1, max: 1 },
  },
  tavern_storeroom: {
    sizes: { small: { w: 9, h: 7 }, medium: { w: 12, h: 8 }, large: { w: 13, h: 11 } },
    // The stair down, and often a hatch to the street for deliveries.
    doors: { min: 1, max: 2 },
  },
  tavern_hall: {
    // Room enough that all three bands clear each other on both sides, and
    // the outer two land exactly on the generator's 12x10 floor and 20x18
    // ceiling.
    sizes: { small: { w: 13, h: 11 }, medium: { w: 16, h: 14 }, large: { w: 19, h: 17 } },
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
 * @throws {RangeError} if `placeType` is not in the vocabulary — see
 *                      `profileFor`.
 */
export function resolve(constraints: Constraints, seed: number): Params {
  const rng = createRng(seed);
  const conflicts: string[] = [];

  const profile = profileFor(constraints.placeType);
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
 * The profile for `placeType`.
 *
 * `resolve` is a public function, reached from the interface with whatever a
 * language model answered — and the API does not hold the model to the
 * vocabulary, so `placeType` arrives unverified in exactly the way `clutter`
 * does. Left alone, an unknown kind of place reads a missing profile and
 * fails a field later on `sizes`, naming neither the field that was wrong nor
 * the value it held. Unlike `clutter` there is nothing sensible to fall back
 * to: a map of no particular place is not a map, so this refuses.
 *
 * The test is `Object.hasOwn` and not a lookup against `undefined`, because
 * `PROFILES` is an object literal and so carries everything `Object.prototype`
 * carries: `PROFILES['constructor']` is a function, `PROFILES['toString']` is
 * a method, `PROFILES['__proto__']` is an object. Each of them is something
 * rather than `undefined`, so each of them walks past a lookup guard and
 * fails on `.sizes` one line later — the raw `TypeError` this guard exists to
 * replace. Only a key we declared is a kind of place.
 *
 * @throws {RangeError} if `placeType` is not one of the three kinds.
 */
function profileFor(placeType: PlaceType): PlaceProfile {
  if (!Object.hasOwn(PROFILES, placeType)) {
    throw new RangeError(
      `resolve() was given placeType "${String(placeType)}", which is not a kind of place the generator knows`,
    );
  }
  return PROFILES[placeType];
}

/**
 * The profile footprint, varied by a cell on each side and capped.
 *
 * Two halls generated from the same words should not be the same rectangle;
 * the kind of place fixes the scale, the seed fixes the room. The cap is the
 * hard rule — nothing is ever wider or taller than `MAX_SIDE` — and it is
 * applied after the variation, not before, because that is where it can
 * actually be exceeded.
 *
 * Exported for the sake of that cap. No profile is 20 cells tall, so no call
 * through `resolve` can drive the height into `MAX_SIDE`, and a test that
 * only goes through `resolve` asserts nothing about the taller side. Reached
 * directly, both sides can be pushed at the ceiling.
 */
export function jitterSize(base: Size, rng: Rng): Size {
  return {
    w: Math.min(MAX_SIDE, base.w + rng.int(-1, 1)),
    h: Math.min(MAX_SIDE, base.h + rng.int(-1, 1)),
  };
}

/**
 * The features that survive, appending a code to `conflicts` for each that
 * does not.
 *
 * Three ways to lose one, and they are different things to be told, so they
 * are three codes: the generator has never heard the word, the word is real
 * but not for this kind of place, or the place is too small to hold one more.
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
      // The word as it was written, not as it was normalised: this is what
      // the person is going to be told was left out.
      conflicts.push(entry(FEATURE_NOT_IN_VOCABULARY, raw));
      continue;
    }
    if (!featureSuits(word, constraints.placeType)) {
      conflicts.push(entry(FEATURE_NOT_IN_PLACE, word));
      continue;
    }
    kept.push(word);
  }

  const budget = featureBudget(size);
  if (kept.length <= budget) {
    return kept;
  }

  for (const dropped of kept.slice(budget)) {
    conflicts.push(entry(FEATURE_OVER_BUDGET, dropped));
  }
  return kept.slice(0, budget);
}

/**
 * How many features fit inside `size`.
 *
 * Measured on the floor, not the footprint: the wall ring is a cell deep on
 * every side and nothing stands on it. Always at least one, because a place
 * with no room for a single feature is a place not worth generating.
 *
 * Exported for the sake of that floor, for the same reason `jitterSize` is:
 * the smallest floor any profile can produce is exactly `CELLS_PER_FEATURE`,
 * so through `resolve` the budget never comes out below one on its own and
 * the guard is unreachable. Reached directly, a smaller room reaches it.
 */
export function featureBudget(size: Size): number {
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
 *
 * The parameter says `number` and the value came out of a model through JSON,
 * so the type is a claim and not a fact: `null`, a missing field and the word
 * `"lots"` all arrive here typed as a number. Testing only for `NaN` lets
 * every one of them through untouched, to be multiplied into a prop count
 * somewhere else — the same untrusted boundary `placeType` is screened at, so
 * anything that is not a number is read the same way a `NaN` is.
 */
function resolveClutter(clutter: number, conflicts: string[]): number {
  if (typeof clutter !== 'number' || Number.isNaN(clutter)) {
    conflicts.push(entry(CLUTTER_NOT_A_NUMBER));
    return 0;
  }
  if (clutter < 0 || clutter > 1) {
    conflicts.push(entry(CLUTTER_OUT_OF_RANGE, String(clutter)));
    return Math.min(1, Math.max(0, clutter));
  }
  return clutter;
}

