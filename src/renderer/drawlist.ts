/**
 * The draw list: a `Scene` turned into an ordered list of drawing commands.
 *
 * The renderer is two layers, and this is the first one.
 *
 * Everything that decides *what* the picture contains — which cell gets which
 * colour, where a prop's rectangle falls, which shadow is thrown where, in
 * what order any of it is laid down — is decided here, in plain data, by pure
 * functions. The second layer (`render.ts`) walks the list and does nothing
 * but call canvas methods.
 *
 * The immediate reason for the split is that the test environment is Node,
 * where no canvas exists. The lasting reason is better: a rendering bug is
 * almost always a bug about *what* to draw, and a list of values can be
 * asserted against, diffed and read, while a painted canvas can only be
 * looked at.
 *
 * The list is also the z-order. It is built in exactly the order it must be
 * executed: floors, then doors, then every shadow, then props by layer, then
 * the grid.
 */

import { cellAt, sizeToPixels } from '../core/grid';
import { PIXELS_PER_CELL } from '../core/types';
import type { Cell, Door, Facing, PlacedProp, Rotation, Scene, Size, TileRef } from '../core/types';
import { tileAssetId } from '../assets/contract';
import type { PixelRect, PixelSize } from '../assets/contract';
import { materialColor } from '../assets/palette';
import { cellRect, footprintInBounds, propRect } from './geometry';
import { sceneShadows } from './shadow';

/**
 * Fill one cell with a material.
 *
 * `color` is what the cell becomes on its own, derived from the material *and*
 * the variant, so the four cuts of one flagstone floor read as four slightly
 * different stones rather than one flat sheet — which is also what makes the
 * generator's variant assignment visible at all.
 *
 * `assetId` names the tile art for that material and variant: when the supplied
 * library has it, the executor composites it over the fill. The marking library
 * deliberately serves **no** tile bitmap, so under it the flat colour always
 * stands. A map of flat coloured cells is still a readable map; a floor tiled
 * with labelled boxes reading "wood_plank 1x1" four hundred times is not.
 */
export type FillCommand = {
  kind: 'fill';
  rect: PixelRect;
  cell: Cell;
  material: string;
  variant: number;
  rotation: Rotation;
  color: string;
  assetId: string;
};

/** Draw an asset's bitmap into a rectangle. The bitmap arrives pre-rotated. */
export type AssetCommand = {
  kind: 'asset';
  rect: PixelRect;
  assetId: string;
  rotation: Rotation;
  layer: PlacedProp['layer'];
};

/** Darken a region. Used for shadows; carries no hue of its own. */
export type ShadeCommand = {
  kind: 'shade';
  rect: PixelRect;
  color: string;
  alpha: number;
};

/** One straight line of the grid rule, from one point to another, in pixels. */
export type PixelLine = { from: { x: number; y: number }; to: { x: number; y: number } };

/**
 * Rule the grid over the finished image, so it can be aligned on a tabletop.
 *
 * The lines arrive already measured. Where a line starts, where it stops and
 * the half-pixel it is nudged by are all *what to draw*, so they are settled
 * here with the rest of the picture and asserted against in a test; leaving
 * them to the executor put the list's one remaining geometric decision in the
 * half of the renderer that has no test environment to be checked in.
 */
export type GridCommand = {
  kind: 'grid';
  lines: PixelLine[];
  color: string;
  lineWidth: number;
};

/**
 * Mark a door cell.
 *
 * A door's cell stays `CellKind.wall` in the floorplan — the opening lives in
 * `Floorplan.doors`, it is not cut out of `cells` — so nothing else in the
 * list would distinguish it from the wall it sits in, and the map would go to
 * the table with no visible way in.
 *
 * `threshold` is a band along the outward side, since `Door.facing` points out
 * of the building; it is marking, not art, and it is what makes a door drawn
 * the wrong way round obvious.
 */
export type DoorCommand = {
  kind: 'door';
  rect: PixelRect;
  threshold: PixelRect;
  cell: Cell;
  facing: Facing;
  color: string;
  thresholdColor: string;
};

export type DrawCommand = FillCommand | AssetCommand | ShadeCommand | DoorCommand | GridCommand;

/** A complete picture: the canvas it needs, and what to draw on it. */
export type DrawList = {
  /** Exactly `Floorplan.size` times `PIXELS_PER_CELL` on both axes. */
  size: PixelSize;
  /** In execution order, which is also z-order: earlier commands are behind. */
  commands: DrawCommand[];
};

/** A door occupies exactly one cell, like every wall cell. */
const ONE_CELL: Size = { w: 1, h: 1 };

/** Faint enough to align by and not to read as ink on the map. */
export const GRID_LINE_COLOR = 'rgba(16, 18, 22, 0.28)';

/** One device pixel: any thicker and the lines eat into a 70px cell. */
export const GRID_LINE_WIDTH = 1;

/**
 * Half a pixel, added to every grid coordinate.
 *
 * A 1px line stroked on an integer coordinate is straddled by the rasteriser
 * and comes out two grey pixels wide — every cell of the map then loses a
 * pixel to a smudged rule, and the whole grid reads as soft.
 */
export const GRID_LINE_OFFSET = 0.5;

/** A door cell reads as a way in, not as more wall. */
export const DOOR_COLOR = '#b98b4e';

/** The leaf across the opening, on the side the door faces. */
export const DOOR_THRESHOLD_COLOR = '#43301b';

/** How deep that band is, in pixels: a fifth of a cell, enough to read. */
export const DOOR_THRESHOLD_PX = 14;

/**
 * Prop layers, bottom to top.
 *
 * Anchors define the room and everything sits in front of them; scatter is
 * litter on the floor and must land on top, or a tankard placed on a table
 * disappears under it.
 */
export const LAYER_ORDER: readonly PlacedProp['layer'][] = ['anchor', 'group', 'scatter'];

/**
 * Rejects a tile grid that does not cover the plan.
 *
 * `Scene.tiles` is total by contract — there is a `TileRef` for every cell,
 * walls and void included. A short grid is a generator bug, and catching it
 * here names the mismatch instead of letting the first missing row surface as
 * an out-of-bounds read halfway through the image.
 *
 * @throws {RangeError} if the grid is not `size.h` rows of `size.w` entries.
 */
function assertTotalGrid(tiles: readonly TileRef[][], size: Size): void {
  if (tiles.length !== size.h) {
    throw new RangeError(
      `scene.tiles has ${tiles.length} rows, expected ${size.h} — tiles must cover every cell`,
    );
  }
  tiles.forEach((row, y) => {
    if (row.length !== size.w) {
      throw new RangeError(
        `scene.tiles row ${y} has ${row.length} entries, expected ${size.w} — ` +
          'tiles must cover every cell',
      );
    }
  });
}

/**
 * The fill command for one cell.
 *
 * @throws {RangeError} if the tile's variant is negative or fractional, or its
 *                      material name is empty.
 */
export function fillCommand(cell: Cell, tile: TileRef): FillCommand {
  return {
    kind: 'fill',
    rect: cellRect(cell),
    cell: { x: cell.x, y: cell.y },
    material: tile.material,
    variant: tile.variant,
    rotation: tile.rotation,
    color: materialColor(tile.material, tile.variant),
    assetId: tileAssetId(tile.material, tile.variant),
  };
}

/**
 * The asset command for one placed prop.
 *
 * @throws {RangeError} if the prop is not anchored on whole cells or its
 *                      footprint is not a positive whole size.
 */
export function assetCommand(prop: PlacedProp): AssetCommand {
  return {
    kind: 'asset',
    rect: propRect(prop),
    assetId: prop.assetId,
    rotation: prop.rotation,
    layer: prop.layer,
  };
}

/**
 * Every line of the grid rule over a canvas of `size`, at `spacing` pixels.
 *
 * The outer edges carry no line: the map's border is the edge of the image,
 * and a line drawn there is half outside the canvas and reads as a frame.
 *
 * @throws {RangeError} if `spacing` is not a positive, finite number of pixels.
 */
export function gridLines(size: PixelSize, spacing: number): PixelLine[] {
  if (!Number.isFinite(spacing) || spacing <= 0) {
    throw new RangeError(`grid spacing must be a positive number of pixels, got ${spacing}`);
  }

  const lines: PixelLine[] = [];
  for (let x = spacing; x < size.w; x += spacing) {
    const at = x + GRID_LINE_OFFSET;
    lines.push({ from: { x: at, y: 0 }, to: { x: at, y: size.h } });
  }
  for (let y = spacing; y < size.h; y += spacing) {
    const at = y + GRID_LINE_OFFSET;
    lines.push({ from: { x: 0, y: at }, to: { x: size.w, y: at } });
  }
  return lines;
}

/** The band of a door cell that lies on the side the door faces. */
function thresholdRect(rect: PixelRect, facing: Facing): PixelRect {
  const depth = Math.min(DOOR_THRESHOLD_PX, rect.w, rect.h);
  switch (facing) {
    case 'n':
      return { x: rect.x, y: rect.y, w: rect.w, h: depth };
    case 's':
      return { x: rect.x, y: rect.y + rect.h - depth, w: rect.w, h: depth };
    case 'e':
      return { x: rect.x + rect.w - depth, y: rect.y, w: depth, h: rect.h };
    case 'w':
      return { x: rect.x, y: rect.y, w: depth, h: rect.h };
    default: {
      const unreachable: never = facing;
      throw new RangeError(`facing must be n, e, s or w, got ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * The door command for one door.
 *
 * `Door.facing` points **out** of the building, so the threshold band lands on
 * the outward edge of the cell.
 *
 * @throws {RangeError} if the door is not anchored on a whole cell, or its
 *                      facing is not one of the four.
 */
export function doorCommand(door: Door): DoorCommand {
  const rect = cellRect(door.cell);
  return {
    kind: 'door',
    rect,
    threshold: thresholdRect(rect, door.facing),
    cell: { x: door.cell.x, y: door.cell.y },
    facing: door.facing,
    color: DOOR_COLOR,
    thresholdColor: DOOR_THRESHOLD_COLOR,
  };
}

/**
 * Turns a scene into the list of commands that draws it.
 *
 * @throws {RangeError} if the plan size is not positive whole cells, if
 *                      `scene.tiles` does not cover every cell, or if a door
 *                      or a prop falls outside the map. All of them are
 *                      generator bugs that would otherwise render as a
 *                      plausible-looking but wrong image.
 */
export function buildDrawList(scene: Scene): DrawList {
  const planSize = scene.floorplan.size;
  const size = sizeToPixels(planSize);
  assertTotalGrid(scene.tiles, planSize);

  const commands: DrawCommand[] = [];

  // 1. The floor, walls and void: one fill per cell, row by row.
  for (let y = 0; y < planSize.h; y += 1) {
    for (let x = 0; x < planSize.w; x += 1) {
      const cell: Cell = { x, y };
      commands.push(fillCommand(cell, cellAt(scene.tiles, cell)));
    }
  }

  // 2. The doors, over the wall cells they open through and under everything
  //    else. A battlemap with no visible way in is unusable at the table.
  for (const door of scene.floorplan.doors) {
    if (!footprintInBounds(door.cell, ONE_CELL, planSize)) {
      throw new RangeError(
        `door at (${door.cell.x}, ${door.cell.y}) falls outside the ` +
          `${planSize.w}x${planSize.h} map`,
      );
    }
    commands.push(doorCommand(door));
  }

  for (const prop of scene.props) {
    if (!footprintInBounds(prop.cell, prop.footprint, planSize)) {
      throw new RangeError(
        `prop ${prop.assetId} at (${prop.cell.x}, ${prop.cell.y}) covering ` +
          `${prop.footprint.w}x${prop.footprint.h} falls outside the ` +
          `${planSize.w}x${planSize.h} map`,
      );
    }
  }

  // 3. Every shadow, before any prop, so no prop is darkened by a neighbour's.
  for (const shadow of sceneShadows(scene.props, scene.lights, scene.floorplan)) {
    commands.push({
      kind: 'shade',
      rect: shadow.rect,
      color: shadow.color,
      alpha: shadow.alpha,
    });
  }

  // 4. The props, bottom layer first, keeping the generator's order inside a
  //    layer so that the same scene always produces the same image.
  for (const layer of LAYER_ORDER) {
    for (const prop of scene.props) {
      if (prop.layer === layer) {
        commands.push(assetCommand(prop));
      }
    }
  }

  // 5. The grid, over everything: it is an alignment aid for the tabletop,
  //    not part of the scene.
  commands.push({
    kind: 'grid',
    lines: gridLines(size, PIXELS_PER_CELL),
    color: GRID_LINE_COLOR,
    lineWidth: GRID_LINE_WIDTH,
  });

  return { size, commands };
}
