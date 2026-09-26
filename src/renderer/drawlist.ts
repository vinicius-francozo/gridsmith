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
 * executed: floors, then every shadow, then props by layer, then the grid.
 */

import { cellAt, sizeToPixels } from '../core/grid';
import { PIXELS_PER_CELL } from '../core/types';
import type { Cell, PlacedProp, Rotation, Scene, Size, TileRef } from '../core/types';
import { tileAssetId } from '../assets/contract';
import type { PixelRect, PixelSize } from '../assets/contract';
import { materialColor } from '../assets/palette';
import { cellRect, footprintInBounds, propRect } from './geometry';
import { sceneShadows } from './shadow';

/**
 * Fill one cell with a material.
 *
 * `color` is what the cell becomes on its own. `assetId` names the tile art
 * for that material and variant: when the supplied library has it, the
 * executor composites it over the fill, and when it does not — which is the
 * case for the marking library, which cannot know the generator's material
 * vocabulary — the flat colour stands. A map of flat coloured cells is still
 * a readable map; it is what the engine is meant to look like before any art
 * exists.
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

/** Rule the grid over the finished image, so it can be aligned on a tabletop. */
export type GridCommand = {
  kind: 'grid';
  size: PixelSize;
  spacing: number;
  color: string;
  lineWidth: number;
};

export type DrawCommand = FillCommand | AssetCommand | ShadeCommand | GridCommand;

/** A complete picture: the canvas it needs, and what to draw on it. */
export type DrawList = {
  /** Exactly `Floorplan.size` times `PIXELS_PER_CELL` on both axes. */
  size: PixelSize;
  /** In execution order, which is also z-order: earlier commands are behind. */
  commands: DrawCommand[];
};

/** Faint enough to align by and not to read as ink on the map. */
export const GRID_LINE_COLOR = 'rgba(16, 18, 22, 0.28)';

/** One device pixel: any thicker and the lines eat into a 70px cell. */
export const GRID_LINE_WIDTH = 1;

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
 * Turns a scene into the list of commands that draws it.
 *
 * @throws {RangeError} if the plan size is not positive whole cells, if
 *                      `scene.tiles` does not cover every cell, or if a prop
 *                      falls outside the map. All three are generator bugs
 *                      that would otherwise render as a plausible-looking but
 *                      wrong image.
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

  for (const prop of scene.props) {
    if (!footprintInBounds(prop.cell, prop.footprint, planSize)) {
      throw new RangeError(
        `prop ${prop.assetId} at (${prop.cell.x}, ${prop.cell.y}) covering ` +
          `${prop.footprint.w}x${prop.footprint.h} falls outside the ` +
          `${planSize.w}x${planSize.h} map`,
      );
    }
  }

  // 2. Every shadow, before any prop, so no prop is darkened by a neighbour's.
  for (const shadow of sceneShadows(scene.props, scene.lights)) {
    commands.push({
      kind: 'shade',
      rect: shadow.rect,
      color: shadow.color,
      alpha: shadow.alpha,
    });
  }

  // 3. The props, bottom layer first, keeping the generator's order inside a
  //    layer so that the same scene always produces the same image.
  for (const layer of LAYER_ORDER) {
    for (const prop of scene.props) {
      if (prop.layer === layer) {
        commands.push(assetCommand(prop));
      }
    }
  }

  // 4. The grid, over everything: it is an alignment aid for the tabletop,
  //    not part of the scene.
  commands.push({
    kind: 'grid',
    size,
    spacing: PIXELS_PER_CELL,
    color: GRID_LINE_COLOR,
    lineWidth: GRID_LINE_WIDTH,
  });

  return { size, commands };
}
