/**
 * Per-`PlaceType` profiles: everything the three generation stages need to
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

import type { Cell, PlacedProp, PlaceType, Rotation, Size } from '../core/types';
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
};

/**
 * The variation rules for `material`.
 *
 * @throws {Error} if `material` is not in `MATERIALS`.
 */
export function materialDef(material: string): MaterialDef {
  const def = MATERIALS[material];
  if (def === undefined) {
    throw new Error(`unknown material '${material}'`);
  }
  return def;
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
  assetId: string;
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

/** A layer-three prop: loose debris, drawn per cell. */
export type ScatterSpec = { assetId: string; weight: number };

// --- Profiles --------------------------------------------------------------

export type PlaceProfile = {
  placeType: PlaceType;
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
  scatter: ScatterSpec[];
};

const TAVERN_HALL: PlaceProfile = {
  placeType: 'tavern_hall',
  minSize: { w: 12, h: 10 },
  maxSize: { w: 20, h: 18 },
  doorRange: { min: 1, max: 3 },
  shapes: ['rectangle', 'l_shape', 't_shape', 'alcove'],
  allowPillars: true,
  floorMaterials: ['wood_plank', 'flagstone'],
  wallMaterials: { wood_plank: 'timber_wall', flagstone: 'stone_wall' },
  defaultWallMaterial: 'stone_wall',
  anchorRange: { min: 2, max: 3 },
  anchors: [
    { assetId: 'bar_counter', footprint: { w: 5, h: 2 }, placement: 'wall', feature: 'bar' },
    {
      assetId: 'hearth',
      footprint: { w: 3, h: 2 },
      placement: 'wall',
      feature: 'hearth',
      light: { radiusCells: 6, colorHex: '#ffb46b' },
    },
    { assetId: 'stairs_up', footprint: { w: 2, h: 3 }, placement: 'corner', feature: 'stairs' },
  ],
  groupsPerHundredCells: { min: 2, max: 5 },
  groups: [
    {
      id: 'round_table',
      size: { w: 4, h: 4 },
      parts: [
        { assetId: 'table_round', offset: { x: 1, y: 1 }, footprint: { w: 2, h: 2 } },
        { assetId: 'chair', offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
        { assetId: 'chair', offset: { x: 3, y: 1 }, footprint: { w: 1, h: 1 } },
        { assetId: 'chair', offset: { x: 2, y: 3 }, footprint: { w: 1, h: 1 } },
        { assetId: 'chair', offset: { x: 0, y: 2 }, footprint: { w: 1, h: 1 } },
      ],
    },
    {
      id: 'long_table',
      size: { w: 3, h: 3 },
      parts: [
        { assetId: 'bench', offset: { x: 0, y: 0 }, footprint: { w: 3, h: 1 } },
        { assetId: 'table_long', offset: { x: 0, y: 1 }, footprint: { w: 3, h: 1 } },
        { assetId: 'bench', offset: { x: 0, y: 2 }, footprint: { w: 3, h: 1 } },
      ],
    },
  ],
  scatterChance: 0.16,
  scatter: [
    { assetId: 'mug', weight: 4 },
    { assetId: 'stool', weight: 2 },
    { assetId: 'bottle', weight: 2 },
    { assetId: 'straw', weight: 1 },
  ],
};

const TAVERN_ROOM: PlaceProfile = {
  placeType: 'tavern_room',
  minSize: { w: 6, h: 6 },
  maxSize: { w: 11, h: 10 },
  doorRange: { min: 1, max: 2 },
  shapes: ['rectangle', 'alcove'],
  allowPillars: false,
  floorMaterials: ['wood_plank'],
  wallMaterials: { wood_plank: 'plaster_wall' },
  defaultWallMaterial: 'plaster_wall',
  anchorRange: { min: 1, max: 2 },
  anchors: [
    { assetId: 'bed', footprint: { w: 2, h: 3 }, placement: 'wall' },
    { assetId: 'bunk_beds', footprint: { w: 2, h: 3 }, placement: 'wall', feature: 'bunks' },
    { assetId: 'wardrobe', footprint: { w: 2, h: 1 }, placement: 'wall' },
    { assetId: 'shelf_row_short', footprint: { w: 3, h: 1 }, placement: 'wall', feature: 'shelving' },
    {
      assetId: 'hearth_small',
      footprint: { w: 2, h: 1 },
      placement: 'wall',
      feature: 'hearth',
      light: { radiusCells: 4, colorHex: '#ffb46b' },
    },
  ],
  groupsPerHundredCells: { min: 2, max: 6 },
  groups: [
    {
      id: 'writing_desk',
      size: { w: 2, h: 1 },
      parts: [
        { assetId: 'table_small', offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
        { assetId: 'chair', offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
      ],
    },
  ],
  scatterChance: 0.12,
  scatter: [
    { assetId: 'mug', weight: 3 },
    { assetId: 'bottle', weight: 2 },
    { assetId: 'straw', weight: 1 },
  ],
};

const TAVERN_STOREROOM: PlaceProfile = {
  placeType: 'tavern_storeroom',
  minSize: { w: 8, h: 6 },
  maxSize: { w: 14, h: 12 },
  doorRange: { min: 1, max: 2 },
  shapes: ['rectangle', 'l_shape'],
  allowPillars: false,
  floorMaterials: ['stone_floor', 'dirt_floor'],
  wallMaterials: { stone_floor: 'stone_wall', dirt_floor: 'stone_wall' },
  defaultWallMaterial: 'stone_wall',
  anchorRange: { min: 1, max: 2 },
  anchors: [
    { assetId: 'shelf_row', footprint: { w: 4, h: 1 }, placement: 'wall', feature: 'shelving' },
    { assetId: 'stairs_up', footprint: { w: 2, h: 3 }, placement: 'corner', feature: 'stairs' },
  ],
  groupsPerHundredCells: { min: 3, max: 8 },
  groups: [
    {
      id: 'crate_stack',
      size: { w: 2, h: 2 },
      parts: [
        { assetId: 'crate', offset: { x: 0, y: 0 }, footprint: { w: 2, h: 1 } },
        { assetId: 'crate_small', offset: { x: 0, y: 1 }, footprint: { w: 1, h: 1 } },
        { assetId: 'barrel', offset: { x: 1, y: 1 }, footprint: { w: 1, h: 1 } },
      ],
    },
    {
      id: 'barrel_pair',
      size: { w: 2, h: 1 },
      parts: [
        { assetId: 'barrel', offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
        { assetId: 'barrel', offset: { x: 1, y: 0 }, footprint: { w: 1, h: 1 } },
      ],
    },
  ],
  scatterChance: 0.18,
  scatter: [
    { assetId: 'sack', weight: 3 },
    { assetId: 'shard', weight: 2 },
    { assetId: 'straw', weight: 3 },
  ],
};

const PROFILES: Record<PlaceType, PlaceProfile> = {
  tavern_hall: TAVERN_HALL,
  tavern_room: TAVERN_ROOM,
  tavern_storeroom: TAVERN_STOREROOM,
};

/**
 * The profile for `placeType`.
 *
 * @throws {Error} if `placeType` is not a known place. The type system rules
 *                 this out inside the project, but `Params` may have come
 *                 through a language model and a JSON boundary.
 */
export function profileFor(placeType: PlaceType): PlaceProfile {
  const profile = PROFILES[placeType];
  if (profile === undefined) {
    throw new Error(`unknown place type '${placeType}'`);
  }
  return profile;
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
