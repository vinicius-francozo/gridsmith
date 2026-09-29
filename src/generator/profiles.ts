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

import type { Building, Cell, Place, PlacedProp, RoomKind, Rotation, Size } from '../core/types';
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
  // The two pillar materials — see `PlaceProfile.pillarMaterial` for why they
  // are named the way they are. One variant each, and not rotatable: the
  // variant ladder exists so that a floor of two hundred cells does not read
  // as one flat sheet, and a room has four pillars. Declaring one variant
  // also keeps the draw count per cell exactly what a wall cell already cost,
  // so painting a pillar differently does not move the rng sequence and no
  // map that reproduced before this change stops reproducing.
  stone_column: { variants: 1, rotatable: false },
  timber_column: { variants: 1, rotatable: false },
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
  /**
   * The material a free-standing pillar is painted in.
   *
   * Pillars were being drawn already and nobody could see them: stage one
   * grows them as cells, `deriveWalls` makes them `'wall'`, and stage two then
   * gave them the wall material of the zone they border — the perimeter's own
   * colour, exactly. So a pillar needs a material of its own, and it needs one
   * that reads as different.
   *
   * The colour is not authored anywhere. `materialColor` derives it from the
   * name by FNV-1a (`assets/palette.ts`), so the **name is the only lever**,
   * and these two were chosen by measuring rather than by taste. In sRGB
   * channel distance the worst separation between two different materials
   * already in the vocabulary is 13.7 — `dirt_floor` variant 0 against
   * `plaster_wall` variant 1 — and at that distance two materials are one
   * colour on the map. The obvious names land there: `stone_pillar` measures
   * 16.6 and `timber_pillar` 12.9 against their nearest neighbour, which is
   * the defect this field exists to fix, wearing a new name. `stone_column`
   * measures 35.3 and `timber_column` 31.5 against the whole vocabulary, and
   * 55.1 and 55.6 against the wall material each one actually stands beside.
   * `placeholder.test.ts` holds the floor at 30.
   */
  pillarMaterial: string;
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
  place: { building: 'tavern', room: 'hall' },
  minSize: { w: 12, h: 10 },
  maxSize: { w: 20, h: 18 },
  doorRange: { min: 1, max: 3 },
  shapes: ['rectangle', 'l_shape', 't_shape', 'alcove'],
  allowPillars: true,
  floorMaterials: ['wood_plank', 'flagstone'],
  wallMaterials: { wood_plank: 'timber_wall', flagstone: 'stone_wall' },
  defaultWallMaterial: 'stone_wall',
  pillarMaterial: 'timber_column',
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
  place: { building: 'tavern', room: 'room' },
  minSize: { w: 6, h: 6 },
  maxSize: { w: 11, h: 10 },
  doorRange: { min: 1, max: 2 },
  shapes: ['rectangle', 'alcove'],
  allowPillars: false,
  floorMaterials: ['wood_plank'],
  wallMaterials: { wood_plank: 'plaster_wall' },
  defaultWallMaterial: 'plaster_wall',
  pillarMaterial: 'timber_column',
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
  place: { building: 'tavern', room: 'storeroom' },
  minSize: { w: 8, h: 6 },
  maxSize: { w: 14, h: 12 },
  doorRange: { min: 1, max: 2 },
  shapes: ['rectangle', 'l_shape'],
  allowPillars: false,
  floorMaterials: ['stone_floor', 'dirt_floor'],
  wallMaterials: { stone_floor: 'stone_wall', dirt_floor: 'stone_wall' },
  defaultWallMaterial: 'stone_wall',
  pillarMaterial: 'timber_column',
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

type RoomGeometry = Pick<PlaceProfile,
  'minSize' | 'maxSize' | 'doorRange' | 'shapes' | 'allowPillars' |
  'anchorRange' | 'groupsPerHundredCells' | 'scatterChance'> & {
    anchors: Pick<AnchorSpec, 'footprint' | 'placement'>[];
    groups: (Omit<GroupSpec, 'parts'> & { parts: Omit<GroupPart, 'assetId'>[] })[];
    scatter: Pick<ScatterSpec, 'weight'>[];
  };

type SlotFilling = Pick<PlaceProfile,
  'floorMaterials' | 'wallMaterials' | 'defaultWallMaterial' | 'pillarMaterial'> & {
  anchors: Pick<AnchorSpec, 'assetId' | 'feature' | 'light'>[];
  groups: string[][];
  scatter: string[];
};

type BuildingPalette = {
  rooms: Partial<Record<RoomKind, SlotFilling>>;
};

function geometryOf(profile: PlaceProfile): RoomGeometry {
  return {
    minSize: profile.minSize, maxSize: profile.maxSize, doorRange: profile.doorRange,
    shapes: profile.shapes, allowPillars: profile.allowPillars,
    anchorRange: profile.anchorRange,
    anchors: profile.anchors.map(({ footprint, placement }) => ({ footprint, placement })),
    groupsPerHundredCells: profile.groupsPerHundredCells,
    groups: profile.groups.map(({ parts, ...group }) => ({
      ...group, parts: parts.map(({ assetId: _assetId, ...slot }) => slot),
    })),
    scatterChance: profile.scatterChance,
    scatter: profile.scatter.map(({ assetId: _assetId, ...slot }) => slot),
  };
}

function fillingOf(profile: PlaceProfile): SlotFilling {
  return {
    floorMaterials: profile.floorMaterials,
    wallMaterials: profile.wallMaterials,
    defaultWallMaterial: profile.defaultWallMaterial,
    pillarMaterial: profile.pillarMaterial,
    anchors: profile.anchors.map(({ assetId, feature, light }) => ({ assetId, feature, light })),
    groups: profile.groups.map((group) => group.parts.map((slot) => slot.assetId)),
    scatter: profile.scatter.map((slot) => slot.assetId),
  };
}

// The three geometries are shared by every building; only the slot fillings
// and material palette differ. These legacy values preserve tavern prop order.
export const ROOM_KINDS: Record<RoomKind, RoomGeometry> = {
  hall: geometryOf(TAVERN_HALL),
  room: geometryOf(TAVERN_ROOM),
  storeroom: geometryOf(TAVERN_STOREROOM),
};

export const BUILDINGS: Record<Building, BuildingPalette> = {
  tavern: {
    rooms: {
      hall: fillingOf(TAVERN_HALL),
      room: fillingOf(TAVERN_ROOM),
      storeroom: fillingOf(TAVERN_STOREROOM),
    },
  },
  dungeon: {
    rooms: {
      hall: {
        floorMaterials: ['flagstone', 'stone_floor'],
        wallMaterials: { flagstone: 'stone_wall', stone_floor: 'stone_wall' },
        defaultWallMaterial: 'stone_wall',
        pillarMaterial: 'stone_column',
        anchors: [
          { assetId: 'weapon_rack' },
          { assetId: 'stone_hearth', feature: 'hearth', light: { radiusCells: 6, colorHex: '#ffb46b' } },
          { assetId: 'stone_stairs', feature: 'stairs' },
        ],
        groups: [
          ['war_table', 'guard_stool', 'guard_stool', 'guard_stool', 'guard_stool'],
          ['stone_bench', 'war_table_long', 'stone_bench'],
        ],
        scatter: ['bone', 'broken_chain', 'rubble', 'dust'],
      },
      room: {
        floorMaterials: ['flagstone', 'stone_floor'],
        wallMaterials: { flagstone: 'stone_wall', stone_floor: 'stone_wall' },
        defaultWallMaterial: 'stone_wall',
        pillarMaterial: 'stone_column',
        anchors: [
          { assetId: 'cot' },
          { assetId: 'iron_bunks', feature: 'bunks' },
          { assetId: 'lockers' },
          { assetId: 'wall_rack', feature: 'shelving' },
          { assetId: 'wall_torch', light: { radiusCells: 4, colorHex: '#ffb46b' } },
        ],
        groups: [['prison_desk', 'guard_stool']],
        scatter: ['bone', 'broken_chain', 'dust'],
      },
      storeroom: {
        floorMaterials: ['flagstone', 'stone_floor'],
        wallMaterials: { flagstone: 'stone_wall', stone_floor: 'stone_wall' },
        defaultWallMaterial: 'stone_wall',
        pillarMaterial: 'stone_column',
        anchors: [{ assetId: 'armory_rack', feature: 'shelving' }, { assetId: 'stone_stairs', feature: 'stairs' }],
        groups: [['supply_crate', 'small_crate', 'weapon_bundle'], ['weapon_bundle', 'weapon_bundle']],
        scatter: ['loose_arrow', 'rubble', 'dust'],
      },
    },
  },
};

export function roomsFor(building: Building): readonly RoomKind[] {
  if (!Object.hasOwn(BUILDINGS, building)) {
    throw new Error(`unknown building '${String(building)}'`);
  }
  return (Object.keys(BUILDINGS[building].rooms) as RoomKind[]).filter(
    (room) => BUILDINGS[building].rooms[room] !== undefined,
  );
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
      !Object.hasOwn(ROOM_KINDS, place.room) ||
      !Object.hasOwn(BUILDINGS[place.building].rooms, place.room) ||
      BUILDINGS[place.building].rooms[place.room] === undefined) {
    throw new Error(`unknown place '${String(place?.building)}_${String(place?.room)}'`);
  }
  const geometry = ROOM_KINDS[place.room];
  const building = BUILDINGS[place.building];
  const filling = building.rooms[place.room]!;
  if (filling.anchors.length !== geometry.anchors.length ||
      filling.groups.length !== geometry.groups.length ||
      geometry.groups.some((group, index) => filling.groups[index].length !== group.parts.length) ||
      filling.scatter.length !== geometry.scatter.length ||
      filling.anchors.some((slot) => !slot.assetId) || filling.groups.some((group) => group.some((id) => !id)) ||
      filling.scatter.some((id) => !id)) {
    throw new Error(`invalid slot filling for '${place.building}_${place.room}'`);
  }
  return {
    place,
    ...geometry,
    floorMaterials: filling.floorMaterials,
    wallMaterials: filling.wallMaterials,
    defaultWallMaterial: filling.defaultWallMaterial,
    pillarMaterial: filling.pillarMaterial,
    anchors: geometry.anchors.map((slot, index) => ({ ...slot, ...filling.anchors[index] })),
    groups: geometry.groups.map((group, groupIndex) => ({
      ...group,
      parts: group.parts.map((slot, index) => ({
        ...slot, assetId: filling.groups[groupIndex][index],
      })),
    })),
    scatter: geometry.scatter.map((slot, index) => ({ ...slot, assetId: filling.scatter[index] })),
  };
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
