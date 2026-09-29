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
 * until it has been placed here too. It is **not** typed against `RoomKind`,
 * so a room added over in `core/types.ts` compiles straight through this file
 * and simply holds no features — which is why every list below was walked by
 * hand when `crypt` arrived rather than waited on.
 *
 * Each list has to agree with the profiles in `generator/profiles.ts`: a
 * feature that names an anchor is only listed for a place whose profile
 * declares that anchor, and `pillars` and `alcove` are the two answered by
 * stage one instead, so they are listed for any place whose profile allows the
 * shape. `profiles.test.ts` holds the two sides together for the crypt.
 */
const FEATURE_PLACES: Record<Feature, readonly Place[]> = {
  /** The serving counter. A tavern has one, and it is in the common room. */
  bar: [{ building: 'tavern', room: 'hall' }],
  /**
   * An open fire. Warms a room people sit in, not a cellar full of barrels —
   * and, in a crypt, the votive brazier left burning for the dead.
   */
  hearth: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'crypt' }],
  /**
   * A flight up or down, to the rooms above or the cellar below.
   *
   * Every room in the project offers one except the crypt, which is reached
   * along a passage rather than down a stair. That absence is the one feature
   * decision this list makes on its own account, and it is deliberate: the
   * description that put `crypt` in the vocabulary said "sem escadaria".
   */
  stairs: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'storeroom' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'storeroom' }],
  /**
   * Columns carrying a span too wide for bare joists. A hall is that wide, and
   * so is a crypt, whose vault is the reason it has them.
   */
  pillars: [{ building: 'tavern', room: 'hall' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'crypt' }],
  /** A recess off the main floor: a snug, a bed nook, or a burial recess. */
  alcove: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'room' }, { building: 'dungeon', room: 'crypt' }],
  /**
   * Racks along a wall, for casks or for a guest's belongings — and, in a
   * crypt, the tiers of a bone niche, which is a shelf holding the dead.
   */
  shelving: [{ building: 'tavern', room: 'storeroom' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'storeroom' }, { building: 'dungeon', room: 'room' }, { building: 'dungeon', room: 'crypt' }],
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
