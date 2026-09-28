/**
 * Shadows, cast by the engine from the map's own lights.
 *
 * Assets carry **no baked shadow**. This is a design decision, not a
 * simplification: a library assembled from several sources — bought, drawn,
 * generated — arrives with each piece lit from whatever direction its author
 * chose, and once those are composited on one floor the map reads as a
 * collage. Dropping every baked shadow and casting them all from
 * `Scene.lights` is what makes props of different origins agree.
 *
 * The model is deliberately cheap: each prop takes a single offset copy of its
 * own footprint, thrown away from the light that reaches it most strongly,
 * and cut back to the floor it is supposed to be lying on. There is no
 * occlusion, no soft edge and no light colour here. This is a grounding cue —
 * it tells the eye that a prop sits *on* the floor rather than floating over
 * it — and the v1 map explicitly does not model vision or dynamic lighting.
 *
 * The whole module is pure and measured in cells until the last step, so it is
 * testable without a canvas.
 */

import { cellAt, inBounds } from '../core/grid';
import type { Cell, Floorplan, LightSource, PlacedProp } from '../core/types';
import type { PixelRect } from '../assets/contract';
import { PIXELS_PER_CELL } from '../core/types';
import { footprintCenter, offsetRect, propRect } from './geometry';

/** Shadows darken; they never tint. A light's colour belongs to the light. */
export const SHADOW_COLOR = '#000000';

/** Alpha of a shadow cast by a prop standing right next to its light. */
const MAX_SHADOW_ALPHA = 0.38;

/** How far a shadow is thrown, in cells, at the very edge of a light's reach. */
const MAX_THROW_CELLS = 0.45;

/** How far a shadow is thrown when the prop is right on top of the light. */
const MIN_THROW_CELLS = 0.12;

/** A darkened rectangle, ready to hand to the draw list. */
export type Shadow = {
  /** The prop that casts it, so a reader of the list can trace it back. */
  assetId: string;
  rect: PixelRect;
  color: string;
  alpha: number;
};

/**
 * How strongly `light` reaches a point, as a number in `(0, 1]`, or `0` when
 * it does not reach at all.
 *
 * Linear falloff rather than inverse-square: this drives an artistic cue, not
 * a photometric simulation, and inverse-square collapses to nothing two cells
 * out, which would leave most of a tavern's props ungrounded.
 *
 * @throws {RangeError} if the light's radius is negative or not finite.
 */
export function lightInfluence(light: LightSource, at: { x: number; y: number }): number {
  if (!Number.isFinite(light.radiusCells) || light.radiusCells < 0) {
    throw new RangeError(
      `light radius must be a finite, non-negative number of cells, got ${light.radiusCells}`,
    );
  }
  if (light.radiusCells === 0) {
    return 0;
  }
  const source = footprintCenter(light.cell);
  const distance = Math.hypot(at.x - source.x, at.y - source.y);
  return distance >= light.radiusCells ? 0 : 1 - distance / light.radiusCells;
}

/**
 * The shadow `prop` casts, or `undefined` when it casts none.
 *
 * The rectangle is the raw cast: it is thrown from the light and stops
 * nowhere, so it may well lie over wall or off the map. Cutting it back to
 * the floor is `clipToFloor`, and `sceneShadows` is the two together — which
 * is what a renderer wants.
 *
 * Three cases produce no shadow, each for its own reason:
 *
 * - **Scatter.** Tankards, straw and shards lie flat on the floor. A shadow
 *   says "this has height"; giving one to every shard would say it of a
 *   hundred things at once and turn a lit room into gravel.
 * - **No light reaches it.** A prop in the dark has nothing to cast by.
 * - **A light is exactly under its centre.** There is no direction to throw
 *   towards, and any choice would be arbitrary.
 *
 * @throws {RangeError} if a light has an invalid radius, or the prop is not on
 *                      whole cells.
 */
export function propShadow(prop: PlacedProp, lights: readonly LightSource[]): Shadow | undefined {
  if (prop.layer === 'scatter') {
    return undefined;
  }

  const center = footprintCenter(prop.cell, prop.footprint);

  let strongest: LightSource | undefined;
  let influence = 0;
  for (const light of lights) {
    const reach = lightInfluence(light, center);
    if (reach > influence) {
      strongest = light;
      influence = reach;
    }
  }
  if (strongest === undefined) {
    return undefined;
  }

  const source = footprintCenter(strongest.cell);
  const dx = center.x - source.x;
  const dy = center.y - source.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return undefined;
  }

  // Near the light the shadow is short and dark; at the edge of its reach it
  // is long and faint. That is the direction real shadows run, and it keeps
  // the throw bounded so a shadow never detaches from the prop that casts it.
  const throwCells = MIN_THROW_CELLS + (MAX_THROW_CELLS - MIN_THROW_CELLS) * (1 - influence);
  const scale = (throwCells / distance) * PIXELS_PER_CELL;

  return {
    assetId: prop.assetId,
    rect: offsetRect(propRect(prop), dx * scale, dy * scale),
    color: SHADOW_COLOR,
    alpha: MAX_SHADOW_ALPHA * influence,
  };
}

/** Whether `cell` is a floor square of `plan` — the only ground a shadow has. */
function isFloor(plan: Floorplan, cell: Cell): boolean {
  return inBounds(cell, plan.size) && cellAt(plan.cells, cell) === 'floor';
}

/**
 * The range of cells a rectangle touches, as inclusive first and last indexes.
 *
 * The far edge is `ceil - 1` rather than the cell containing the last pixel:
 * a shadow thrown due east has a right edge that can land exactly on a cell
 * boundary, and `floor` of it would claim the untouched cell beyond.
 */
function cellSpan(rect: PixelRect): { left: number; right: number; top: number; bottom: number } {
  return {
    left: Math.floor(rect.x / PIXELS_PER_CELL),
    right: Math.ceil((rect.x + rect.w) / PIXELS_PER_CELL) - 1,
    top: Math.floor(rect.y / PIXELS_PER_CELL),
    bottom: Math.ceil((rect.y + rect.h) / PIXELS_PER_CELL) - 1,
  };
}

/** `rect` cut back to cells `x0` through `x1` of row `y`. */
function cutToCells(rect: PixelRect, x0: number, x1: number, y: number): PixelRect {
  const x = Math.max(rect.x, x0 * PIXELS_PER_CELL);
  const top = Math.max(rect.y, y * PIXELS_PER_CELL);
  return {
    x,
    y: top,
    w: Math.min(rect.x + rect.w, (x1 + 1) * PIXELS_PER_CELL) - x,
    h: Math.min(rect.y + rect.h, (y + 1) * PIXELS_PER_CELL) - top,
  };
}

/**
 * The parts of `shadow` that land on floor, as zero or more rectangles.
 *
 * Nothing in the cast itself stops a shadow at the edge of the room, and the
 * props that cast are exactly the ones standing where that matters: an anchor
 * is placed with its back to a wall by rule (`generator/props.ts`), so a
 * hearth lit from inside the room throws its shadow straight onto the wall
 * band, and one on the top row throws it off the image altogether. A shadow
 * is a grounding cue and there is no ground on a wall, in the void, or past
 * the map's edge.
 *
 * Floor is a region of whole cells and not a rectangle, so a cut shadow can
 * come back as several — a run of floor per row of the span. The runs are
 * merged along the row, and a shadow that was already wholly on floor is
 * returned untouched, so the usual map's draw list is exactly what it was
 * before the cut existed.
 *
 * Returns an empty array when no part of the shadow is on floor, which is
 * what a prop standing on wall or void would produce.
 *
 * @throws {RangeError} if `floorplan.cells` does not cover its own `size`.
 */
export function clipToFloor(shadow: Shadow, floorplan: Floorplan): Shadow[] {
  const { left, right, top, bottom } = cellSpan(shadow.rect);

  let whollyOnFloor = true;
  for (let y = top; y <= bottom && whollyOnFloor; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (!isFloor(floorplan, { x, y })) {
        whollyOnFloor = false;
        break;
      }
    }
  }
  if (whollyOnFloor) {
    return [shadow];
  }

  const parts: Shadow[] = [];
  for (let y = top; y <= bottom; y += 1) {
    let runStart: number | undefined;
    // One column past the end, so a run reaching the far edge is closed too.
    for (let x = left; x <= right + 1; x += 1) {
      const onFloor = x <= right && isFloor(floorplan, { x, y });
      if (onFloor && runStart === undefined) {
        runStart = x;
      } else if (!onFloor && runStart !== undefined) {
        parts.push({ ...shadow, rect: cutToCells(shadow.rect, runStart, x - 1, y) });
        runStart = undefined;
      }
    }
  }
  return parts;
}

/**
 * Every shadow on the map, cut to the floor, in the order the props were
 * given.
 *
 * They are returned as one batch on purpose: the draw list lays all of them
 * down before any prop, so no prop is ever darkened by its neighbour's
 * shadow. Interleaving them per prop would have a stool's shadow fall across
 * the table it stands beside.
 *
 * One prop may contribute more than one rectangle, or none: the cut is what
 * decides, and every piece still names the prop it came from.
 */
export function sceneShadows(
  props: readonly PlacedProp[],
  lights: readonly LightSource[],
  floorplan: Floorplan,
): Shadow[] {
  const shadows: Shadow[] = [];
  for (const prop of props) {
    const shadow = propShadow(prop, lights);
    if (shadow !== undefined) {
      shadows.push(...clipToFloor(shadow, floorplan));
    }
  }
  return shadows;
}
