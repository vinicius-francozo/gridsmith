/**
 * Stage two — materials.
 *
 * Material is chosen per *region*, never per cell: a per-cell draw produces a
 * speckle of plank and flagstone that reads as static rather than as a floor.
 * The room is first segmented into zones — the grammar's own rectangles, split
 * once more when a zone is large enough to carry two materials — each zone is
 * given a material, and only then does each cell draw a variant and a
 * rotation of that one material.
 *
 * `Scene.tiles` is total: every cell of the grid gets a `TileRef`, wall and
 * void included. A void cell takes the void material; a wall cell takes the
 * wall material of the zone it borders.
 */

import { cellAt, setCellAt } from '../core/grid';
import type { Cell, CellKind, Floorplan, Rng, Size, TileRef, Zone } from '../core/types';
import { materialDef, pickRotation, VOID_MATERIAL, wallMaterialFor } from './profiles';
import type { PlaceProfile } from './profiles';
import { rectArea, rectContains } from './shapes';
import type { Rect } from './shapes';

/** Below this a zone is too small to be worth splitting in two. */
const MIN_AREA_TO_SPLIT = 40;

/**
 * How many zones the segmentation will cut a room into.
 *
 * It bounds the *cutting*, not the input: a region handed in is never
 * dropped, because its cells would then belong to no zone at all and would
 * be painted as if they were part of a zone somewhere else entirely.
 */
const MAX_ZONES = 4;

/** The eight offsets around a cell, nearest four first. */
const AROUND: readonly Cell[] = [
  { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
  { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 },
];

export type PaintedTiles = {
  /** Disjoint by construction: every floor cell belongs to exactly one zone. */
  zones: Zone[];
  tiles: TileRef[][];
};

/** A grid of `size`, every cell filled — never a sparse array. */
function filledGrid<T>(size: Size, value: T): T[][] {
  return Array.from({ length: size.h }, () => new Array<T>(size.w).fill(value));
}

/**
 * Cuts `rect` in two across its longer axis, at a seam somewhere in its
 * middle third so neither half comes out as a sliver.
 */
function split(rect: Rect, rng: Rng): Rect[] {
  const horizontal = rect.w >= rect.h;
  const span = horizontal ? rect.w : rect.h;
  const at = rng.int(Math.floor(span / 3), Math.ceil((span * 2) / 3));
  if (at < 1 || at >= span) {
    return [rect];
  }
  return horizontal
    ? [
        { x: rect.x, y: rect.y, w: at, h: rect.h },
        { x: rect.x + at, y: rect.y, w: rect.w - at, h: rect.h },
      ]
    : [
        { x: rect.x, y: rect.y, w: rect.w, h: at },
        { x: rect.x, y: rect.y + at, w: rect.w, h: rect.h - at },
      ];
}

/**
 * The regions a room's material zones are cut from.
 *
 * The grammar's rectangles are already the room's natural seams — the stem of
 * a T, the nook of an alcove — so they are the starting point. A plain
 * rectangle has only one, which would leave a profile with two floor
 * materials using one of them, so a large region is cut once more.
 *
 * Regions are only ever added to, never removed: see `MAX_ZONES`.
 */
export function segmentZones(regions: Rect[], profile: PlaceProfile, rng: Rng): Rect[] {
  if (profile.floorMaterials.length < 2) {
    return regions;
  }
  const cut: Rect[] = [];
  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    // What the total would be if this region were split, counting the
    // regions still waiting behind it.
    const afterSplit = cut.length + 2 + (regions.length - i - 1);
    if (afterSplit <= MAX_ZONES && rectArea(region) >= MIN_AREA_TO_SPLIT) {
      cut.push(...split(region, rng));
    } else {
      cut.push(region);
    }
  }
  return cut;
}

/**
 * A material for each zone, avoiding a repeat of the one before it when the
 * profile offers an alternative. Neighbouring zones in the same material
 * would erase the seam the segmentation just drew.
 */
function assignMaterials(count: number, profile: PlaceProfile, rng: Rng): string[] {
  const chosen: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const previous = chosen[i - 1];
    const options = profile.floorMaterials.filter((material) => material !== previous);
    chosen.push(rng.pick(options.length > 0 ? options : profile.floorMaterials));
  }
  return chosen;
}

/** A tile of `material`, with its variant and rotation drawn from `rng`. */
function tileOf(material: string, rng: Rng): TileRef {
  const def = materialDef(material);
  return {
    material,
    variant: rng.int(0, def.variants - 1),
    rotation: def.rotatable ? pickRotation(rng) : 0,
  };
}

/**
 * Paints the whole grid.
 *
 * Cells are visited in reading order, so the sequence drawn from `rng` — and
 * therefore the map — is the same on every run with the same seed.
 */
export function paintMaterials(
  floorplan: Floorplan,
  regions: Rect[],
  profile: PlaceProfile,
  rng: Rng,
): PaintedTiles {
  const { size, cells } = floorplan;
  const areas = segmentZones(regions, profile, rng);
  const materials = assignMaterials(areas.length, profile, rng);

  // Every floor cell is claimed by the *first* area that contains it, so the
  // zones partition the floor even if two areas were to overlap.
  const zoneOf = filledGrid(size, -1);
  const zones: Zone[] = materials.map((material) => ({ material, cells: [] }));
  for (let y = 0; y < size.h; y += 1) {
    for (let x = 0; x < size.w; x += 1) {
      const cell = { x, y };
      if (cellAt(cells, cell) !== 'floor') {
        continue;
      }
      const index = areas.findIndex((area) => rectContains(area, x, y));
      const claimed = index === -1 ? 0 : index;
      setCellAt(zoneOf, cell, claimed);
      zones[claimed].cells.push(cell);
    }
  }

  // Filled up front, so no cell of the grid is ever a hole: `cellAt` checks
  // bounds against the row's length, and a hole reads as undefined without
  // throwing. `Scene.tiles` is total and has to be total in fact, not just
  // in the type.
  const tiles = filledGrid<TileRef>(size, { material: VOID_MATERIAL, variant: 0, rotation: 0 });
  for (let y = 0; y < size.h; y += 1) {
    for (let x = 0; x < size.w; x += 1) {
      const cell = { x, y };
      const kind: CellKind = cellAt(cells, cell);
      if (kind === 'void') {
        // A fresh tile rather than the shared fill, so no consumer can edit
        // one void cell and change every other one.
        setCellAt(tiles, cell, { material: VOID_MATERIAL, variant: 0, rotation: 0 });
        continue;
      }
      const material =
        kind === 'floor'
          ? zones[cellAt(zoneOf, cell)].material
          : wallMaterialFor(borderingMaterial(zoneOf, zones, size, cell), profile);
      setCellAt(tiles, cell, tileOf(material, rng));
    }
  }

  return { zones, tiles };
}

/**
 * The floor material of the zone a wall cell borders.
 *
 * Neighbours are checked orthogonally first, so a wall between two zones
 * takes the material of the zone it actually faces rather than of one it only
 * touches at a corner. A wall with no floor neighbour cannot occur — walls
 * are derived from floor — but the fallback keeps the function total.
 */
function borderingMaterial(zoneOf: number[][], zones: Zone[], size: Size, cell: Cell): string {
  for (const offset of AROUND) {
    const neighbor = { x: cell.x + offset.x, y: cell.y + offset.y };
    if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= size.w || neighbor.y >= size.h) {
      continue;
    }
    const index = cellAt(zoneOf, neighbor);
    if (index >= 0) {
      return zones[index].material;
    }
  }
  return zones[0].material;
}
