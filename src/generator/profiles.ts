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
 * Five of the seven name an anchor, through `AnchorSpec.feature`. Two of them
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
 * Five carry a feature and four do not, and the four are not an omission. A
 * featureless anchor cannot appear in `Params.excluded`, so it is the piece of
 * a room no description can take away — the sarcophagus in a crypt, the weapon
 * rack in a dungeon hall. Which slots are featureless is the *building's*
 * business and is declared on the filling; this table says which words *may*
 * ask, so that a slot cannot claim to be asked for by a word that names
 * something else.
 */
export const CONCEPTS = {
  bar: { feature: 'bar' },
  bed: {},
  bunks: { feature: 'bunks' },
  hearth: { feature: 'hearth' },
  shelving: { feature: 'shelving' },
  stairs: { feature: 'stairs' },
  storage: {},
  tomb: {},
  weapons: {},
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
  anchors: Pick<AnchorSpec, 'concept' | 'feature' | 'light'>[];
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
          { concept: 'bed' },
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
          { concept: 'weapons' },
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
          { concept: 'bed' },
          { concept: 'bunks', feature: 'bunks' },
          { concept: 'storage' },
          { concept: 'shelving', feature: 'shelving' },
          { concept: 'hearth', light: { radiusCells: 4, colorHex: '#ffb46b' } },
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
          // **No feature word, and that is the net.** `anchorOrder` refuses an
          // anchor whose feature is in `excluded`, and a featureless anchor can
          // never be in `excluded`, so this is the one piece of the room that no
          // description can take away — the same job `weapon_rack` does in the
          // dungeon hall. It is also what actually carried the map this front
          // exists for: that description excluded `hearth` along with `stairs`,
          // so the brazier never entered the draw and the crypt came back as a
          // sarcophagus and a bone niche.
          { concept: 'tomb' },
          { concept: 'shelving', feature: 'shelving' },
          // The only light this room has, and it is worth saying that the room
          // usually has none: a crypt described the archetypal way is described
          // as dark, `hearth` is read as refused, and the brazier is dropped —
          // so `Scene.lights` comes back empty. That is the honest reading of
          // the sentence and not a fault; the v1 renderer draws no light anyway.
          { concept: 'hearth', feature: 'hearth', light: { radiusCells: 3, colorHex: '#ffb46b' } },
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
      filling.anchors.some((slot) => !slot.concept) || filling.groups.some((group) => group.some((id) => !id))) {
    throw new Error(`invalid slot filling for '${place.building}_${place.room}'`);
  }
  // A slot may be asked for by the word that names its concept, or by no word
  // at all. Any other pairing is a request that would be answered by the wrong
  // piece of furniture: `anchorOrder` puts a requested anchor first and drops an
  // excluded one by this word alone, so a `bunks` slot claiming `hearth` would
  // make "sem lareira" take the beds out of the room. Nothing else checks it —
  // `feature` is the building's to declare and `CONCEPTS` is the project's.
  for (const slot of filling.anchors) {
    if (slot.feature !== undefined && slot.feature !== featureOf(slot.concept)) {
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
    anchors: geometry.anchors.map((slot, index) => ({ ...slot, ...filling.anchors[index] })),
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
