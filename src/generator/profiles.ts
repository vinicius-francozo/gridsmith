/**
 * Composed building and room profiles: everything the three generation stages need to
 * know about a kind of room that is not in `Params`.
 *
 * `Params` already carries the concrete size, door count and clutter that the
 * resolver settled on. A profile carries what the resolver has no opinion
 * about — which footprint shapes the room may take, which materials cover its
 * floor, which furniture belongs in it — plus the bounds the generator holds
 * the resolver to, so a nonsense size arrives as a clamp rather than as a
 * room with no wall to hang a door on.
 *
 * Every measurement here is in grid cells.
 */

import type { AssetDef, AssetLibrary, Building, Cell, Place, PlacedProp, RoomKind, Rotation, Size } from '../core/types';
import type { Rng } from '../core/types';

/** The four rotations, in clockwise order. */
export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/**
 * A rotation drawn from `rng`.
 *
 * `Rng.pick` takes a mutable array and `ROTATIONS` is frozen to callers, so
 * this indexes it instead of copying the array on every tile of the map.
 */
export function pickRotation(rng: Rng): Rotation {
  return ROTATIONS[rng.int(0, ROTATIONS.length - 1)];
}

// --- Materials -------------------------------------------------------------

/** The material of a cell that is not part of the building at all. */
export const VOID_MATERIAL = 'void';

/**
 * The material a free-standing pillar is painted in — one for the project,
 * not one per building.
 *
 * **The defect this fixes is not the one it looks like.** The pillars were
 * drawn all along, and they were not hard to tell from the wall: stage two
 * gave them the wall material, which on the map the report came from stood at
 * 42.6 ΔE2000 from the floor around them. Asked what had gone wrong, the
 * person who reported them missing said he had not noticed them. That is
 * visual hierarchy, not a material being mistaken for another, so the target
 * here is **salience against the floor a pillar stands on**, not separability
 * from the wall.
 *
 * The floor is the right comparison and the wall is not, because a pillar is
 * surrounded by floor: over 22,552 grown pillars only 9.3% touch a wall cell
 * at all, none in a `rectangle` or an `l_shape`, 14.5% in a `t_shape` and
 * 21.5% in an `alcove`. Even those still face floor on their other sides.
 *
 * The colour is not authored. `materialColor` derives it from the name by
 * FNV-1a (`assets/palette.ts`), and that derivation is not this module's to
 * change, so the **name is the only lever** and this one was chosen by
 * measuring. Against every shade of every floor material in the vocabulary it
 * measures **32.7 ΔE2000 at worst** (`stone_floor` variant 0), where the
 * wall material a pillar used to be painted measured 23.4, and where two
 * variants of one material — the same stone, cut differently — sit 10.2
 * apart. It is also the loudest colour the derivation can produce: saturation
 * 37 and lightness 37 are both the ceiling, and no name reaches a higher
 * worst case against the two floors of a dungeon hall than 33.1.
 *
 * Optimising against the wall as well was measured and rejected: the best any
 * name manages against floors and walls together is 23.6, which is worse
 * against the floor than the wall material it replaces.
 */
export const PILLAR_MATERIAL = 'tufa_column';

export type MaterialDef = {
  /** How many interchangeable tile variants the asset library offers. */
  variants: number;
  /**
   * Whether a tile reads the same at any rotation. Plank floors have a grain
   * and must not be spun; rubble and flagstone may be.
   */
  rotatable: boolean;
};

/**
 * Every material the generator may name, and how a tile of it may vary.
 *
 * The keys are the asset-library vocabulary. A material the library does not
 * know renders as nothing, so the generator refuses to name one that is not
 * declared here rather than emitting it and finding out at render time.
 */
export const MATERIALS: Record<string, MaterialDef> = {
  [VOID_MATERIAL]: { variants: 1, rotatable: false },
  wood_plank: { variants: 4, rotatable: false },
  flagstone: { variants: 4, rotatable: true },
  stone_floor: { variants: 3, rotatable: true },
  dirt_floor: { variants: 3, rotatable: true },
  stone_wall: { variants: 3, rotatable: false },
  plaster_wall: { variants: 2, rotatable: false },
  timber_wall: { variants: 2, rotatable: false },
  // **A building's own stone, and the name is the whole of the colour.**
  // `materialColor` derives a hue, a saturation and a lightness ladder from the
  // name by FNV-1a, so nothing is authored here — but the name still has to be
  // *chosen*, because two of the derivation's outputs are load-bearing and
  // neither is obvious from reading one:
  //
  // 1. **A floor has to stay 28 ΔE2000 clear of `tufa_column`**, the colour
  //    every pillar in the project is painted. `profiles.test.ts` measures it
  //    over every shade of every floor any profile can pave with, and names
  //    under the ruler are common — `temple_marble`, the name the plan for this
  //    front suggested, lands at 24.2 and would have failed.
  // 2. **Three variants of one material must stay under the widest spread the
  //    vocabulary already has**, 10.2, or the ruler that separates "a different
  //    material" from "the same stone cut differently" moves under everybody.
  //
  // Measured for each name below before it was used: worst case against the
  // pillar 29.5 (`slate_floor`), widest variant spread 9.8 (`mosaic_floor`),
  // so `stone_floor`'s 10.2 is still the widest in the project.
  //
  // Three variants each rather than four, and it is the cheap half of the
  // second rule: the ladder steps the lightness four points a rung, so three
  // rungs span eight points where four span twelve.
  forge_floor: { variants: 3, rotatable: true },
  forge_wall: { variants: 3, rotatable: false },
  // Not rotatable, and it is the one of these that is a judgement rather than a
  // measurement: a mosaic has a pattern with a top, and spinning the tile would
  // break the figure it is a tile of. `wood_plank` is refused rotation for the
  // same reason — the grain — and `flagstone` is allowed it.
  mosaic_floor: { variants: 3, rotatable: false },
  sanctum_wall: { variants: 3, rotatable: false },
  // Boards, so no rotation, for `wood_plank`'s reason. The archive is flagged
  // and may be spun.
  oak_floor: { variants: 3, rotatable: false },
  archive_floor: { variants: 3, rotatable: true },
  library_wall: { variants: 3, rotatable: false },
  slate_floor: { variants: 3, rotatable: true },
  slate_wall: { variants: 3, rotatable: false },
  // **The four last buildings, and the ruler they were named against had
  // 1.53 left in it.** The comment above `forge_floor` records the two rules;
  // what it could not record is that the margin the first of those rules has
  // is now almost spent. `PILLAR_MATERIAL` clears the worst floor in the
  // vocabulary by 29.53 against a ruler of 28, so a name measuring anywhere in
  // between passes and narrows it for whoever comes next.
  //
  // So each floor added here was measured before it was used, and each was
  // **rejected until it cleared 29.53** rather than until it cleared 28 —
  // which is why the margin is still exactly 1.53. `gravel_floor` measures
  // **33.01** against the pillar and 42.5 against `stone_wall`, the second
  // being the other pinned figure a floor can move (`profiles.test.ts` holds
  // the nearest floor to the old wall material at 21.4).
  //
  // **The name that fails is not the one a reader would guess.**
  // `mine_floor` — the obvious name for this material — measures 32.4 against
  // the pillar and **20.3 against `stone_wall`**, under that second pin. It
  // would have gone in unmeasured and taken the regression anchor with it, the
  // way `temple_marble` would have gone in at 24.2 a front earlier.
  //
  // Walls are held to neither floor rule — `everyFloorShade` reads
  // `floorMaterials` only — so `shoring_wall` carries the variant spread and
  // nothing else: 9.16, under `stone_floor`'s 10.2, which is still the widest
  // in the project.
  gravel_floor: { variants: 3, rotatable: true },
  shoring_wall: { variants: 3, rotatable: false },
  // See `PILLAR_MATERIAL`. One variant and no rotation: the variant ladder
  // exists so that a floor of two hundred cells does not read as one flat
  // sheet, and a room has four pillars — a pillar drawn in three shades would
  // read as three different things. One variant also keeps the draws per cell
  // exactly what a wall cell already cost, so the rng sequence is untouched.
  [PILLAR_MATERIAL]: { variants: 1, rotatable: false },
};

/**
 * The variation rules for `material`.
 *
 * @throws {Error} if `MATERIALS` does not declare `material`.
 *
 * The parameter is a bare `string`, so this is the one lookup in the module
 * with no type in front of it at all — and `MATERIALS` is an object literal,
 * so `materialDef('toString')` would otherwise hand back a function, and
 * `materialDef('__proto__')` `Object.prototype` itself, neither of them
 * `undefined`. `def.variants` is then `undefined`, `rng.int(0, NaN)` follows,
 * and the map is painted in tiles nobody declared. `Object.hasOwn` asks the
 * question the doc comment above `MATERIALS` claims is being asked: whether
 * the catalogue names this material, not whether the lookup came back empty.
 */
export function materialDef(material: string): MaterialDef {
  if (!Object.hasOwn(MATERIALS, material)) {
    throw new Error(`unknown material '${material}'`);
  }
  return MATERIALS[material];
}

// --- Features --------------------------------------------------------------

/**
 * The closed vocabulary `Params.features` is written in.
 *
 * `Constraints.features` is typed `string[]`, so nothing in the frozen
 * contracts pins these words down. The interpreter chose them — they are
 * `FEATURES` in `src/interpreter/vocabulary.ts` — and the generator is the
 * other half of that agreement: a word the generator answers to nothing for
 * is a request that vanishes from the map without an error anywhere.
 *
 * Eight of the ten name an anchor, through `AnchorSpec.feature`. The other two
 * are answered by stage one instead, because they are shape, not furniture:
 * `alcove` picks a footprint out of the grammar and `pillars` grows columns.
 */
export const FEATURE_VOCABULARY: readonly string[] = [
  'bar',
  'hearth',
  'stairs',
  'pillars',
  'alcove',
  'shelving',
  'bunks',
  'bed',
  'weapons',
  'tomb',
];

/** The feature that asks stage one for a recess off the main floor. */
export const ALCOVE_FEATURE = 'alcove';

/** The feature that asks stage one for free-standing columns. */
export const PILLARS_FEATURE = 'pillars';

// --- Asset ids -------------------------------------------------------------

/**
 * The asset-library id of a placed prop: `<kind>/<name>`.
 *
 * The library is indexed by this string and `AssetLibrary.bitmap` throws on
 * an id it does not know, so the scheme is a contract with the renderer
 * rather than a convention. The profiles below declare only the *name*; the
 * layer a prop is placed in supplies the kind, so a shelf declared as an
 * anchor can never be emitted under a group id.
 */
export function assetIdFor(layer: PlacedProp['layer'], name: string): string {
  return `${layer}/${name}`;
}

// --- Footprint grammar -----------------------------------------------------

/**
 * The shapes a room's footprint may take. A small closed grammar: the plan is
 * chosen from these and then dimensioned, never sampled cell by cell.
 */
export type ShapeName = 'rectangle' | 'l_shape' | 't_shape' | 'alcove';

// --- Furniture -------------------------------------------------------------

/**
 * A layer-one prop: large, fixed to a wall, and what gives the room its
 * reading. A bar counter, a hearth, a bed.
 */
export type AnchorSpec = {
  /**
   * What this slot holds, as a word from `CONCEPTS` rather than as the id of
   * one asset.
   *
   * The variant is chosen at generation time, by asking the library for
   * everything carrying the concept at this footprint and preferring what
   * carries the room's palette — see `resolveAssets`. That is the whole of what
   * a building's filling used to say by naming `hearth` in a tavern and
   * `stone_hearth` in a dungeon, with the difference that a variant added to
   * the library arrives on the map without this table being touched.
   */
  concept: Concept;
  /**
   * The unrotated footprint: `w` runs along the wall, `h` is the depth away
   * from it. At rotation 0 the prop's back is against a wall to its north;
   * each further 90° turns the back one facing clockwise.
   */
  footprint: Size;
  /** `wall` needs one wall behind it; `corner` needs a second one beside it. */
  placement: 'wall' | 'corner';
  /**
   * The `FEATURE_VOCABULARY` word that asks for this anchor by name.
   *
   * A requested anchor is tried *first*, ahead of the profile's own count,
   * and every anchor — requested or not — may also be drawn to fill a free
   * slot afterwards. First is not certainly: if no wall in the room has the
   * length and the clearance the anchor needs, the placement fails and the
   * request drops out with no signal. Measured at zero in three hundred
   * rooms at the largest size each profile allows; reproducible in a 6x6
   * `tavern_room`, where the anchor genuinely does not fit.
   */
  feature?: string;
  /** The light this anchor gives off, if any. */
  light?: { radiusCells: number; colorHex: string };
};

/**
 * An anchor with its variant drawn: what the placement layer is handed.
 *
 * Separate from `AnchorSpec` because the two are true at different moments. A
 * profile read out of the registry has a concept and no asset; only
 * `resolveAssets`, which has a library and an `Rng`, can say which piece the
 * room gets. Keeping them one type would have meant an `assetId` that is
 * sometimes a string and sometimes nothing, checked nowhere.
 */
export type PlacedAnchor = AnchorSpec & { assetId: string };

/** One prop inside a group template, positioned relative to the group's box. */
export type GroupPart = { assetId: string; offset: Cell; footprint: Size };

/**
 * A layer-two prop: a set of props placed as one arrangement, because their
 * positions are relative to each other. A table with its chairs is one group,
 * not five independent draws.
 */
export type GroupSpec = {
  id: string;
  /** The bounding box every `offset` is measured inside, unrotated. */
  size: Size;
  parts: GroupPart[];
};

/**
 * A layer-three prop: loose debris, drawn per cell.
 *
 * Resolved, like `PlacedAnchor`. The registry declares a room's debris as a
 * ladder of tags and the pool is what the library answers with, so this type
 * only ever exists on the far side of `resolveAssets`.
 */
export type ScatterSpec = { assetId: string; weight: number };

/**
 * One rung of a room's debris ladder: the tags a piece must carry to stand on
 * it, and what it weighs there.
 *
 * A piece carrying the tags of two rungs stands on the **first**, which is what
 * makes this a ladder and not a sum: a taproom asks for `tableware` heavily and
 * then for `clutter` lightly, and the mug is tableware, not an afterthought.
 */
export type ScatterRung = { tags: string[]; weight: number };

/**
 * Every concept a room may ask for, and the `FEATURE_VOCABULARY` word that asks
 * for it by name.
 *
 * **Explicit rather than inferred**, and it is worth saying what was rejected:
 * the catalogue happens to list an asset's concept first in its tags today, so
 * "the first tag is the concept" would work — and would be a convention held up
 * by nothing, which the next asset breaks silently. This table is where the
 * word is, and `profileFor` holds a slot's `feature` to the concept it names.
 *
 * Eight carry a feature and one does not, and the one is not an omission. A
 * featureless anchor cannot appear in `Params.excluded`, so it is the piece of
 * a room no description can take away. Which slots are featureless is the
 * *building's* business and is declared on the filling; this table says which
 * words *may* ask, so that a slot cannot claim to be asked for by a word that
 * names something else.
 *
 * **`bed`, `weapons` and `tomb` were three of those four and now have words**,
 * because a person writing "uma cama" or "um sarcófago" was writing about a
 * piece this project has and being answered with silence. The word admits them
 * to `FEATURES` and the measurement that admitted them is
 * `vocabulario-pedivel/arnes-admissao.md`, beside the rulers outside this
 * repository. Being askable makes each of them refusable in the same breath, so
 * the crypt declares a second `tomb` slot with no word on it to keep the net
 * the first one used to be — the dungeon hall was measured and does not need
 * one.
 *
 * `storage` is the one left, and it is left on purpose. This mechanism promotes
 * an **anchor**; `storage` lives almost entirely in `group` and `scatter`
 * (`crate`, `barrel`, `supply_crate`, `sack`), so somebody writing "caixotes
 * empilhados" would be handed the wardrobe that happens to be the concept's one
 * anchor. What it needs is a mechanism that promotes a group, not a word.
 *
 * **`altar` and `ladder` are two more wordless ones, and they are wordless for
 * the reason `storage` is not.** Each is the one piece its room cannot be
 * talked out of — the altar in a nave, the stepladder in an archive — and the
 * crypt's fourth slot is the precedent for what a room without one costs: every
 * anchor refusable, and bare walls on a description that merely reads as dark.
 * Giving either of them a word is possible and is a separate decision, because
 * a word in `FEATURES` is a word the prompt offers and the admission bench has
 * to measure.
 */
export const CONCEPTS = {
  altar: {},
  bar: { feature: 'bar' },
  bed: { feature: 'bed' },
  bunks: { feature: 'bunks' },
  hearth: { feature: 'hearth' },
  ladder: {},
  shelving: { feature: 'shelving' },
  stairs: { feature: 'stairs' },
  storage: {},
  tomb: { feature: 'tomb' },
  weapons: { feature: 'weapons' },
} satisfies Record<string, { feature?: string }>;

/** A word a room may ask the library for. */
export type Concept = keyof typeof CONCEPTS;

/** The feature word that asks for `concept`, if any asks for it at all. */
function featureOf(concept: Concept): string | undefined {
  const declared: { feature?: string } = CONCEPTS[concept];
  return declared.feature;
}

// --- The registry ----------------------------------------------------------

export type PlaceProfile = {
  place: Place;
  /** The generator clamps `Params.size` into these bounds. */
  minSize: Size;
  maxSize: Size;
  /** And clamps `Params.doorCount` into these. Never below one door. */
  doorRange: { min: number; max: number };
  shapes: ShapeName[];
  /** Whether this kind of room may grow free-standing pillars. */
  allowPillars: boolean;
  /** Materials a floor zone may take. The first is the default. */
  floorMaterials: string[];
  /** The wall material that borders each floor material. */
  wallMaterials: Record<string, string>;
  /** Used for a wall whose floor material declares no counterpart. */
  defaultWallMaterial: string;
  /** How many anchors to aim for, before availability is taken into account. */
  anchorRange: { min: number; max: number };
  anchors: AnchorSpec[];
  /** Groups per hundred floor cells, at clutter 0 and at clutter 1. */
  groupsPerHundredCells: { min: number; max: number };
  groups: GroupSpec[];
  /** Chance a free floor cell takes a scatter prop, at clutter 1. */
  scatterChance: number;
  /**
   * What this room's floor is strewn with, heaviest rung first.
   *
   * The ladder is the same instrument the anchors use and a different job.
   * `assetTags` picks **one** variant and falls back to the whole candidate
   * list, because a piece of furniture a description asked for must not vanish.
   * This one builds a **pool**, so its rungs are what the room holds and there
   * is no catch-all rung underneath them — a guest room strewn with bones is
   * not a truer guest room for nothing having been left out.
   *
   * What replaces the fallback is a guarantee over the catalogue rather than
   * over one room: **no piece of debris the library declares may be off every
   * ladder in the project.** `profiles.test.ts` checks it in that direction,
   * catalogue to room, because the direction this file already had — room to
   * catalogue — is what let `scatter/stool` become unreachable in silence.
   */
  scatterLadder: ScatterRung[];
  /**
   * The room's palette, as tags, **most particular first**.
   *
   * Read as a ladder rather than as a set: `resolveAssets` takes the first tag
   * any candidate carries and chooses among those, so `['weapons', 'dungeon',
   * 'stone']` says "an armoury piece if there is one, otherwise a dungeon one,
   * otherwise a stone one". A flat set cannot do this job, and that is measured
   * rather than assumed — a tavern needs `stone` to tell `hearth` from
   * `stone_hearth` at 3x2 and needs *not* `stone` to tell `stairs_up` from
   * `stone_stairs` at 2x3, so no single set separates both.
   *
   * **It orders; it does not filter.** If nothing in the ladder matches, the
   * whole candidate list stands and the room gets the piece anyway. That is the
   * same answer `resolve.ts` gives a feature that does not fit and `anchorOrder`
   * gives an excluded one: leave nothing out silently.
   */
  assetTags: string[];
};

/**
 * A profile with its variants drawn — what the placement and lighting stages
 * are handed, and the only shape in which a profile names an asset.
 */
export type ResolvedProfile = Omit<PlaceProfile, 'anchors'> & {
  anchors: PlacedAnchor[];
  scatter: ScatterSpec[];
};

/**
 * The half of a room that does not change between buildings: its shape, its
 * bounds, and the slots its furniture stands in.
 *
 * A slot is a footprint and a placement rule with no asset named in it. What
 * fills it is the building's business, and `profileFor` pairs the two lists by
 * index — which is why a room's geometry and every filling of it have to
 * declare the same number of slots, and why `profileFor` says so rather than
 * handing on an `undefined` id.
 */
type RoomGeometry = {
  minSize: Size;
  maxSize: Size;
  doorRange: { min: number; max: number };
  shapes: ShapeName[];
  allowPillars: boolean;
  anchorRange: { min: number; max: number };
  anchors: Pick<AnchorSpec, 'footprint' | 'placement'>[];
  groupsPerHundredCells: { min: number; max: number };
  groups: (Omit<GroupSpec, 'parts'> & { parts: Omit<GroupPart, 'assetId'>[] })[];
  scatterChance: number;
};

/**
 * The Portuguese a pair is spoken about in, everywhere a person or a model
 * reads it.
 *
 * **These three words used to live in three files that no compiler held to the
 * room list**, and that is why they are here. `ROOM_CRITERIA`
 * (`jev/questions.ts`), `ROOM_TEMPLATES` (`local/templates.ts`) and
 * `PLACE_NAMES` (`ui/messages.ts`) are all keyed on a building and a room, and
 * all three are *sparse* on the room axis for a reason that is not going away:
 * a dungeon has a crypt and a tavern does not, so an exact key would demand a
 * name for `tavern_crypt`, a place nothing can produce. Sparse, they compiled
 * happily with a room missing from them, and each one answered a missing room
 * with a runtime throw discovered by whoever got there first.
 *
 * Carried on the filling itself, the room axis gets its compile-time check
 * back without the building axis having to lie: a room a building declares is
 * an object, and an object with no `words` does not compile. The three throws
 * downstream stay where they are — they still guard a pair arriving from a
 * language model through JSON, which no type reaches.
 */
type RoomWords = {
  /** The line under a finished map, capitalised. Read by `ui/messages.ts`. */
  name: string;
  /** The criterion Jev is asked to choose rooms by. Read by `jev/questions.ts`. */
  criterion: string;
  /** The entailment label the local classifier scores. Read by `local/templates.ts`. */
  label: string;
};

/**
 * What one building puts in one of its rooms: the materials, the assets that
 * fill the geometry's slots, and the words the room is spoken about in.
 */
type RoomFilling = {
  floorMaterials: string[];
  wallMaterials: Record<string, string>;
  defaultWallMaterial: string;
  /**
   * One entry per slot the geometry declares, in the geometry's order — or
   * `null` where this building leaves the slot empty.
   *
   * The length still has to match, and `profileFor` still says so. The
   * alternative — deleting the entry — is what would shift every slot after it
   * onto the wrong footprint, and that hazard belongs to the alternative and
   * not to this. `null` says *this building does not put anything here*, which
   * is the same shape `Partial` gives the room axis above — a dungeon has a
   * crypt and a tavern does not — one level further in.
   *
   * **It holds at any index, and that is by construction rather than by luck.**
   * `profileFor` pairs the two lists and filters afterwards, so an empty slot in
   * the middle drops out with the ones on either side of it still on their own
   * footprints. Checked at index 0, 2 and 4 of the guest room: the anchors that
   * come back are `ROOMS.room.anchors` minus that index, each time. The one in
   * use today happens to be last, and nothing rests on that.
   *
   * There is one today, and it is the dungeon cell's fire. The geometry these
   * two rooms share was drawn for a guest room, and a guest room has a hearth;
   * a cell has what the dungeon leaves it, and that is not a fire.
   */
  anchors: (Pick<AnchorSpec, 'concept' | 'feature' | 'light'> | null)[];
  groups: string[][];
  /** What this room's floor is strewn with. See `PlaceProfile.scatterLadder`. */
  scatterLadder: ScatterRung[];
  /**
   * This room's palette ladder, where it is not the building's. See
   * `PlaceProfile.assetTags`; two rooms need one of their own, and both are
   * rooms whose furniture is not what the rest of the building's is.
   */
  assetTags?: string[];
  words: RoomWords;
};

/**
 * What one building has.
 *
 * `Partial` in the room, and the sparseness is the design rather than a gap
 * left open: a dungeon has a crypt and a tavern does not, so the matrix of
 * buildings against rooms has a hole in it. `roomsFor` is what reads the hole —
 * it lists the rooms a building declares, and every table keyed on a building
 * and a room elsewhere in the project is built from that list rather than from
 * `RoomKind`. `profileFor` turns a missing pair into a named throw, which is
 * what the exact `Record` on `ROOMS` buys at compile time and this one cannot.
 */
type BuildingPalette = {
  /** The palette every room of this building uses unless it declares its own. */
  assetTags: string[];
  rooms: Partial<Record<RoomKind, RoomFilling>>;
};

/**
 * Every kind of room this project can build, and the shape of each.
 *
 * **`RoomKind` is derived from these keys** (`core/types.ts`), so this object
 * is the vocabulary rather than a table that has to agree with one. Adding a
 * room is adding an entry here; every exact `Record<RoomKind, …>` in the
 * project — `PROFILES` in `interpreter/resolve.ts`, `GENERATOR_BOUNDS` in its
 * test — then stops compiling until it has been answered, which is the net
 * that caught the hole in `CODE_PHRASES` and is the one thing this collapse
 * was not allowed to cost.
 *
 * The first three shapes are shared by every building and these values are the
 * tavern's, which is history rather than design: the dungeon was fitted into
 * shapes drawn for an inn. `crypt` is not shared — no tavern has one — and it
 * carries a geometry of its own for the three reasons written above it, which
 * is the pattern the next room should copy.
 */
export const ROOM_REGISTRY = {
  hall: {
    minSize: { w: 12, h: 10 },
    maxSize: { w: 20, h: 18 },
    doorRange: { min: 1, max: 3 },
    shapes: ['rectangle', 'l_shape', 't_shape', 'alcove'],
    allowPillars: true,
    anchorRange: { min: 2, max: 3 },
    anchors: [
      { footprint: { w: 5, h: 2 }, placement: 'wall' },
      { footprint: { w: 3, h: 2 }, placement: 'wall' },
      { footprint: { w: 2, h: 3 }, placement: 'corner' },
    ],
    groupsPerHundredCells: { min: 2, max: 5 },
    groups: [
      {
        id: 'round_table',
        size: { w: 4, h: 4 },
        parts: [
          { offset: { x: 1, y: 1 }, footprint: { w: 2, h: 2 } },
          { offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 3, y: 1 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 2, y: 3 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 0, y: 2 }, footprint: { w: 1, h: 1 } },
        ],
      },
      {
        id: 'long_table',
        size: { w: 3, h: 3 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 3, h: 1 } },
          { offset: { x: 0, y: 1 }, footprint: { w: 3, h: 1 } },
          { offset: { x: 0, y: 2 }, footprint: { w: 3, h: 1 } },
        ],
      },
    ],
    scatterChance: 0.16,
  },
  room: {
    minSize: { w: 6, h: 6 },
    maxSize: { w: 11, h: 10 },
    doorRange: { min: 1, max: 2 },
    shapes: ['rectangle', 'alcove'],
    allowPillars: false,
    anchorRange: { min: 1, max: 2 },
    anchors: [
      { footprint: { w: 2, h: 3 }, placement: 'wall' },
      { footprint: { w: 2, h: 3 }, placement: 'wall' },
      { footprint: { w: 2, h: 1 }, placement: 'wall' },
      { footprint: { w: 3, h: 1 }, placement: 'wall' },
      { footprint: { w: 2, h: 1 }, placement: 'wall' },
    ],
    groupsPerHundredCells: { min: 2, max: 6 },
    groups: [
      {
        id: 'writing_desk',
        size: { w: 2, h: 1 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
        ],
      },
    ],
    scatterChance: 0.12,
  },
  storeroom: {
    minSize: { w: 8, h: 6 },
    maxSize: { w: 14, h: 12 },
    doorRange: { min: 1, max: 2 },
    shapes: ['rectangle', 'l_shape'],
    allowPillars: false,
    anchorRange: { min: 1, max: 2 },
    anchors: [
      { footprint: { w: 4, h: 1 }, placement: 'wall' },
      { footprint: { w: 2, h: 3 }, placement: 'corner' },
    ],
    groupsPerHundredCells: { min: 3, max: 8 },
    groups: [
      {
        id: 'crate_stack',
        size: { w: 2, h: 2 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 2, h: 1 } },
          { offset: { x: 0, y: 1 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 1 }, footprint: { w: 1, h: 1 } },
        ],
      },
      {
        id: 'barrel_pair',
        size: { w: 2, h: 1 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
        ],
      },
    ],
    scatterChance: 0.18,
  },
  /**
   * The burial chamber. A dungeon has one; a tavern does not.
   *
   * **It carries its own geometry rather than borrowing the hall's, and this is
   * the first room ever added to this project, so the choice is the pattern the
   * next one will copy.** Three reasons not to extend the tavern's:
   *
   * 1. **The hall's floor is 2 groups per hundred cells, and a crypt needs to be
   *    able to be empty.** That `min` is a floor the furnishing dial cannot get
   *    under: at `furnishing: 0` a hall of 195 cells still comes back with about
   *    four groups (`groupsPerHundredCells`, read by `groupTarget` in
   *    `props.ts`). For a common room that is right — a taproom with no tables in
   *    it is not a taproom. For a crypt it is wrong, and "poucos móveis" was half
   *    of what the person asked for. The `min: 0` below is where that decision
   *    belongs; `props.ts` has no business knowing which rooms may be bare.
   * 2. **The anchor footprints would have to be the tavern hall's** — 5x2 against
   *    a wall, 3x2 against a wall, 2x3 in a corner — because `profileFor` pairs a
   *    filling slot with a geometry slot by index. A sarcophagus would have been
   *    sized by a bar counter.
   * 3. **The pillars.** `growPillars` needs an interior of 9x9, so a room is only
   *    ever columned from 11x11 up (`floorplan.ts`). The `minSize` below starts
   *    there on purpose, so that a crypt asked for with pillars always has room
   *    for them. The hall's 12x10 does not: it is a cell short on height, and the
   *    cost is bigger than its floor. `jitterSize` moves each side by a cell, so
   *    a **small** dungeon hall that asks for pillars comes back with none on
   *    **205 of 600 seeds — 34%** — every one of them a seed that landed on
   *    height 10, and nothing anywhere says so. Out of scope for this front by
   *    agreement, and measured here so that whoever picks it up starts with the
   *    number.
   *
   * No stairs, and that is a statement rather than an omission. Every other room
   * in this project that a person walks down into offers a staircase; a crypt is
   * reached along a passage, and its anchors are what it holds, not how it is
   * entered. `FEATURE_PLACES` in `interpreter/vocabulary.ts` agrees, so a
   * description that asks for steps in a crypt is answered the way this project
   * answers a bar in a bedroom — left out, and recorded in `conflicts`.
   */
  crypt: {
    minSize: { w: 11, h: 11 },
    maxSize: { w: 18, h: 16 },
    // Sealed rather than walked through: the way in, and at most a second one
    // that was broken open later.
    doorRange: { min: 1, max: 2 },
    shapes: ['rectangle', 'l_shape', 't_shape', 'alcove'],
    allowPillars: true,
    // Two rather than one, and it buys exactly one thing: with all three anchors
    // in the draw, `min: 1` leaves one crypt in nine holding nothing but its
    // votive brazier — a lit sconce on a wall, which reads as no particular room.
    //
    // **It is not what keeps the room from coming back bare.** That is the
    // sarcophagus carrying no feature word, in the dungeon's filling below, and
    // the difference matters because the arithmetic here is about a set of three
    // that the ordinary case does not have: `anchorOrder` drops an anchor whose
    // feature is in `excluded`, and the archetypal description of a crypt is a
    // dark one, which scores the `hearth` noul low enough to be read as a
    // refusal. The brazier is then out of the draw before `min` is consulted at
    // all.
    //
    // The "few pieces of furniture" half of what the person asked for is not
    // bought here either; it is bought by `groupsPerHundredCells` below, which is
    // where furniture is counted.
    anchorRange: { min: 2, max: 3 },
    anchors: [
      { footprint: { w: 3, h: 2 }, placement: 'wall' },
      { footprint: { w: 4, h: 1 }, placement: 'wall' },
      { footprint: { w: 2, h: 1 }, placement: 'wall' },
      // A fourth slot at the first one's footprint, and the dungeon's filling
      // below says what it is for. It never makes the room hold four pieces:
      // `anchorRange.max` is three, and the one path that can overrun it —
      // `anchorOrder` putting every *requested* anchor in front without
      // trimming — can only reach three here, because three of these four carry
      // a word and the fourth is the one that does not.
      { footprint: { w: 3, h: 2 }, placement: 'wall' },
    ],
    // See the header: `min: 0` is the whole point of this room having its own
    // geometry. A crypt asked for with no furniture comes back with none.
    groupsPerHundredCells: { min: 0, max: 3 },
    groups: [
      {
        id: 'tomb_slab',
        size: { w: 3, h: 2 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 3, h: 1 } },
          // Shifted off the slab by a cell, which is what makes it read as
          // opened rather than as a second slab.
          { offset: { x: 0, y: 1 }, footprint: { w: 2, h: 1 } },
          { offset: { x: 2, y: 1 }, footprint: { w: 1, h: 1 } },
        ],
      },
      {
        id: 'urn_cluster',
        size: { w: 2, h: 1 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
        ],
      },
    ],
    // Above the hall's 0.16: dust and bone underfoot is what a catacomb is.
    // "cacos de piso quebrado" is what the description that started this asked
    // for, and `scatter/shard` is in the pool the dungeon's `debris` tag
    // answers with, so there is somewhere for it to land.
    scatterChance: 0.2,
  },
  /**
   * The forge floor of a smithy. The fire, the tools, and an anvil standing in
   * the middle of it.
   *
   * **The anvil is a group and not an anchor, and that decision is the one the
   * next six rooms copy.** An anchor needs a wall behind it (`anchorCandidates`
   * asks `backsOnto`), and an anvil is the one thing in a smithy that is
   * emphatically not against one — it is walked around. The slots a room fills
   * against its walls are the fire, the tool rack and the coal bin; the piece
   * the room is *told apart by* stands on the floor, in a group of one part at
   * the piece's own footprint.
   *
   * No pillars, and it is the rule rather than a judgement: `allowPillars: true`
   * under 11x11 is a room that asks for columns and is handed none in silence
   * (`floorplan.ts`, `MIN_INTERIOR_FOR_PILLARS`), which is the defect the hall
   * carries on 205 of 600 seeds. A smithy is a workshop under a low roof, so
   * the honest answer is the one that costs nothing: no columns, and
   * `FEATURE_PLACES` says so.
   *
   * `alcove` is off the shape list for the same reason it is off the store
   * room's: a recess is where a smithy would put its fire, and the fire already
   * has a wall.
   */
  smithy: {
    minSize: { w: 9, h: 8 },
    maxSize: { w: 14, h: 12 },
    // A wide front onto the street and a door to the yard the fuel comes in by.
    doorRange: { min: 1, max: 2 },
    shapes: ['rectangle', 'l_shape'],
    allowPillars: false,
    anchorRange: { min: 2, max: 3 },
    anchors: [
      { footprint: { w: 3, h: 2 }, placement: 'wall' },
      { footprint: { w: 4, h: 1 }, placement: 'wall' },
      { footprint: { w: 2, h: 1 }, placement: 'wall' },
    ],
    // Above the hall's 2, because a smithy with nothing on its floor has no
    // anvil in it, and the anvil is the one group of the two that matters.
    groupsPerHundredCells: { min: 3, max: 6 },
    groups: [
      {
        id: 'anvil',
        size: { w: 1, h: 1 },
        parts: [{ offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } }],
      },
      {
        id: 'quench_bench',
        size: { w: 2, h: 1 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
        ],
      },
    ],
    scatterChance: 0.18,
  },
  /**
   * The reading room of a library: shelves on two walls, a fire, and lecterns
   * standing out on the floor where the light is.
   *
   * **Two `shelving` slots at two footprints, and only one of them carries the
   * word.** The long run and the short run are different pieces in the
   * catalogue, so the room gets both; giving the second the word as well would
   * make "sem prateleiras" empty the room, and leaving it wordless makes it the
   * piece no description can take away. That is the crypt's fourth slot used on
   * purpose rather than discovered afterwards.
   *
   * `alcove` is on the shape list and pillars are not: a reading nook is
   * exactly what a recess off this room is, and the ceiling is a floor of books
   * rather than a vault.
   */
  reading: {
    minSize: { w: 9, h: 8 },
    maxSize: { w: 15, h: 13 },
    doorRange: { min: 1, max: 2 },
    shapes: ['rectangle', 'alcove'],
    allowPillars: false,
    anchorRange: { min: 2, max: 3 },
    anchors: [
      { footprint: { w: 4, h: 1 }, placement: 'wall' },
      { footprint: { w: 3, h: 1 }, placement: 'wall' },
      { footprint: { w: 2, h: 1 }, placement: 'wall' },
      { footprint: { w: 2, h: 3 }, placement: 'corner' },
    ],
    // The guest room's numbers rather than the hall's: a reading room with four
    // tables in it is a refectory.
    groupsPerHundredCells: { min: 2, max: 5 },
    groups: [
      {
        id: 'lectern',
        size: { w: 1, h: 1 },
        parts: [{ offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } }],
      },
      {
        id: 'reading_desk',
        size: { w: 2, h: 1 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
        ],
      },
    ],
    // The lowest in the project. A library is swept, and the two rooms it has
    // are the two that most need their floor readable.
    scatterChance: 0.1,
  },
  /**
   * The stacks. Tighter and taller than the reading room, and the one room in
   * the project that declares **no fire at all on purpose**: a chamber full of
   * parchment is where an open flame is a mistake rather than an omission.
   *
   * Its smallest footprint is 7x7, the smallest of any room here — smaller than
   * the guest room's 6x6 only in that it is square — which is what makes the
   * 4x1 shelf run the longest thing that will stand in it.
   */
  archive: {
    minSize: { w: 7, h: 7 },
    maxSize: { w: 12, h: 11 },
    doorRange: { min: 1, max: 2 },
    shapes: ['rectangle', 'l_shape'],
    allowPillars: false,
    anchorRange: { min: 2, max: 3 },
    anchors: [
      // **1x3, and the only anchor in the project deeper than it is wide.** `w`
      // runs along the wall and `h` is the depth away from it, so this is one
      // cell of wall and three of floor: a ladder leaning into the room off the
      // stack it serves.
      { footprint: { w: 1, h: 3 }, placement: 'wall' },
      { footprint: { w: 4, h: 1 }, placement: 'wall' },
      { footprint: { w: 3, h: 1 }, placement: 'wall' },
      { footprint: { w: 2, h: 1 }, placement: 'wall' },
    ],
    // The store room's numbers. What an archive is, is full.
    groupsPerHundredCells: { min: 3, max: 7 },
    groups: [
      {
        id: 'scroll_boxes',
        size: { w: 2, h: 2 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 2, h: 1 } },
          { offset: { x: 0, y: 1 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 1 }, footprint: { w: 1, h: 1 } },
        ],
      },
      {
        id: 'copy_desk',
        size: { w: 2, h: 1 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
        ],
      },
    ],
    scatterChance: 0.14,
  },
  /**
   * A wizard's working floor. **The only room this front gives pillars to**,
   * and the only one that can honestly have them: `minSize` is 11x11, which is
   * where `growPillars` becomes possible at all (`floorplan.ts`,
   * `MIN_INTERIOR_FOR_PILLARS` is 9x9 and the wall ring eats one a side).
   *
   * That is the crypt's rule applied rather than restated, and it is the whole
   * reason this room is 11x11 and not 10x10. The three halls are a cell short
   * of it and pay 205 of 600 seeds for the shortfall, silently. A room that
   * declares `allowPillars` has to be able to grow them at its own floor or the
   * declaration is a promise to nobody.
   *
   * All four shapes, because this is the one room of the four whose walls are
   * allowed to be strange.
   */
  laboratory: {
    minSize: { w: 11, h: 11 },
    maxSize: { w: 16, h: 15 },
    doorRange: { min: 1, max: 2 },
    shapes: ['rectangle', 'l_shape', 't_shape', 'alcove'],
    allowPillars: true,
    anchorRange: { min: 2, max: 3 },
    anchors: [
      { footprint: { w: 4, h: 1 }, placement: 'wall' },
      { footprint: { w: 3, h: 2 }, placement: 'wall' },
      { footprint: { w: 2, h: 1 }, placement: 'wall' },
      { footprint: { w: 2, h: 3 }, placement: 'corner' },
    ],
    // **The lowest `min` of any room but the crypt, and three groups rather
    // than two.** Both are about the same piece: the summoning circle is 3x3
    // and is drawn from the same list as the other two, so a `min` of 2 and a
    // list of 2 would carpet a laboratory in chalk figures. Three templates put
    // it at a third of the draws, and `min: 1` keeps the count down at the
    // furnishing this room is usually described at.
    groupsPerHundredCells: { min: 1, max: 4 },
    groups: [
      {
        id: 'summoning_circle',
        size: { w: 3, h: 3 },
        parts: [{ offset: { x: 0, y: 0 }, footprint: { w: 3, h: 3 } }],
      },
      {
        id: 'work_bench',
        size: { w: 2, h: 1 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
        ],
      },
      {
        id: 'reagent_stack',
        size: { w: 2, h: 2 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 2, h: 1 } },
          { offset: { x: 0, y: 1 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 1 }, footprint: { w: 1, h: 1 } },
        ],
      },
    ],
    scatterChance: 0.12,
  },
  /**
   * The chamber at the top of the stair, under whatever the roof opens onto.
   *
   * One door, and it is the second room in the project to say so — the guest
   * room is the other, and for the opposite reason. A guest room has one way in
   * because that is what makes it a place you can be cornered in; this one has
   * one because there is nowhere else for a door at the top of a tower to go.
   *
   * No pillars: 9x9 is under the line, and declaring them here would be the
   * hall's silent defect copied into a room built after it was measured.
   */
  observatory: {
    minSize: { w: 9, h: 9 },
    maxSize: { w: 14, h: 13 },
    doorRange: { min: 1, max: 1 },
    shapes: ['rectangle', 'alcove'],
    allowPillars: false,
    anchorRange: { min: 2, max: 3 },
    anchors: [
      { footprint: { w: 2, h: 3 }, placement: 'corner' },
      { footprint: { w: 4, h: 1 }, placement: 'wall' },
      { footprint: { w: 2, h: 1 }, placement: 'wall' },
    ],
    groupsPerHundredCells: { min: 2, max: 4 },
    groups: [
      {
        id: 'armillary_sphere',
        size: { w: 2, h: 2 },
        parts: [{ offset: { x: 0, y: 0 }, footprint: { w: 2, h: 2 } }],
      },
      {
        id: 'chart_desk',
        size: { w: 2, h: 1 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
        ],
      },
    ],
    // The lowest in the project, below the reading room's. A floor somebody
    // works on by starlight is a floor somebody keeps clear.
    scatterChance: 0.08,
  },
  /**
   * The winding house over a mine shaft: the drum, the rope, and the cart that
   * comes up on the end of it.
   *
   * **The winch is a group of one part at its own footprint**, which is the
   * anvil's rule applied for the fifth time rather than a decision taken again:
   * an anchor needs a wall behind it (`anchorCandidates` asks `backsOnto`), and
   * a winding drum stands over the shaft with the rope running down it. What
   * goes against the walls is the tool rack, the lamp, the ore cart and the
   * stair.
   *
   * Four slots against an `anchorRange` of two or three, so the room is never
   * all four at once — the crypt's arithmetic, and here it buys the same thing:
   * the cart is the one slot carrying no word, so a description that refuses
   * the lamp and the rack still leaves the piece the room is told apart by.
   *
   * No pillars and no `alcove`. 8x8 is three cells under the 11x11
   * `growPillars` needs, so declaring them would be the hall's silent defect
   * copied into a room built after it was measured; and a recess off a machine
   * floor is where the shaft is, which is not a place to walk into.
   */
  hoist: {
    minSize: { w: 8, h: 8 },
    maxSize: { w: 13, h: 12 },
    // The door to the gallery, and the one the rope comes in by.
    doorRange: { min: 1, max: 2 },
    shapes: ['rectangle', 'l_shape'],
    allowPillars: false,
    anchorRange: { min: 2, max: 3 },
    anchors: [
      { footprint: { w: 4, h: 1 }, placement: 'wall' },
      { footprint: { w: 2, h: 3 }, placement: 'corner' },
      { footprint: { w: 2, h: 1 }, placement: 'wall' },
      { footprint: { w: 2, h: 1 }, placement: 'wall' },
    ],
    // The reading room's numbers. A winding house is a floor kept clear enough
    // to work the drum on, and the drum is the one group of the two that
    // matters.
    groupsPerHundredCells: { min: 2, max: 5 },
    groups: [
      {
        id: 'pulley_winch',
        size: { w: 2, h: 2 },
        parts: [{ offset: { x: 0, y: 0 }, footprint: { w: 2, h: 2 } }],
      },
      {
        id: 'timber_stack',
        size: { w: 2, h: 2 },
        parts: [
          { offset: { x: 0, y: 0 }, footprint: { w: 2, h: 1 } },
          { offset: { x: 0, y: 1 }, footprint: { w: 1, h: 1 } },
          { offset: { x: 1, y: 1 }, footprint: { w: 1, h: 1 } },
        ],
      },
    ],
    // The crypt's, and for the neighbouring reason: what a winding house has
    // underfoot is the spoil that came up the shaft with the ore.
    scatterChance: 0.2,
  },
} satisfies Record<string, RoomGeometry>;

/**
 * The room registry, in the shape a caller indexes.
 *
 * Two names for one object, and the reason is that no single binding can carry
 * both types. `RoomKind` is `keyof typeof ROOM_REGISTRY`, so annotating that
 * constant `Record<RoomKind, RoomGeometry>` would define the type in terms of
 * itself; left unannotated it keeps its literal key types, which is what makes
 * the derivation possible and what makes `ROOM_REGISTRY[room]` unindexable by a
 * `RoomKind`. Everything reads `ROOMS`; `ROOM_REGISTRY` exists for the
 * compiler, and for `core/types.ts`.
 */
export const ROOMS: Record<RoomKind, RoomGeometry> = ROOM_REGISTRY;

/**
 * Every building this project can build, and what each puts in its rooms.
 *
 * **`Building` is derived from these keys** (`core/types.ts`), the same way
 * `RoomKind` is derived from `ROOMS`.
 */
export const BUILDING_REGISTRY = {
  tavern: {
    // Wood first, then stone: an inn is built of timber and falls back to
    // masonry for the pieces there is no wooden version of — the hearth.
    assetTags: ['wood', 'stone'],
    rooms: {
      hall: {
        floorMaterials: ['wood_plank', 'flagstone'],
        wallMaterials: { wood_plank: 'timber_wall', flagstone: 'stone_wall' },
        defaultWallMaterial: 'stone_wall',
        anchors: [
          { concept: 'bar', feature: 'bar' },
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 6, colorHex: '#ffb46b' } },
          { concept: 'stairs', feature: 'stairs' },
        ],
        groups: [
          ['table_round', 'chair', 'chair', 'chair', 'chair'],
          ['bench', 'table_long', 'bench'],
        ],
        // A taproom floor: what was drunk from, what was sat on, what it came
        // in, and the rushes underneath. Four rungs where one `clutter` tag
        // used to stand, because one tag could not separate the mug from the
        // bottle — the two carried the same pair of words — and a floor
        // written for 45% mugs against 21% bottles drew 27% of each.
        scatterLadder: [
          { tags: ['crockery'], weight: 4 },
          { tags: ['seating'], weight: 2 },
          { tags: ['glass'], weight: 2 },
          { tags: ['bedding'], weight: 1 },
        ],
        words: {
          name: 'Salão de taverna',
          criterion: 'Salão comum da taverna, com mesas, balcão e fregueses',
          label: 'salão de taverna',
        },
      },
      room: {
        floorMaterials: ['wood_plank'],
        wallMaterials: { wood_plank: 'plaster_wall' },
        defaultWallMaterial: 'plaster_wall',
        anchors: [
          { concept: 'bed', feature: 'bed' },
          { concept: 'bunks', feature: 'bunks' },
          { concept: 'storage' },
          { concept: 'shelving', feature: 'shelving' },
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 4, colorHex: '#ffb46b' } },
        ],
        groups: [['table_small', 'chair']],
        // A guest's floor: what was carried up to it, and the bedding. No
        // `seating` rung — a stool on the floor of a bedroom is a taproom's
        // litter, not a guest's — and no `storage`, which is the cellar's.
        //
        // The last rung is `bedding` and not `['clutter', 'debris']`, which is
        // what it was and which quietly put broken floor tile in a guest room:
        // `straw` and `shard` carried the same two words, so asking for the
        // rushes asked for the rubbish as well. An inn sweeps the room it
        // rents out.
        scatterLadder: [
          { tags: ['crockery'], weight: 3 },
          { tags: ['glass'], weight: 2 },
          { tags: ['bedding'], weight: 1 },
        ],
        words: {
          name: 'Quarto de taverna',
          criterion: 'Quarto de hóspedes da taverna, com cama',
          label: 'quarto de taverna',
        },
      },
      storeroom: {
        floorMaterials: ['stone_floor', 'dirt_floor'],
        wallMaterials: { stone_floor: 'stone_wall', dirt_floor: 'stone_wall' },
        defaultWallMaterial: 'stone_wall',
        anchors: [
          { concept: 'shelving', feature: 'shelving' },
          { concept: 'stairs', feature: 'stairs' },
        ],
        groups: [['crate', 'crate_small', 'barrel'], ['barrel', 'barrel']],
        // A cellar's floor, and the room that first showed one tag was never
        // enough: this and the guest room above both asked for `clutter`, and
        // came back the same five pieces in the same flat distribution.
        // Sacking, packing straw and broken floor is what a cellar has;
        // nothing is drunk from down here, so no crockery and no glass.
        //
        // `['clutter', 'stone']` is the shard and only the shard — `rubble` is
        // stone but is not clutter, and the conjunction is what keeps a
        // cellar's broken tiles from arriving as a collapsed wall.
        scatterLadder: [
          { tags: ['storage'], weight: 3 },
          { tags: ['bedding'], weight: 3 },
          { tags: ['clutter', 'stone'], weight: 2 },
        ],
        words: {
          name: 'Depósito de taverna',
          criterion: 'Depósito, porão ou adega da taverna, com barris e mantimentos',
          // `synonyms.ts` steers "porão" and "adega" toward `STOREROOM_WORD` in
          // `local/templates.ts`, and this label has to start with that same
          // word or the rule pushes the description at a label that does not
          // exist. `templates.test.ts` holds the two together.
          label: 'depósito de taverna',
        },
      },
    },
  },
  dungeon: {
    // The other way round, and for the same reason from the other side.
    assetTags: ['dungeon', 'stone'],
    rooms: {
      hall: {
        floorMaterials: ['flagstone', 'stone_floor'],
        wallMaterials: { flagstone: 'stone_wall', stone_floor: 'stone_wall' },
        defaultWallMaterial: 'stone_wall',
        anchors: [
          // **The word costs this room its net, and the room was measured to be
          // able to afford it.** The rack carried no feature, so nothing could
          // refuse it and the hall could never come back with bare walls; now
          // all three of its anchors are refusable, which is the state the
          // tavern hall is in and which empties that room's wall on 1 of the 41
          // sentences of the exclusion corpus. Recomputed over the same 41 with
          // this word in place, the dungeon hall keeps 2.32 anchors on average
          // against 2.59 before, and comes back bare on **0 of 41** — before
          // and after. The crypt, whose net is the same shape, does not survive
          // the same change and declares a second slot below.
          { concept: 'weapons', feature: 'weapons' },
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 6, colorHex: '#ffb46b' } },
          { concept: 'stairs', feature: 'stairs' },
        ],
        groups: [
          ['war_table', 'guard_stool', 'guard_stool', 'guard_stool', 'guard_stool'],
          ['stone_bench', 'war_table_long', 'stone_bench'],
        ],
        // Bone, then the manacle, then the fallen wall, then the dust. The
        // first rung is a conjunction: `remains` alone would take the skull
        // too, and a guard room is not a burial chamber.
        scatterLadder: [
          { tags: ['remains', 'dungeon'], weight: 4 },
          { tags: ['iron'], weight: 2 },
          { tags: ['masonry'], weight: 2 },
          { tags: ['grime'], weight: 1 },
        ],
        words: {
          name: 'Salão da masmorra',
          criterion: 'Sala comum ou da guarda da masmorra',
          label: 'salão da masmorra',
        },
      },
      room: {
        floorMaterials: ['flagstone', 'stone_floor'],
        wallMaterials: { flagstone: 'stone_wall', stone_floor: 'stone_wall' },
        defaultWallMaterial: 'stone_wall',
        anchors: [
          { concept: 'bed', feature: 'bed' },
          { concept: 'bunks', feature: 'bunks' },
          { concept: 'storage' },
          { concept: 'shelving', feature: 'shelving' },
          // **The guest room's fire, and a cell does not have one.** The slot
          // is the geometry's and the geometry is shared, so it stays in the
          // list and stays empty rather than being taken out from under the
          // tavern.
          //
          // It used to hold a hearth with no feature word on it, and that made
          // `vocabulary.ts` a lie in the one direction a person can see:
          // `FEATURE_PLACES` does not list `hearth` for this room, so "uma cela
          // com uma lareira" comes back `FEATURE_NOT_IN_PLACE` — the interface
          // saying a fire does not belong in this kind of place — while the
          // fill could draw one anyway, because an anchor with no feature is
          // never filtered. Emptying the slot is what makes the message true,
          // and it is the direction the room's own comment already pointed in.
          //
          // **The cost is that the cell now has no light source at all.** This
          // was its only anchor carrying one, so `scene.lights` comes back
          // empty at every dark seed. Counted rather than assumed, because the
          // count is worse than the front that made this change believed: the
          // two store rooms already declare no light-bearing anchor at all, so
          // this made **three** of the seven rooms unlit by their own
          // furniture. The crypt is not one of them — its brazier carries a
          // light and is lost to `excluded`, not to the table — so the two
          // cases are different and only this comment says so.
          //
          // **Six of fifteen as of the observatory.** The nave declares an altar
          // where the halls declare a fire and has no 2x1 slot to put a sconce
          // in; the archive declares no fire on purpose, because a room full of
          // parchment is the one room in this project that should not have one;
          // the observatory is lit by what it is pointed at. The count is
          // carried forward here rather than restated in each
          // room, because a room with no light of its own is a property of the
          // set and not of the room: it is what `Scene.lights` comes back empty
          // for at every dark seed. (It read "four of nine" for one commit,
          // which counted the rooms right and the pairs wrong: the temple made
          // it four of eleven.)
          null,
        ],
        groups: [['prison_desk', 'guard_stool']],
        // A cell has only what the dungeon itself leaves: bone, chain and
        // dust, which is the set this room always had. No masonry rung — the
        // walls of a cell are the one thing kept intact.
        //
        // One rung for the three of them is what this was, and it made them
        // equal by construction: `bone`, `broken_chain` and `dust` carried the
        // same two words, so a cell written for 46% bone drew 31%, behind the
        // chain and the dust at 35% and 34%. Three rungs is the difference.
        scatterLadder: [
          { tags: ['remains', 'dungeon'], weight: 3 },
          { tags: ['iron'], weight: 2 },
          { tags: ['grime'], weight: 1 },
        ],
        words: {
          name: 'Cela da masmorra',
          criterion: 'Cela ou quarto da masmorra, com catre',
          label: 'cela da masmorra',
        },
      },
      storeroom: {
        floorMaterials: ['flagstone', 'stone_floor'],
        wallMaterials: { flagstone: 'stone_wall', stone_floor: 'stone_wall' },
        defaultWallMaterial: 'stone_wall',
        anchors: [{ concept: 'shelving', feature: 'shelving' }, { concept: 'stairs', feature: 'stairs' }],
        groups: [['supply_crate', 'small_crate', 'weapon_bundle'], ['weapon_bundle', 'weapon_bundle']],
        // An arsenal's floor: spilled arrows and the dust they lie in, over
        // stone that has come down. No bone and no chain — nobody is kept in
        // the store room — and that is what the broad `['dungeon', 'debris']`
        // rung this replaces could not say. It was the worst floor in the
        // project by a distance, 0.466 from the one this room was written
        // with, and it had gone from three pieces to six.
        scatterLadder: [
          { tags: ['weapons'], weight: 3 },
          { tags: ['grime'], weight: 3 },
          { tags: ['masonry'], weight: 2 },
        ],
        assetTags: ['weapons', 'dungeon', 'stone'],
        words: {
          name: 'Arsenal da masmorra',
          criterion: 'Arsenal ou depósito da masmorra, com armas e caixotes',
          label: 'arsenal da masmorra',
        },
      },
      crypt: {
        floorMaterials: ['stone_floor', 'flagstone'],
        wallMaterials: { stone_floor: 'stone_wall', flagstone: 'stone_wall' },
        defaultWallMaterial: 'stone_wall',
        anchors: [
          // **The sarcophagus a description can ask for**, which is what
          // admitting `tomb` to the vocabulary bought — and what it cost is the
          // slot below.
          { concept: 'tomb', feature: 'tomb' },
          { concept: 'shelving', feature: 'shelving' },
          // The only light this room has, and it is worth saying that the room
          // usually has none: a crypt described the archetypal way is described
          // as dark, `hearth` is read as refused, and the brazier is dropped —
          // so `Scene.lights` comes back empty. That is the honest reading of
          // the sentence and not a fault; the v1 renderer draws no light anyway.
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 3, colorHex: '#ffb46b' } },
          // **No feature word, and that is the net.** `anchorOrder` refuses an
          // anchor whose feature is in `excluded`, and a featureless anchor can
          // never be in `excluded`, so this is the one piece of the room that no
          // description can take away — the same job `weapon_rack` used to do in
          // the dungeon hall. It is also what actually carried the map the crypt
          // front exists for: that description excluded `hearth` along with
          // `stairs`, so the brazier never entered the draw and the crypt came
          // back as a sarcophagus and a bone niche.
          //
          // **It used to be the slot above, and giving that slot a word spent
          // it.** Measured over the 41 sentences of the exclusion corpus, the
          // crypt with all three of its anchors refusable keeps 2.27 of them
          // and comes back with bare walls on 1 of 41 — the one being `"Uma
          // sala nua, sem nada nas paredes e sem móveis."`, which puts `tomb`,
          // `shelving` and `hearth` at 0.03, 0.03 and 0.04, all under the
          // exclusion threshold. With this slot the same 41 give 3.27 and 0 of
          // 41, which is where the room was before the word.
          //
          // **The dungeon hall was measured too and does not get one**: the
          // same 41 take it from 2.59 anchors to 2.32 and leave it bare on 0 of
          // 41 both ways, so a net there would be furniture bought against a
          // risk that did not turn up.
          //
          // **What it costs is visible and is not small.** Every figure below is
          // 400 seeds at this room's largest floor, 18x16, `light: 'dark'`, one
          // door, nothing excluded — the counts move with the floor and the
          // configuration is part of them.
          //
          // *The sarcophagus twice.* The library has one `tomb` anchor at 3x2,
          // so this slot and the one above draw the same piece: 130 of 400
          // crypts hold two of them with nothing asked for, and 197 do when the
          // description asks for a tomb by name. It is never four anchors —
          // `anchorRange.max` is three and only three of these four carry a
          // word, so the one path that can overrun the range cannot reach the
          // fourth. The repeated piece is always the sarcophagus.
          //
          // *The refusal only half works.* "sem túmulos" still leaves a
          // sarcophagus standing on 333 of 400 seeds, against 369 when nothing
          // is refused, because this slot is not the one the word names.
          //
          // *And the room goes dark more often, which is the cost that nearly
          // went unwritten.* This slot competes for the same two or three places
          // `anchorRange` allows, and the piece it pushes out is often the
          // votive brazier — the crypt's only anchor carrying a light. Bare
          // `Scene.lights` goes from **66 of 400 to 151 of 400**, the brazier
          // from 334 to 249 and the bone niche from 326 to 267; asking for
          // `tomb` by name takes the dark crypts to 197 of 400. On the 14x12
          // fixture the generator's own tests build, it is 4 of 24 seeds against
          // 9 of 24.
          //
          // **The user was asked and accepted it: the dark crypt stays.** It is
          // not a consequence of choosing this footprint either — the 4x1
          // alternative below pays exactly the same, 151 of 400 and 197 of 400
          // and 9 of 24, to the seed. Darkness is the price of having a net at
          // all, and the room was already the one the project describes as
          // usually unlit.
          //
          // The alternative measured beside it was a second 4x1 slot, which
          // draws the bone niche instead: it makes "sem túmulos" take the
          // sarcophagus away completely, and pays for it by doubling the bone
          // niche on 141 of 400 seeds with nothing asked and 271 of 400 when
          // tombs are refused, and by making **`shelving`**'s refusal the
          // half-working one, since the niche is what that word names. A word
          // admitted this front can afford to be the one that pays; `shelving`
          // was measured against a corpus that assumed it worked.
          { concept: 'tomb' },
        ],
        groups: [
          ['grave_slab', 'slab_lid', 'grave_marker'],
          ['funerary_urn', 'funerary_urn'],
        ],
        // **Bone first, and it took a word in the catalogue to say so.** Read
        // as one `['dungeon', 'debris']` rung, bone could not be the heaviest
        // piece of this floor at any weight — `broken_chain` and `dust`
        // carried the same two words, so the three moved together and a crypt
        // written for 32% bone drew 20% of each. `remains` is the word, and
        // `['remains', 'dungeon']` is bone alone: the skull is remains too, and
        // is asked for below by the word for where it belongs.
        //
        // Rung by rung: the bones, the vault come down, the skull, the broken
        // floor the description that made this room asked for, and the dust.
        // No `broken_chain` — nobody is chained up in a crypt — which one
        // `dungeon` rung could not have said either.
        scatterLadder: [
          { tags: ['remains', 'dungeon'], weight: 4 },
          { tags: ['masonry'], weight: 3 },
          { tags: ['tomb'], weight: 2 },
          { tags: ['clutter', 'stone'], weight: 2 },
          { tags: ['grime'], weight: 2 },
        ],
        // `tomb` rather than `dungeon`, and this is the room that proves the
        // ladder has to be a room's and not only a building's. The three pieces
        // that make a crypt read as a crypt are each the *third* candidate at
        // their footprint — `bone_niche` behind `shelf_row` and `armory_rack`,
        // `votive_brazier` behind `hearth_small` and `wall_torch` — and
        // `dungeon` picks the guard room's piece every time.
        assetTags: ['tomb', 'stone'],
        words: {
          name: 'Cripta da masmorra',
          // **Measured, and the other three criteria were left alone because
          // measuring said to.** The corpus is 15 sentences — six of a crypt,
          // nine controls of the other three rooms — in `corpus-cripta-jev.md`,
          // beside the canonical ruler outside this repository for the reason
          // that one gives. On the three criteria as they stood, all six crypt
          // sentences missed, and the instructive part is where they went: four
          // of the six landed in `room`, the cell. The description that started
          // that front is the exception and landed in `hall` at 0.78, which is
          // the guard room the person was handed.
          //
          // With this line the six come back `crypt` at 0.99 or better, the nine
          // controls are unmoved, and the two traps hold: a guard room with
          // bones on its floor keeps `hall` at 0.96 with `crypt` at 0.04, and a
          // dungeon room with stone pillars at 0.96 against 0.02. Bone and
          // pillar on their own do not move the choice.
          //
          // A longer wording was tried alongside a reworded `hall` ("onde os
          // vivos se reúnem"), and it scored the same 14/15 while taking `hall`
          // down to 0.83 and 0.82 on those same two traps. It is the lesson
          // `FEATURE_THRESHOLD`'s neighbours already record: enriching the
          // wording redistributes probability mass instead of adding coverage.
          // The crypt sentences were already at 0.99, so there was nothing to
          // buy and only neighbours to spend.
          criterion: 'Cripta, catacumba ou tumba: câmara funerária com sarcófagos, ossadas e nichos',
          // A short Portuguese noun phrase with no alternative inside it, which
          // is the shape the bench found works for the other labels. **No
          // accuracy measurement**, like every label here except the seven
          // features: that front had no gold for the room choice. The word was
          // measured on the Jev engine, where a criterion can carry synonyms
          // without making them compete (the `criterion` above), and that
          // measurement does not transfer to an entailment premise.
          label: 'cripta da masmorra',
        },
      },
    },
  },
  /**
   * The smith's. Two rooms and one of them is a room this project already had.
   *
   * **The palette ladder leads with the building's own word**, which the tavern
   * and the dungeon do not — theirs lead with a material, `wood` and `dungeon`.
   * The reason is that the catalogue is twenty pieces wider than it was: a rung
   * naming a material now reaches pieces drawn for other buildings, and
   * `['iron', …]` here would have furnished the shop front with `ore_cart`, the
   * mine's. A building word is the one rung nothing else can carry.
   *
   * The shop front reuses the guest room's geometry, and what that buys and
   * costs is exactly what the crypt's header predicted. It buys five slots
   * already dimensioned and a group already drawn. It costs the 2x3 at index 1,
   * which is a bunk in a room people sleep in and is nothing at all in a shop —
   * left `null`, the way the cell leaves the guest room's fire.
   */
  forge: {
    assetTags: ['forge', 'wood', 'stone'],
    rooms: {
      smithy: {
        floorMaterials: ['forge_floor', 'dirt_floor'],
        wallMaterials: { forge_floor: 'forge_wall', dirt_floor: 'stone_wall' },
        defaultWallMaterial: 'forge_wall',
        anchors: [
          // The forge itself. A wider light than a hearth's, because the fire
          // in a smithy is the reason the room is lit at all.
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 7, colorHex: '#ff9a4d' } },
          { concept: 'shelving', feature: 'shelving' },
          // **The net.** `storage` carries no word, so no description can refuse
          // it, and this room's other two anchors both can be refused — which
          // is the arithmetic the crypt's fourth slot was added for.
          { concept: 'storage' },
        ],
        groups: [['anvil'], ['barrel', 'crate_small']],
        // Scale off the iron, the coal dust, and the stone the fire has spalled
        // off the wall. `['iron']` is the broken chain and only it — scrap in a
        // smithy is scrap iron — and the rung order is what keeps it ahead of
        // the dust.
        scatterLadder: [
          { tags: ['iron'], weight: 3 },
          { tags: ['grime'], weight: 3 },
          { tags: ['masonry'], weight: 2 },
        ],
        words: {
          name: 'Forja da ferraria',
          criterion: 'A forja da ferraria: a oficina com a fornalha, a bigorna e as ferramentas',
          label: 'forja da ferraria',
        },
      },
      room: {
        floorMaterials: ['forge_floor'],
        wallMaterials: { forge_floor: 'forge_wall' },
        defaultWallMaterial: 'forge_wall',
        anchors: [
          // The stair to the rooms over the shop. The guest room's first slot is
          // a bed at 2x3 and a staircase is 2x3 as well, which is what makes
          // this reuse work at all.
          { concept: 'stairs', feature: 'stairs' },
          // The bunks. A shop front has nobody sleeping in it.
          null,
          { concept: 'storage' },
          // **The blade display, and the slot the guest room fills with a short
          // shelf.** Both are 3x1 against a wall; `weapons` at that footprint is
          // one piece in the whole catalogue, so no palette rung is doing any
          // work here.
          { concept: 'weapons', feature: 'weapons' },
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 4, colorHex: '#ffb46b' } },
        ],
        groups: [['table_small', 'chair']],
        scatterLadder: [
          { tags: ['iron'], weight: 3 },
          { tags: ['grime'], weight: 2 },
          { tags: ['storage'], weight: 1 },
        ],
        words: {
          name: 'Loja da ferraria',
          criterion: 'A frente de loja da ferraria, com as lâminas à mostra e o balcão de venda',
          label: 'loja da ferraria',
        },
      },
    },
  },
  /**
   * The temple. **Both of its rooms borrow a geometry**, which no building in
   * this project had done before: the nave is the common room's shapes and the
   * sacristy is the guest room's.
   *
   * It is the cheapest a building can be and the reuse is honest rather than
   * lazy — a nave is a wide room with a long wall, a recess, and a span that
   * wants columns, which is the common room's geometry described in other
   * words. What it inherits with it is the common room's known defect: a hall
   * asked for pillars under 11x11 is handed none in silence, on 205 of 600
   * seeds. The nave is exposed to it because it shares the geometry, not
   * because this front added a room with it, and it is left alone here for the
   * same reason the hall's is.
   *
   * **The 5x2 slot is empty and it is the only one of the three a nave has no
   * use for.** The concepts the catalogue answers at that footprint are a bar
   * counter and a weapon rack. Leaving it `null` costs the room its only
   * possible sconce — see the unlit count on the cell's empty slot above — and
   * putting a serving counter in a nave to buy a light back is not a trade
   * worth making.
   */
  temple: {
    assetTags: ['temple', 'stone', 'wood'],
    rooms: {
      hall: {
        floorMaterials: ['mosaic_floor', 'flagstone'],
        wallMaterials: { mosaic_floor: 'sanctum_wall', flagstone: 'stone_wall' },
        defaultWallMaterial: 'sanctum_wall',
        anchors: [
          // The bar counter's slot. A nave has neither that nor an armoury.
          null,
          // **The altar, and the room's net.** `altar` carries no word, so this
          // is the piece no description can refuse — which matters more here
          // than anywhere, because the only other anchor the room has is the
          // stair and `stairs` is one of the words a dark, ruined description
          // scores low enough to read as refused.
          { concept: 'altar' },
          { concept: 'stairs', feature: 'stairs' },
        ],
        groups: [
          // The offering table and its seats, in the round table's shape.
          ['table_round', 'chair', 'chair', 'chair', 'chair'],
          // **Three stone benches in the long table's three rows**, which is
          // the one place the borrowed geometry reads better than the room it
          // was drawn for: three parallel 3x1 runs is a bank of pews.
          ['stone_bench', 'stone_bench', 'stone_bench'],
        ],
        // Wax and dust, the vault coming down, and the rushes underfoot. No
        // crockery and no glass: nothing is drunk from in a nave.
        scatterLadder: [
          { tags: ['grime'], weight: 3 },
          { tags: ['masonry'], weight: 2 },
          { tags: ['bedding'], weight: 1 },
        ],
        words: {
          name: 'Nave do templo',
          // **Pending measurement.** The building question's wording for
          // `temple` was measured and failed — it takes three crypt sentences,
          // one at 0.93 — and the repair the user approved touches the
          // dungeon's criterion as well, so the final strings for both are
          // being measured together. This is the plan's wording until they
          // arrive.
          criterion: 'A nave do templo: o corpo principal, com o altar e os bancos',
          label: 'nave do templo',
        },
      },
      room: {
        floorMaterials: ['mosaic_floor'],
        wallMaterials: { mosaic_floor: 'sanctum_wall' },
        defaultWallMaterial: 'sanctum_wall',
        anchors: [
          { concept: 'stairs', feature: 'stairs' },
          null,
          // **The vestment cabinet, and the collision the map predicted.** It is
          // `storage` at 2x1, which is the wardrobe's concept at the wardrobe's
          // footprint — three pieces answer that query now. It is resolved
          // where `storage` itself was: on the palette rung, by the building's
          // own word, which is the only tag of the three that one piece carries
          // and the other two do not.
          { concept: 'storage' },
          { concept: 'shelving', feature: 'shelving' },
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 4, colorHex: '#ffd9a0' } },
        ],
        groups: [['table_small', 'chair']],
        // The vessels first: a sacristy is the room the plate is kept in.
        scatterLadder: [
          { tags: ['crockery'], weight: 3 },
          { tags: ['grime'], weight: 2 },
          { tags: ['bedding'], weight: 1 },
        ],
        words: {
          name: 'Sacristia do templo',
          criterion: 'A sacristia do templo, onde se guardam os paramentos e as alfaias',
          label: 'sacristia do templo',
        },
      },
    },
  },
  /**
   * The library. Two rooms, two geometries of its own, and **no `RoomKind` it
   * shares with anything** — the first building of which that is true.
   *
   * It is also the building that shows what a geometry of its own is *for*,
   * which the crypt's header claims and one room could not demonstrate: the two
   * rooms here are the same furniture at two densities and two scales. The
   * reading room is wide, swept and lit; the archive is the smallest footprint
   * in the project, the fullest floor, and the only room that declares no fire
   * at all. Fitted into one geometry they would have been one room with a dial.
   */
  library: {
    assetTags: ['library', 'wood', 'stone'],
    rooms: {
      reading: {
        floorMaterials: ['oak_floor'],
        wallMaterials: { oak_floor: 'library_wall' },
        defaultWallMaterial: 'library_wall',
        anchors: [
          { concept: 'shelving', feature: 'shelving' },
          // **The second shelf run, and the room's net.** Same concept, a
          // different footprint, so it is a different piece; no word on it, so
          // "sem prateleiras" takes the long run and leaves the short one.
          { concept: 'shelving' },
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 5, colorHex: '#ffb46b' } },
          { concept: 'stairs', feature: 'stairs' },
        ],
        groups: [['lectern'], ['table_small', 'chair']],
        // Dust, the packing straw a consignment came in, and the one broken
        // tile. No crockery and no glass: nothing is drunk over the books.
        scatterLadder: [
          { tags: ['grime'], weight: 3 },
          { tags: ['bedding'], weight: 2 },
          { tags: ['clutter', 'stone'], weight: 1 },
        ],
        words: {
          name: 'Sala de leitura da biblioteca',
          criterion: 'A sala de leitura da biblioteca, com as estantes, o atril e as mesas de estudo',
          // Three words, because four is the ceiling the bench measured and
          // "sala de leitura da biblioteca" is five. The building is carried by
          // `BUILDING_TEMPLATE`, which is asked first.
          label: 'sala de leitura',
        },
      },
      archive: {
        floorMaterials: ['archive_floor'],
        wallMaterials: { archive_floor: 'library_wall' },
        defaultWallMaterial: 'library_wall',
        anchors: [
          // **The shelf ladder, the distinctive piece and the net at once.**
          // `ladder` carries no word, which is what this room needs more than
          // most: its other three anchors are two shelf runs and a chest, and
          // `shelving` and `storage` between them are the whole room.
          { concept: 'ladder' },
          { concept: 'shelving', feature: 'shelving' },
          { concept: 'shelving' },
          { concept: 'storage' },
        ],
        groups: [['crate', 'crate_small', 'crate_small'], ['table_small', 'chair']],
        // Dust first, then the sacking a bundle of deeds is tied in, then the
        // straw. The archive is the room the library does not sweep.
        scatterLadder: [
          { tags: ['grime'], weight: 3 },
          { tags: ['storage'], weight: 2 },
          { tags: ['bedding'], weight: 1 },
        ],
        words: {
          name: 'Arquivo da biblioteca',
          criterion: 'O arquivo da biblioteca: os pergaminhos e os registros guardados nas estantes altas',
          label: 'arquivo da biblioteca',
        },
      },
    },
  },
  /**
   * The wizard's tower. Two rooms, two geometries, and one stair between them:
   * the laboratory's corner stair is the one the observatory's comes up from,
   * which is the only place in this project where two rooms of one building are
   * stated to be above and below each other.
   */
  tower: {
    assetTags: ['arcane', 'stone', 'wood'],
    rooms: {
      laboratory: {
        floorMaterials: ['slate_floor', 'flagstone'],
        wallMaterials: { slate_floor: 'slate_wall', flagstone: 'stone_wall' },
        defaultWallMaterial: 'slate_wall',
        anchors: [
          { concept: 'shelving', feature: 'shelving' },
          // The athanor: a furnace kept alight for months, which is the one
          // thing in a laboratory that is also a hearth.
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 5, colorHex: '#9fd4ff' } },
          // The reagent cabinet, and the net.
          { concept: 'storage' },
          { concept: 'stairs', feature: 'stairs' },
        ],
        groups: [['summoning_circle'], ['table_small', 'chair'], ['crate', 'barrel', 'barrel']],
        // Glass first, and this is the only floor in the project that leads
        // with it: what a laboratory drops is what it decanted into.
        scatterLadder: [
          { tags: ['glass'], weight: 3 },
          { tags: ['grime'], weight: 2 },
          { tags: ['masonry'], weight: 1 },
        ],
        words: {
          name: 'Laboratório da torre',
          criterion: 'O laboratório da torre, com o círculo de invocação e os instrumentos de estudo',
          label: 'laboratório da torre',
        },
      },
      observatory: {
        floorMaterials: ['slate_floor'],
        wallMaterials: { slate_floor: 'slate_wall' },
        defaultWallMaterial: 'slate_wall',
        anchors: [
          { concept: 'stairs', feature: 'stairs' },
          { concept: 'shelving', feature: 'shelving' },
          { concept: 'storage' },
        ],
        groups: [['armillary_sphere'], ['table_small', 'chair']],
        scatterLadder: [
          { tags: ['glass'], weight: 3 },
          { tags: ['grime'], weight: 2 },
          { tags: ['bedding'], weight: 1 },
        ],
        words: {
          name: 'Observatório da torre',
          criterion: 'O observatório no alto da torre, com a esfera armilar e as cartas celestes',
          label: 'observatório da torre',
        },
      },
    },
  },
  /**
   * The mine. A gallery cut into the rock, and the winding house over the shaft
   * it is cut from.
   *
   * **The palette ladder's fourth rung is `wood` and its third is `stone`, and
   * the order of those two is the whole of what keeps a bone niche out of this
   * building.** `dungeon` was the obvious third rung — a mine is underground,
   * dark and full of iron, and it would have drawn the wall torch this
   * catalogue has and nothing else uses. It also draws `bone_niche` at the 4x1
   * `shelving` slot, ahead of the shelf run, because the niche is the only
   * `shelving` piece carrying `dungeon`. A tool rack is what a gallery has; an
   * ossuary is not. So the torch stays unreached, which is written down in the
   * report for this front rather than quietly repaired here.
   *
   * The gallery reuses the guest room's geometry, and what it buys is the ore
   * cart's slot already dimensioned: `storage` at 2x1 is what the wardrobe and
   * the lockers stand in, and `mine` is the rung nothing else carries. It costs
   * the 2x3 at index 1 — the bunks — which is `null` here for the reason it is
   * `null` in the cell and in the shop front.
   */
  mine: {
    assetTags: ['mine', 'iron', 'stone', 'wood'],
    rooms: {
      room: {
        floorMaterials: ['gravel_floor', 'dirt_floor'],
        wallMaterials: { gravel_floor: 'shoring_wall', dirt_floor: 'shoring_wall' },
        defaultWallMaterial: 'shoring_wall',
        anchors: [
          // Up to the surface. `stairs` at 2x3 is the stair the whole project
          // shares, and `stone` ahead of `wood` is what makes it the cut one
          // rather than the inn's.
          { concept: 'stairs', feature: 'stairs' },
          // The bunks. Nobody sleeps at the face.
          null,
          // **The ore cart, and the room's net.** `storage` carries no word in
          // `CONCEPTS`, so no description can refuse it — which this room needs,
          // because its other three anchors can all be refused and the cart is
          // the piece the gallery is told apart by.
          { concept: 'storage' },
          // The tool rack.
          { concept: 'shelving', feature: 'shelving' },
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 4, colorHex: '#ffb46b' } },
        ],
        groups: [['crate_small', 'barrel']],
        // The rock that came down, the scrap off the tools, and the dust it all
        // lies in. No `bedding` and no `crockery`: nothing is slept on or drunk
        // from at the face.
        scatterLadder: [
          { tags: ['masonry'], weight: 3 },
          { tags: ['iron'], weight: 2 },
          { tags: ['grime'], weight: 2 },
        ],
        words: {
          name: 'Galeria da mina',
          criterion: 'A galeria de escavação da mina, com o carrinho de minério e a rocha cortada',
          label: 'galeria da mina',
        },
      },
      hoist: {
        floorMaterials: ['gravel_floor'],
        wallMaterials: { gravel_floor: 'shoring_wall' },
        defaultWallMaterial: 'shoring_wall',
        anchors: [
          { concept: 'shelving', feature: 'shelving' },
          { concept: 'stairs', feature: 'stairs' },
          // The cart again, and it is the same piece on purpose: the cart is
          // what goes down the gallery and comes up the shaft, so the building
          // has it at both ends. The crypt's sarcophagus is the precedent for
          // one piece standing in two slots; this is one piece standing in two
          // rooms.
          { concept: 'storage' },
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 4, colorHex: '#ffb46b' } },
        ],
        groups: [['pulley_winch'], ['crate', 'crate_small', 'crate_small']],
        // Scrap first here rather than stone: what a winding house drops is
        // what the gear is made of.
        scatterLadder: [
          { tags: ['iron'], weight: 3 },
          { tags: ['masonry'], weight: 2 },
          { tags: ['grime'], weight: 1 },
        ],
        words: {
          name: 'Casa de guincho da mina',
          criterion: 'A casa de guincho da mina, com o sarilho e o poço por onde sobe o minério',
          label: 'casa de guincho',
        },
      },
    },
  },
} satisfies Record<string, BuildingPalette>;

/**
 * The building registry, in the shape a caller indexes — the same pair of names
 * as `ROOMS` above, for the same reason.
 *
 * The widening matters twice here rather than once. `Building` comes off
 * `BUILDING_REGISTRY`'s keys, and the *room* axis widens to the
 * `Partial<Record<RoomKind, …>>` the sparse matrix actually is, which is what
 * lets a caller ask a building for a room it may not have.
 */
export const BUILDINGS: Record<Building, BuildingPalette> = BUILDING_REGISTRY;

export function roomsFor(building: Building): readonly RoomKind[] {
  if (!Object.hasOwn(BUILDINGS, building)) {
    throw new Error(`unknown building '${String(building)}'`);
  }
  return (Object.keys(BUILDINGS[building].rooms) as RoomKind[]).filter(
    (room) => BUILDINGS[building].rooms[room] !== undefined,
  );
}

/**
 * The Portuguese `building` speaks about `room` in, or nothing.
 *
 * Both arguments are bare strings, because the three callers are all answering
 * a pair that arrived from outside the type system — a model's JSON, or the
 * `building_room` identifier carried in a conflict code — and each turns the
 * absence into its own message.
 *
 * `Object.hasOwn` on **both** axes. These are object literals, so
 * `BUILDINGS['toString']` is a function rather than `undefined` and
 * `BUILDINGS.tavern.rooms['__proto__']` is an object; both walk past a `??`,
 * and the first would be concatenated into a notice. Closing a vocabulary means
 * asking whether the table declared the key, not whether the lookup happened to
 * come back empty.
 */
export function placeWords(building: string, room: string): RoomWords | undefined {
  if (!Object.hasOwn(BUILDINGS, building)) {
    return undefined;
  }
  const rooms = BUILDINGS[building as Building].rooms;
  return Object.hasOwn(rooms, room) ? rooms[room as RoomKind]?.words : undefined;
}

/**
 * The profile for a building and room pair.
 *
 * @throws {Error} if `BUILDINGS` does not declare the pair. The type system
 *                 rules this out inside the project, but `Params` may have
 *                 come through a language model and a JSON boundary.
 *
 * `Object.hasOwn`, because these tables are object literals and a lookup on
 * `'toString'` or `'__proto__'` comes back with something inherited rather
 * than with `undefined` — a key every JSON document can carry, and
 * one that would be handed on as a profile to all three generation stages.
 * The whole point of the guard is to close the vocabulary, and a vocabulary
 * is closed by what it declares, not by what a lookup fails to find.
 */
export function profileFor(place: Place): PlaceProfile {
  if (!place || !Object.hasOwn(BUILDINGS, place.building) ||
      !Object.hasOwn(ROOMS, place.room) ||
      !Object.hasOwn(BUILDINGS[place.building].rooms, place.room) ||
      BUILDINGS[place.building].rooms[place.room] === undefined) {
    throw new Error(`unknown place '${String(place?.building)}_${String(place?.room)}'`);
  }
  const geometry: RoomGeometry = ROOMS[place.room];
  const building = BUILDINGS[place.building];
  const filling = building.rooms[place.room]!;
  if (filling.anchors.length !== geometry.anchors.length ||
      filling.groups.length !== geometry.groups.length ||
      geometry.groups.some((group, index) => filling.groups[index].length !== group.parts.length) ||
      filling.anchors.some((slot) => slot !== null && !slot.concept) ||
      filling.groups.some((group) => group.some((id) => !id))) {
    throw new Error(`invalid slot filling for '${place.building}_${place.room}'`);
  }
  // A slot may be asked for by the word that names its concept, or by no word
  // at all. Any other pairing is a request that would be answered by the wrong
  // piece of furniture: `anchorOrder` puts a requested anchor first and drops an
  // excluded one by this word alone, so a `bunks` slot claiming `hearth` would
  // make "sem lareira" take the beds out of the room. Nothing else checks it —
  // `feature` is the building's to declare and `CONCEPTS` is the project's.
  for (const slot of filling.anchors) {
    if (slot !== null && slot.feature !== undefined && slot.feature !== featureOf(slot.concept)) {
      throw new Error(
        `feature '${slot.feature}' does not ask for concept '${slot.concept}' in '${place.building}_${place.room}'`,
      );
    }
  }
  return {
    place,
    ...geometry,
    floorMaterials: filling.floorMaterials,
    wallMaterials: filling.wallMaterials,
    defaultWallMaterial: filling.defaultWallMaterial,
    assetTags: filling.assetTags ?? building.assetTags,
    scatterLadder: filling.scatterLadder,
    // Paired by index and *then* thinned, never the other way round: a slot
    // this building leaves empty drops out here, and the ones after it keep the
    // footprints they were drawn with.
    anchors: geometry.anchors
      .map((slot, index) => ({ slot, filled: filling.anchors[index] }))
      .filter((pair): pair is { slot: typeof pair.slot; filled: NonNullable<typeof pair.filled> } => pair.filled !== null)
      .map(({ slot, filled }) => ({ ...slot, ...filled })),
    groups: geometry.groups.map((group, groupIndex) => ({
      ...group,
      parts: group.parts.map((slot, index) => ({
        ...slot, assetId: filling.groups[groupIndex][index],
      })),
    })),
  };
}

/**
 * The candidates the palette prefers, or all of them.
 *
 * The ladder is walked in order and the **first** tag anything carries wins, so
 * a room whose palette is `['weapons', 'dungeon', 'stone']` takes the armoury
 * piece when there is one and never weighs it against a merely stone one. An
 * empty answer at every rung hands back the whole list: this orders, it does
 * not filter.
 */
function preferred(candidates: AssetDef[], assetTags: string[]): AssetDef[] {
  for (const tag of assetTags) {
    const carrying = candidates.filter((def) => def.tags.includes(tag));
    if (carrying.length > 0) {
      return carrying;
    }
  }
  return candidates;
}

/**
 * An asset's own name, without the kind it is filed under.
 *
 * The profiles name the *name* and the layer supplies the kind, through
 * `assetIdFor`, so that a shelf declared as an anchor can never be emitted
 * under a group id. The library is indexed by the whole id, so a variant that
 * came back from a query has to be cut back down to the half the profile
 * speaks in.
 */
function assetNameOf(def: AssetDef): string {
  return def.id.slice(def.id.lastIndexOf('/') + 1);
}

/**
 * `profile` with a variant drawn for every concept it names.
 *
 * This is the one place in the generator that reads the asset library, and it
 * runs before stage one so that the three stages stay pure functions of a
 * profile that already knows what it holds.
 *
 * @throws {Error} if the library has nothing carrying a slot's concept at that
 *                 slot's footprint.
 *
 * The guard is worded for the slot on purpose, and it is not redundant with
 * what `Rng` does. `createRng`'s `pick` refuses an empty array on its own, but
 * it says `pick() needs a non-empty array` from two frames deeper and names
 * neither the concept nor the room — and `Rng` is an interface: the
 * generator's own test fixtures index the array instead, so `pick([])` there is
 * `undefined` with no throw at all. That becomes the id `anchor/undefined`, a
 * prop the renderer cannot draw, on a scene `validateScene` passes in full.
 *
 * The footprint is part of the question rather than a filter applied after,
 * because a slot's footprint is structural: placement is computed from it, and
 * a 3x1 shelf standing in a 4x1 slot is a hole in the wall. It is also what
 * keeps `hearth` meaning two different pieces in a hall and in a guest room.
 */
export function resolveAssets(profile: PlaceProfile, library: AssetLibrary, rng: Rng): ResolvedProfile {
  const anchors = profile.anchors.map((spec) => {
    const candidates = library
      .query([spec.concept], 'anchor')
      .filter((def) => def.footprint.w === spec.footprint.w && def.footprint.h === spec.footprint.h);
    if (candidates.length === 0) {
      throw new Error(
        `no anchor for concept '${spec.concept}' at ${String(spec.footprint.w)}x${String(spec.footprint.h)}`,
      );
    }
    return { ...spec, assetId: assetNameOf(rng.pick(preferred(candidates, profile.assetTags))) };
  });

  // Rung by rung, and a piece keeps the weight of the **first** rung it stood
  // on. Summing the rungs instead would make a mug heavier for also being
  // clutter, which is the opposite of what a ladder says; taking the last
  // would make the general rung overrule the particular one.
  //
  // **Inert as the seven ladders stand, and known to be.** Once the catalogue
  // grew a word for what each piece *is*, every rung in every room came out
  // disjoint from every other in that room, so all three readings build the
  // same seven pools today — measured, not assumed. Kept because it is the
  // rule that makes a ladder a ladder rather than a set with numbers on it,
  // and because the next piece added to the catalogue is the one that will
  // stand on two rungs: a jug is crockery and clutter both, and which of those
  // two a taproom weighs it by is this line. `profiles.test.ts` exercises it
  // on a ladder written for the purpose rather than on a room's, so that
  // tuning a floor cannot quietly leave the rule uncovered.
  const scatter: ScatterSpec[] = [];
  const onTheFloor = new Set<string>();
  for (const rung of profile.scatterLadder) {
    for (const def of library.query(rung.tags, 'scatter')) {
      const assetId = assetNameOf(def);
      if (onTheFloor.has(assetId)) {
        continue;
      }
      onTheFloor.add(assetId);
      scatter.push({ assetId, weight: rung.weight });
    }
  }

  return { ...profile, anchors, scatter };
}


/**
 * `size` held inside the profile's bounds.
 *
 * The resolver derives the size, but the generator's own geometry — a wall
 * ring, a door set back from the corners, an anchor with room behind it —
 * only holds above a floor, so the bound is enforced here too rather than
 * trusted.
 */
export function clampSize(size: Size, profile: PlaceProfile): Size {
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, Math.round(value)));
  return {
    w: clamp(size.w, profile.minSize.w, profile.maxSize.w),
    h: clamp(size.h, profile.minSize.h, profile.maxSize.h),
  };
}

/** `doorCount` held inside the profile's bounds, and never below one. */
export function clampDoorCount(doorCount: number, profile: PlaceProfile): number {
  const wanted = Number.isFinite(doorCount) ? Math.round(doorCount) : profile.doorRange.min;
  return Math.min(profile.doorRange.max, Math.max(Math.max(1, profile.doorRange.min), wanted));
}

/** The wall material bordering a zone paved in `floorMaterial`. */
export function wallMaterialFor(floorMaterial: string, profile: PlaceProfile): string {
  return profile.wallMaterials[floorMaterial] ?? profile.defaultWallMaterial;
}
