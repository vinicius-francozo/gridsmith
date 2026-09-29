/**
 * The closed vocabulary of features.
 *
 * `Constraints.features` is typed `string[]` so that the frozen contract does
 * not have to be reopened every time the generator learns a word. That makes
 * this file the real ceiling: a feature the generator has no anchor for is a
 * feature the map will not show, however clearly the description asked for it.
 *
 * Two readers depend on it. The prompt in `claude.ts` lists these words so the
 * model answers in them instead of inventing its own, and `resolve.ts` drops
 * anything that is not here and says so in `Params.conflicts` — which is what
 * keeps "the generator does not know that word" from reading, on screen, as
 * "the AI did not understand you".
 */

import type { Place } from '../core/types';

/** Every feature in the vocabulary, in a stable order so prompts do not drift. */
export const FEATURES = ['bar', 'hearth', 'stairs', 'pillars', 'alcove', 'shelving', 'bunks'] as const;

/** A feature the generator is expected to be able to place. */
export type Feature = (typeof FEATURES)[number];

/**
 * The places each feature belongs to.
 *
 * Typed against `Feature`, so a word added to `FEATURES` does not compile
 * until it has been placed here too.
 */
const FEATURE_PLACES: Record<Feature, readonly Place[]> = {
  /** The serving counter. A tavern has one, and it is in the common room. */
  bar: [{ building: 'tavern', room: 'hall' }],
  /** An open fire. Warms a room people sit in, not a cellar full of barrels. */
  hearth: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'hall' }],
  /** A flight up or down, to the rooms above or the cellar below. */
  stairs: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'storeroom' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'storeroom' }],
  /** Columns carrying a span too wide for bare joists. Only a hall is that wide. */
  pillars: [{ building: 'tavern', room: 'hall' }, { building: 'dungeon', room: 'hall' }],
  /** A recess off the main floor: a snug, or a bed nook. */
  alcove: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'room' }],
  /** Racks along a wall, for casks or for a guest's belongings. */
  shelving: [{ building: 'tavern', room: 'storeroom' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'storeroom' }, { building: 'dungeon', room: 'room' }],
  /** Stacked sleeping berths. A room to sleep in, and nowhere else. */
  bunks: [{ building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'room' }],
};

/** Whether `word` is a feature the generator knows at all. */
export function isFeature(word: string): word is Feature {
  return (FEATURES as readonly string[]).includes(word);
}

/**
 * Whether `feature` makes sense in `place`.
 *
 * Asking for a bar in a bedroom is not a mistake to reject — it is an ordinary
 * thing for a person to type. It is answered by leaving the bar out and
 * recording why.
 *
 * @throws {RangeError} if `feature` is not in the vocabulary. Callers screen
 *                      with `isFeature` first; a word that never was in the
 *                      vocabulary would otherwise come back as a plain `false`
 *                      and read as "that feature does not suit this place".
 */
export function featureSuits(feature: Feature, place: Place): boolean {
  if (!isFeature(feature)) {
    throw new RangeError(`${String(feature)} is not in the feature vocabulary`);
  }
  return FEATURE_PLACES[feature].some((allowed) => allowed.building === place.building && allowed.room === place.room);
}

/** Every feature that suits `place`, in vocabulary order. */
export function featuresFor(place: Place): Feature[] {
  return FEATURES.filter((feature) => featureSuits(feature, place));
}
