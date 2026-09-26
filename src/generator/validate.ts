/**
 * Validation — the pass that runs after the three generation stages.
 *
 * It checks the three house rules of the project, and it checks them against
 * the finished `Scene` rather than against the bookkeeping that produced it.
 * That is the point: stage three already upholds all three by construction,
 * so this pass is the independent witness that says so. If it ever fires, the
 * placement rules are wrong, and a map that looks plausible but cannot be
 * played is exactly the failure that is hardest to spot by eye.
 */

import { bfs, cellAt, cellKey, inBounds, sameCell, setCellAt, step } from '../core/grid';
import type { Cell, PlacedProp, Scene, Size } from '../core/types';
import { opposite } from './floorplan';

/**
 * The prop layers that stop a creature walking. Scatter does not: a mug or a
 * handful of straw is stepped over, and treating debris as a wall would make
 * a messy room unreachable rather than messy.
 */
const BLOCKING_LAYERS: readonly PlacedProp['layer'][] = ['anchor', 'group'];

/** How far in front of a door has to stay clear of every prop. */
const DOOR_APPROACH_DEPTH = 1;

export type SceneIssueKind =
  | 'no_door'
  | 'door_blocked'
  | 'isolated_floor'
  | 'circulation_pinch';

export type SceneIssue = {
  kind: SceneIssueKind;
  message: string;
  /** The cell the issue was found at, where one cell names it. */
  cell?: Cell;
};

/** Thrown when a generated scene breaks a rule the stages were meant to keep. */
export class SceneValidationError extends Error {
  readonly issues: SceneIssue[];

  constructor(issues: SceneIssue[]) {
    super(`generated scene is unplayable: ${issues.map((issue) => issue.message).join('; ')}`);
    this.name = 'SceneValidationError';
    this.issues = issues;
  }
}

/** A grid of `size`, every cell filled — never a sparse array. */
function filledGrid<T>(size: Size, value: T): T[][] {
  return Array.from({ length: size.h }, () => new Array<T>(size.w).fill(value));
}

/** Marks every cell a prop stands on, clipped to the grid. */
function occupancy(props: PlacedProp[], size: Size): boolean[][] {
  const grid = filledGrid(size, false);
  for (const prop of props) {
    for (let dy = 0; dy < prop.footprint.h; dy += 1) {
      for (let dx = 0; dx < prop.footprint.w; dx += 1) {
        const cell = { x: prop.cell.x + dx, y: prop.cell.y + dy };
        if (inBounds(cell, size)) {
          setCellAt(grid, cell, true);
        }
      }
    }
  }
  return grid;
}

/**
 * Every rule the scene has to satisfy to be playable, as a list of what it
 * failed. An empty list is a valid scene.
 */
export function validateScene(scene: Scene): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const { floorplan } = scene;
  const { size, cells, doors } = floorplan;

  if (doors.length === 0) {
    issues.push({ kind: 'no_door', message: 'the plan has no door' });
  }

  const anyProp = occupancy(scene.props, size);
  const furniture = occupancy(
    scene.props.filter((prop) => BLOCKING_LAYERS.includes(prop.layer)),
    size,
  );

  // 1. No door may be blocked by a prop — the door cell itself, or the ground
  //    a creature has to stand on to come through it.
  for (const door of doors) {
    const approach: Cell[] = [door.cell];
    let cursor = door.cell;
    for (let depth = 0; depth < DOOR_APPROACH_DEPTH; depth += 1) {
      cursor = step(cursor, opposite(door.facing));
      if (!inBounds(cursor, size) || cellAt(cells, cursor) !== 'floor') {
        break;
      }
      approach.push(cursor);
    }
    for (const cell of approach) {
      if (cellAt(anyProp, cell)) {
        issues.push({
          kind: 'door_blocked',
          message: `a prop blocks the door at ${cellKey(door.cell)}`,
          cell,
        });
      }
    }
  }

  // 2. No floor cell may be cut off. Cells under furniture are not walkable
  //    and are not expected to be; every cell that is still open floor has to
  //    be reachable from a door.
  //
  //    Skipped when there is no door: every floor cell would then be reported
  //    as cut off, which is true and useless — `no_door` already said it, and
  //    twenty derived issues would bury it.
  const walkable = (cell: Cell): boolean =>
    doors.some((door) => sameCell(door.cell, cell)) ||
    (cellAt(cells, cell) === 'floor' && !cellAt(furniture, cell));

  const reached = new Set<string>();
  for (const door of doors) {
    for (const cell of bfs(door.cell, size, walkable)) {
      reached.add(cellKey(cell));
    }
  }
  for (let y = 0; doors.length > 0 && y < size.h; y += 1) {
    for (let x = 0; x < size.w; x += 1) {
      const cell = { x, y };
      if (
        cellAt(cells, cell) === 'floor' &&
        !cellAt(furniture, cell) &&
        !reached.has(cellKey(cell))
      ) {
        issues.push({
          kind: 'isolated_floor',
          message: `floor cell ${cellKey(cell)} is cut off from every door`,
          cell,
        });
      }
    }
  }

  issues.push(...circulationIssues(furniture, size));
  return issues;
}

/**
 * Furniture that is packed too tight to walk between.
 *
 * Pieces that touch edge to edge are one clump — a chair pulled up to its
 * table, a crate leaning on another. Two *different* clumps that touch, even
 * only at a corner, leave no cell to pass through, and a diagonal gap is not
 * a gap anyone can walk down. So: clumps are grown four-way, and any two
 * distinct clumps found eight-way adjacent are the pinch.
 */
function circulationIssues(furniture: boolean[][], size: Size): SceneIssue[] {
  const clump = filledGrid(size, -1);
  let next = 0;
  for (let y = 0; y < size.h; y += 1) {
    for (let x = 0; x < size.w; x += 1) {
      const start = { x, y };
      if (!cellAt(furniture, start) || cellAt(clump, start) !== -1) {
        continue;
      }
      const id = next;
      next += 1;
      for (const cell of bfs(start, size, (c) => cellAt(furniture, c))) {
        setCellAt(clump, cell, id);
      }
    }
  }

  const issues: SceneIssue[] = [];
  const seen = new Set<string>();
  const diagonals: Cell[] = [
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
  ];
  for (let y = 0; y < size.h; y += 1) {
    for (let x = 0; x < size.w; x += 1) {
      const cell = { x, y };
      const id = cellAt(clump, cell);
      if (id === -1) {
        continue;
      }
      for (const offset of diagonals) {
        const neighbor = { x: x + offset.x, y: y + offset.y };
        if (!inBounds(neighbor, size)) {
          continue;
        }
        const other = cellAt(clump, neighbor);
        if (other === -1 || other === id) {
          continue;
        }
        const pair = id < other ? `${id}-${other}` : `${other}-${id}`;
        if (seen.has(pair)) {
          continue;
        }
        seen.add(pair);
        issues.push({
          kind: 'circulation_pinch',
          message: `furniture at ${cellKey(cell)} and ${cellKey(neighbor)} leaves no room to pass`,
          cell,
        });
      }
    }
  }
  return issues;
}
