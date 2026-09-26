/**
 * Grid geometry: bounds, neighbours, breadth-first search, and the one
 * cell-to-pixel conversion in the project.
 *
 * Domain geometry is measured in grid cells everywhere. The conversion
 * helpers at the bottom of this file are the single exception to that rule,
 * and only `src/renderer/` is meant to call them.
 */

import { PIXELS_PER_CELL } from './types';
import type { Cell, Facing, Size } from './types';

/** The four facings, in clockwise order starting north. */
export const FACINGS: readonly Facing[] = ['n', 'e', 's', 'w'];

/**
 * Cell offsets per facing. North is `-y`: row 0 is the top row, matching the
 * `[y][x]` layout of `Floorplan.cells` and the screen's own axes.
 */
const OFFSETS: Record<Facing, Cell> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

/**
 * A stable string for a cell, for use as a `Set`/`Map` key.
 *
 * Cells are compared by value across the whole project, and object identity
 * would silently treat two equal cells as different.
 */
export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

/** Whether two cells denote the same square. */
export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/** The cell one step from `cell` towards `facing`. May fall outside bounds. */
export function step(cell: Cell, facing: Facing): Cell {
  const offset = OFFSETS[facing];
  return { x: cell.x + offset.x, y: cell.y + offset.y };
}

/**
 * Validates a grid size.
 *
 * @throws {RangeError} if either dimension is not a positive integer. A zero
 *                      or fractional size has no cells to address, and every
 *                      bound check below would pass vacuously.
 */
export function assertValidSize(size: Size): void {
  if (!Number.isInteger(size.w) || !Number.isInteger(size.h) || size.w < 1 || size.h < 1) {
    throw new RangeError(`grid size must be positive integers, got ${size.w}x${size.h}`);
  }
}

/** Whether `cell` addresses a square of a `size` grid. */
export function inBounds(cell: Cell, size: Size): boolean {
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < size.w &&
    cell.y < size.h
  );
}

/**
 * The orthogonal neighbours of `cell` that lie inside the grid, in `FACINGS`
 * order. Diagonals are not neighbours: movement, reachability and circulation
 * clearance are all defined on the four-way grid.
 *
 * `cell` itself need not be in bounds — a cell outside the grid simply has
 * fewer neighbours inside it.
 */
export function neighbors(cell: Cell, size: Size): Cell[] {
  assertValidSize(size);
  const found: Cell[] = [];
  for (const facing of FACINGS) {
    const next = step(cell, facing);
    if (inBounds(next, size)) {
      found.push(next);
    }
  }
  return found;
}

/**
 * Every cell reachable from `start` by orthogonal steps through passable
 * cells, in breadth-first order and including `start` itself.
 *
 * This is how "no floor cell is cut off" is checked: flood from a door and
 * compare the count against the floor cells of the plan.
 *
 * Returns an empty array when `start` itself is not passable — nothing was
 * reached, not even the start.
 *
 * @throws {RangeError} if `size` is invalid, or if `start` is outside the grid.
 */
export function bfs(start: Cell, size: Size, isPassable: (cell: Cell) => boolean): Cell[] {
  assertValidSize(size);
  if (!inBounds(start, size)) {
    throw new RangeError(`bfs() start ${cellKey(start)} is outside a ${size.w}x${size.h} grid`);
  }
  if (!isPassable(start)) {
    return [];
  }

  const visited = new Set<string>([cellKey(start)]);
  const order: Cell[] = [start];

  // `order` doubles as the queue: `head` is the read cursor into it.
  for (let head = 0; head < order.length; head += 1) {
    for (const next of neighbors(order[head], size)) {
      const key = cellKey(next);
      if (!visited.has(key) && isPassable(next)) {
        visited.add(key);
        order.push(next);
      }
    }
  }

  return order;
}

// --- Cells to pixels -------------------------------------------------------
//
// The only place in the project where a pixel is a legitimate number. Callers
// outside `src/renderer/` should not need anything below this line.

/** The top-left pixel of `cell`. */
export function cellToPixel(cell: Cell): { x: number; y: number } {
  return { x: cell.x * PIXELS_PER_CELL, y: cell.y * PIXELS_PER_CELL };
}

/**
 * The cell containing the pixel at `(x, y)`.
 *
 * Rounds towards the containing cell, so pixels on a cell's leading edge
 * belong to that cell and negative pixels land on negative cells.
 */
export function pixelToCell(x: number, y: number): Cell {
  return { x: Math.floor(x / PIXELS_PER_CELL), y: Math.floor(y / PIXELS_PER_CELL) };
}

/**
 * The pixel dimensions of a grid of `size` cells — always a multiple of
 * `PIXELS_PER_CELL`, which is what keeps the exported image aligned to the
 * virtual tabletop's own grid.
 *
 * @throws {RangeError} if `size` is invalid.
 */
export function sizeToPixels(size: Size): { w: number; h: number } {
  assertValidSize(size);
  return { w: size.w * PIXELS_PER_CELL, h: size.h * PIXELS_PER_CELL };
}
