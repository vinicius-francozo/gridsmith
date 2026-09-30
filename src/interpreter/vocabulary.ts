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

/**
 * Every feature in the vocabulary, in a stable order so prompts do not drift.
 *
 * **The order is not cosmetic and the three newest words are at the end for
 * that reason.** `resolveFeatures` drops whatever will not fit the floor's
 * budget *from the end* of this list, and `jev/read.ts` reads the nouls in this
 * order so that which word survives cannot depend on a hundredth of a point.
 * Appending is therefore the only edit that moves no existing word: putting
 * `bed` before `bunks` would have changed which of the seven a tight guest room
 * keeps, which is a behaviour nobody asked for and no measurement covers.
 *
 * What it costs is that `bed`, `weapons` and `tomb` are the first to be dropped
 * when the budget bites — and the budget does bite, in the **two** places it
 * already bit before they existed. Both are the rooms people sleep in: they
 * share a geometry whose floor is 6x6 at its smallest, which is a budget of
 * two. Asking for every word each place offers, over 1200 resolves — three size
 * hints by four hundred seeds — and counting how often each word is the one
 * dropped:
 *
 * | | before | now |
 * | --- | --- | --- |
 * | tavern guest room | 128 (`bunks`) · 42 (`shelving`) | **297 (`bed`)** · 128 · 42 |
 * | dungeon cell | 42 (`bunks`) | **128 (`bed`)** · 42 |
 *
 * So `bed` is dropped in both, and in both it is dropped ahead of the words
 * that were there first — which is what appending buys and what it costs. The
 * cell triples along with the guest room, and naming only one of them is how
 * this paragraph read for a round. `weapons` and `tomb` are never cut, on 0 of
 * 1200 each: the dungeon hall and the crypt have a budget of thirteen.
 *
 * It is `CELLS_PER_FEATURE` in `resolve.ts` that decides all of that, not this
 * order, and it is left alone here because it is the same number for every room.
 */
export const FEATURES = [
  'bar', 'hearth', 'stairs', 'pillars', 'alcove', 'shelving', 'bunks',
  'bed', 'weapons', 'tomb',
] as const;

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
 * shape. `profiles.test.ts` holds the two sides together.
 *
 * **That rule is the whole of how the lists below were decided, and it is
 * mechanical rather than a matter of taste.** A feature belongs in a place iff
 * the place can *answer* it: for the eight that name furniture, the building's
 * filling has a slot carrying that word at a footprint the library can fill;
 * for `pillars`, `allowPillars` is true; for `alcove`, `'alcove'` is on the
 * geometry's shape list. Anything else is a word the interface offers and the
 * map then silently drops, or — the other direction, and the one that made the
 * cell's fire a lie — a word the interface refuses while the generator draws
 * the piece anyway.
 *
 * `stairs` in a crypt is the one entry that is a judgement rather than the
 * rule, and it is a judgement on the *profile*: the crypt declares no stair
 * because a burial chamber is reached along a passage, and this list follows
 * the profile rather than arguing with it.
 *
 * **`profiles.test.ts` now reads this agreement through `featuresFor` instead
 * of keeping a second copy of the table.** The copy it kept was written before
 * the crypt and was never updated: four of the crypt's five entries were
 * missing from it, so the check it claimed to make had not been made for the
 * room it was added for. Ten buildings would have been ten more chances at the
 * same thing.
 */
const FEATURE_PLACES: Record<Feature, readonly Place[]> = {
  /** The serving counter. A tavern has one, and it is in the common room. */
  bar: [{ building: 'tavern', room: 'hall' }],
  /**
   * An open fire. Warms a room people sit in, not a cellar full of barrels —
   * and, in a crypt, the votive brazier left burning for the dead.
   */
  hearth: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'crypt' },
    // The forge fire, and the brazier in the shop front. Both are `hearth`
    // slots, and the first is the widest light any room in the project has.
    { building: 'forge', room: 'smithy' }, { building: 'forge', room: 'room' },
    // The sacristy's brazier. **Not the nave**: its 3x2 slot is the altar and
    // it has no 2x1 to put a sconce in, so a temple hall is the fourth room in
    // the project with no light of its own.
    { building: 'temple', room: 'room' },
    // The reading room's fire, and it is the one room of this building that
    // gets one. **The archive declares none on purpose** — a chamber full of
    // parchment is the one place in this project an open flame is a mistake —
    // so "uma lareira no arquivo" is answered the way a bar in a bedroom is.
    { building: 'library', room: 'reading' },
    // The athanor: a furnace kept alight for months, which is the one thing in
    // a laboratory that is also a hearth. **Not the observatory** — a chamber
    // whose point is seeing out of it is lit by what it is pointed at, and its
    // geometry declares no slot a fire would fit.
    { building: 'tower', room: 'laboratory' }],
  /**
   * A flight up or down, to the rooms above or the cellar below.
   *
   * Every room in the project offers one except the crypt, which is reached
   * along a passage rather than down a stair. That absence is the one feature
   * decision this list makes on its own account, and it is deliberate: the
   * description that put `crypt` in the vocabulary said "sem escadaria".
   */
  stairs: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'storeroom' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'storeroom' },
    // Up to the rooms over the shop. Not in the forge floor itself, which has
    // no stair slot: a smithy is a single storey with a fire in it.
    { building: 'forge', room: 'room' },
    // Up to the gallery, and down to the undercroft. Both temple rooms have the
    // slot, because both borrow a geometry that declares one.
    { building: 'temple', room: 'hall' }, { building: 'temple', room: 'room' },
    // Up to the gallery over the reading room. The archive has no stair slot:
    // it is a room you walk into off a corridor.
    { building: 'library', room: 'reading' },
    // Both, and in this building the stair is the building: the laboratory's
    // corner stair is the one the observatory's comes up from.
    { building: 'tower', room: 'laboratory' }, { building: 'tower', room: 'observatory' }],
  /**
   * Columns carrying a span too wide for bare joists. A hall is that wide, and
   * so is a crypt, whose vault is the reason it has them.
   *
   * The nave is the third hall, and it inherits the hall's measured defect with
   * the geometry: `minSize` is 12x10, a cell short of the 11x11 `growPillars`
   * needs, so a small one asked for columns comes back with none on 205 of 600
   * seeds. That is the geometry's to fix and not this table's — listing the
   * nave here is what makes the interface's answer match what the generator
   * will attempt, which is the only thing this table decides.
   */
  pillars: [{ building: 'tavern', room: 'hall' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'crypt' },
    { building: 'temple', room: 'hall' },
    // **The only room in the project that can honestly have them**, and the
    // reason is arithmetic rather than taste: `laboratory` is 11x11 at its
    // smallest, which is exactly where `growPillars` becomes possible. The
    // three halls are a cell short and pay 205 of 600 seeds for it in silence.
    { building: 'tower', room: 'laboratory' }],
  /** A recess off the main floor: a snug, a bed nook, or a burial recess. */
  alcove: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'room' }, { building: 'dungeon', room: 'crypt' },
    // The shop front is the guest room's geometry, so it has the guest room's
    // shapes. The forge floor is `rectangle` and `l_shape` only.
    { building: 'forge', room: 'room' },
    // Both, and for the same reason as the stair: the shapes come with the
    // borrowed geometry, and both of these geometries offer `alcove`. A recess
    // off a nave is a side chapel.
    { building: 'temple', room: 'hall' }, { building: 'temple', room: 'room' },
    // A reading nook. The archive's shapes are `rectangle` and `l_shape`, so
    // asking it for a recess is answered with a conflict rather than silently.
    { building: 'library', room: 'reading' },
    // Both: the laboratory has all four shapes and the observatory has
    // `alcove`. A recess off a laboratory is where the thing nobody wants to
    // look at is kept.
    { building: 'tower', room: 'laboratory' }, { building: 'tower', room: 'observatory' }],
  /**
   * Racks along a wall, for casks or for a guest's belongings — and, in a
   * crypt, the tiers of a bone niche, which is a shelf holding the dead.
   */
  shelving: [{ building: 'tavern', room: 'storeroom' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'storeroom' }, { building: 'dungeon', room: 'room' }, { building: 'dungeon', room: 'crypt' },
    // The tool rack over the forge. **Not** the shop front: that building fills
    // the guest room's 3x1 shelf slot with the blade display instead, so
    // "prateleiras" there would be a word with nothing behind it.
    { building: 'forge', room: 'smithy' },
    // The sacristy's shelf. The nave fills no shelving slot — the geometry it
    // borrows has none.
    { building: 'temple', room: 'room' },
    // Both, and this is the building the word is most obviously about: each of
    // the two rooms declares two shelf runs at two footprints, and one of the
    // two carries the word so the other can be the piece nothing can refuse.
    { building: 'library', room: 'reading' }, { building: 'library', room: 'archive' },
    // Both rooms of the tower declare one: the instruments have to stand
    // somewhere, and in this building that somewhere is a shelf.
    { building: 'tower', room: 'laboratory' }, { building: 'tower', room: 'observatory' }],
  /** Stacked sleeping berths. A room to sleep in, and nowhere else. */
  bunks: [{ building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'room' }],
  /**
   * Somewhere one person sleeps: a bed, a cot, a pallet. The rooms that hold
   * one are the two that hold bunks, and it is a **separate** slot there rather
   * than another word for the same piece — `anchor/bunk_beds` deliberately
   * carries no `bed` tag, so the two never resolve to each other.
   */
  bed: [{ building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'room' }],
  /**
   * Arms kept in the room: a rack, an armoury stand, weapons out of a rack.
   * The dungeon hall is the only place whose profile declares one.
   */
  weapons: [{ building: 'dungeon', room: 'hall' },
    // The blade display. A weapons word in a smith's shop is the most ordinary
    // thing a person could ask for, and it resolves to the one `weapons` anchor
    // in the catalogue at 3x1.
    { building: 'forge', room: 'room' }],
  /** Somewhere the dead are kept: a sarcophagus, a grave slab, a bone niche. */
  tomb: [{ building: 'dungeon', room: 'crypt' }],
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
