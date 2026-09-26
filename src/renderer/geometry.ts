/**
 * The pixel geometry of the renderer.
 *
 * Everything outside `src/renderer/` and `src/assets/` measures in grid cells.
 * This file is where a cell becomes a rectangle, and it does nothing else: the
 * cell-to-pixel arithmetic itself lives once, in `src/core/grid.ts`, and is
 * only called from here.
 */

import { cellToPixel, inBounds, sizeToPixels } from '../core/grid';
import type { Cell, PlacedProp, Size } from '../core/types';
import type { PixelRect } from '../assets/contract';

/** A one-cell footprint, for the common case. */
const ONE_CELL: Size = { w: 1, h: 1 };

/**
 * Rejects a cell that is not a pair of whole coordinates.
 *
 * `cellToPixel` would happily multiply `2.5` or `NaN` by the grid pitch and
 * hand back a rectangle straddling two cells, which draws as a half-cell
 * seam — a misalignment that is invisible at a glance and fatal on a virtual
 * tabletop, where the whole point is that the image's grid matches the app's.
 *
 * @throws {RangeError} if either coordinate is not an integer.
 */
function assertWholeCell(cell: Cell): void {
  if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
    throw new RangeError(`cell coordinates must be integers, got (${cell.x}, ${cell.y})`);
  }
}

/**
 * The rectangle covered by `footprint` cells anchored at `cell`.
 *
 * @throws {RangeError} if `cell` is not whole, or `footprint` is not a
 *                      positive whole size.
 */
export function cellRect(cell: Cell, footprint: Size = ONE_CELL): PixelRect {
  assertWholeCell(cell);
  const origin = cellToPixel(cell);
  const size = sizeToPixels(footprint);
  return { x: origin.x, y: origin.y, w: size.w, h: size.h };
}

/**
 * The rectangle a placed prop covers.
 *
 * `PlacedProp.footprint` is the footprint **as placed**, already turned by
 * `rotation`; the library hands back bitmaps that are already rotated too, so
 * this rectangle and that bitmap are the same shape and no transform is left
 * for the executor to get wrong.
 *
 * @throws {RangeError} if the anchor cell or the footprint is not whole.
 */
export function propRect(prop: PlacedProp): PixelRect {
  return cellRect(prop.cell, prop.footprint);
}

/** `rect` moved by `dx`, `dy` pixels. */
export function offsetRect(rect: PixelRect, dx: number, dy: number): PixelRect {
  return { x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h };
}

/**
 * The centre of a footprint, in cells — fractional by nature, since the centre
 * of a single cell is half a cell in from its corner.
 *
 * Used for lighting, where the distance that matters is between the middles of
 * two things and not between their corners.
 */
export function footprintCenter(cell: Cell, footprint: Size = ONE_CELL): { x: number; y: number } {
  return { x: cell.x + footprint.w / 2, y: cell.y + footprint.h / 2 };
}

/**
 * Whether every cell of `footprint` anchored at `cell` lies inside `bounds`.
 *
 * Checking only the anchor is the mistake this exists to prevent: a 4x1 bar
 * counter anchored one cell from the east wall has an in-bounds anchor and
 * three cells hanging off the map.
 */
export function footprintInBounds(cell: Cell, footprint: Size, bounds: Size): boolean {
  if (!Number.isInteger(footprint.w) || !Number.isInteger(footprint.h)) {
    return false;
  }
  if (footprint.w < 1 || footprint.h < 1) {
    return false;
  }
  const far: Cell = { x: cell.x + footprint.w - 1, y: cell.y + footprint.h - 1 };
  return inBounds(cell, bounds) && inBounds(far, bounds);
}
