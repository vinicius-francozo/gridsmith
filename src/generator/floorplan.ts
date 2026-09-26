/**
 * Stage one — the plan.
 *
 * The footprint comes from the grammar in `shapes.ts`. The walls are *derived*
 * from it: a cell that is not floor but touches floor, diagonals included, is
 * wall. Nothing about the wall is drawn at random, so the contour always
 * closes. The doors are placed by rule — an eligible run of external wall,
 * set back from the corners, spread apart — and randomness only chooses
 * between placements the rule already accepted.
 */

import { cellAt, cellKey, inBounds, setCellAt, step } from '../core/grid';
import type {
  Cell,
  CellKind,
  Door,
  Facing,
  Floorplan,
  Params,
  Rng,
  Size,
  WallSegment,
} from '../core/types';
import { ALCOVE_FEATURE, clampDoorCount, clampSize, PILLARS_FEATURE } from './profiles';
import type { PlaceProfile } from './profiles';
import { buildFootprint } from './shapes';
import type { Rect } from './shapes';

/**
 * How far a door must sit from the end of its wall run, counted in cells.
 * Tried in order: a door two cells clear of the corner reads best, but a
 * small room may not have a run long enough, and a room with no door at all
 * is not a room.
 */
const DOOR_CORNER_SETBACKS: readonly number[] = [2, 1, 0];

/** A rectangle that pillars need to fit inside before any are grown. */
const MIN_INTERIOR_FOR_PILLARS: Size = { w: 9, h: 9 };

/**
 * The eight offsets around a cell. Walls are derived with the diagonals
 * included: without them the inside corner of an L-shaped room has a single
 * cell of void touching the floor at the diagonal, and the room leaks.
 */
const AROUND: readonly Cell[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

/** The facing opposite `facing`. */
export function opposite(facing: Facing): Facing {
  const pairs: Record<Facing, Facing> = { n: 's', s: 'n', e: 'w', w: 'e' };
  return pairs[facing];
}

/**
 * Stage one's output plus the regions it was built from.
 *
 * `Floorplan` is a frozen contract and has no room for the grammar's
 * rectangles, but stage two wants them: they are the natural seams of the
 * room and make far better material zones than anything re-derived from the
 * finished cell grid.
 */
export type FloorplanDraft = {
  floorplan: Floorplan;
  /** The grammar's rectangles, in the order the grammar returned them. */
  regions: Rect[];
};

/** A grid of `size`, every cell filled — never a sparse array. */
function filledGrid<T>(size: Size, value: T): T[][] {
  return Array.from({ length: size.h }, () => new Array<T>(size.w).fill(value));
}

/** Whether `cell` is inside the grid and is floor. */
function isFloor(cells: CellKind[][], size: Size, cell: Cell): boolean {
  return inBounds(cell, size) && cellAt(cells, cell) === 'floor';
}

/**
 * Whether `cell` is outside the building — either off the grid entirely, or a
 * void cell. Both are "not indoors", which is what a door needs on its far
 * side.
 */
function isOutside(cells: CellKind[][], size: Size, cell: Cell): boolean {
  return !inBounds(cell, size) || cellAt(cells, cell) === 'void';
}

/** Whether `cell` is inside the grid and is wall. */
function isWall(cells: CellKind[][], size: Size, cell: Cell): boolean {
  return inBounds(cell, size) && cellAt(cells, cell) === 'wall';
}

/**
 * Turns every non-floor cell that touches floor into wall.
 *
 * This is the whole of wall generation. The contour closes because it is the
 * boundary of the floor set by construction, not because a sampler happened
 * to agree with itself all the way round.
 */
function deriveWalls(cells: CellKind[][], size: Size): void {
  for (let y = 0; y < size.h; y += 1) {
    for (let x = 0; x < size.w; x += 1) {
      const cell = { x, y };
      if (cellAt(cells, cell) === 'floor') {
        continue;
      }
      const touchesFloor = AROUND.some((offset) =>
        isFloor(cells, size, { x: x + offset.x, y: y + offset.y }),
      );
      if (touchesFloor) {
        setCellAt(cells, cell, 'wall');
      }
    }
  }
}

/**
 * The wall cells, partitioned into axis-aligned segments.
 *
 * Maximal horizontal runs of two or more cells are taken first; whatever is
 * left over — the sides of the ring, a lone jog — is taken as vertical runs.
 * Every wall cell ends up in exactly one segment, which is what lets the
 * renderer draw the wall as strokes instead of as squares.
 */
export function segmentWalls(cells: CellKind[][], size: Size): WallSegment[] {
  const taken = filledGrid(size, false);
  const segments: WallSegment[] = [];

  for (let y = 0; y < size.h; y += 1) {
    let x = 0;
    while (x < size.w) {
      if (!isWall(cells, size, { x, y })) {
        x += 1;
        continue;
      }
      let end = x;
      while (end + 1 < size.w && isWall(cells, size, { x: end + 1, y })) {
        end += 1;
      }
      if (end > x) {
        segments.push({ from: { x, y }, to: { x: end, y } });
        for (let i = x; i <= end; i += 1) {
          setCellAt(taken, { x: i, y }, true);
        }
      }
      x = end + 1;
    }
  }

  for (let x = 0; x < size.w; x += 1) {
    let y = 0;
    while (y < size.h) {
      const free = (at: number): boolean =>
        isWall(cells, size, { x, y: at }) && !cellAt(taken, { x, y: at });
      if (!free(y)) {
        y += 1;
        continue;
      }
      let end = y;
      while (end + 1 < size.h && free(end + 1)) {
        end += 1;
      }
      segments.push({ from: { x, y }, to: { x, y: end } });
      for (let i = y; i <= end; i += 1) {
        setCellAt(taken, { x, y: i }, true);
      }
      y = end + 1;
    }
  }

  return segments;
}

/** A wall cell that could hold a door, and where it sits in its wall run. */
export type DoorCandidate = {
  cell: Cell;
  /** Which way the door leads out of the building. */
  facing: Facing;
  /** How many cells of the run lie between this one and the nearer end. */
  setback: number;
};

/**
 * Every wall cell a door could occupy, grouped into runs and annotated with
 * how far each sits from the end of its run.
 *
 * A cell qualifies when it has exactly one floor neighbour (the inside), the
 * cell opposite that is outside the building, and the two cells along the
 * wall are themselves wall. That last condition is what keeps doors out of
 * corners and out of one-cell jogs where a door would have no jamb.
 */
export function doorCandidates(cells: CellKind[][], size: Size): DoorCandidate[] {
  type Raw = { cell: Cell; facing: Facing };
  const raw: Raw[] = [];

  for (let y = 0; y < size.h; y += 1) {
    for (let x = 0; x < size.w; x += 1) {
      const cell = { x, y };
      if (!isWall(cells, size, cell)) {
        continue;
      }
      const facings: Facing[] = ['n', 'e', 's', 'w'];
      const inward = facings.filter((facing) => isFloor(cells, size, step(cell, facing)));
      if (inward.length !== 1) {
        continue;
      }
      const outward = opposite(inward[0]);
      if (!isOutside(cells, size, step(cell, outward))) {
        continue;
      }
      // The two cells along the wall, perpendicular to the way the door faces.
      // A door needs a jamb on both sides. A lateral that is *floor* is
      // already ruled out above, since it would be a second floor neighbour;
      // what this catches is a lateral that is void — a one-cell stub of wall
      // with nothing to hang a door on. A plan whose walls were derived here
      // never has one, because a void cell diagonally touching floor would
      // itself have been made wall, but `doorCandidates` takes any cell grid
      // and the rule is about doors, not about how the grid was built.
      const along: Facing[] = outward === 'n' || outward === 's' ? ['e', 'w'] : ['n', 's'];
      if (!along.every((facing) => isWall(cells, size, step(cell, facing)))) {
        continue;
      }
      raw.push({ cell, facing: outward });
    }
  }

  // Group into runs: same facing, same line, consecutive along the wall.
  const runs = new Map<string, Raw[]>();
  for (const candidate of raw) {
    const horizontal = candidate.facing === 'n' || candidate.facing === 's';
    const line = horizontal ? candidate.cell.y : candidate.cell.x;
    const key = `${candidate.facing}:${line}`;
    const run = runs.get(key);
    if (run === undefined) {
      runs.set(key, [candidate]);
    } else {
      run.push(candidate);
    }
  }

  const annotated: DoorCandidate[] = [];
  for (const [key, members] of runs) {
    const horizontal = key.startsWith('n:') || key.startsWith('s:');
    const along = (candidate: Raw): number =>
      horizontal ? candidate.cell.x : candidate.cell.y;
    members.sort((a, b) => along(a) - along(b));

    // A run breaks wherever the cells stop being consecutive. `members` is
    // never empty, so the scan can start past the first cell.
    let start = 0;
    for (let i = 1; i <= members.length; i += 1) {
      const breaks = i === members.length || along(members[i]) !== along(members[i - 1]) + 1;
      if (!breaks) {
        continue;
      }
      for (let j = start; j < i; j += 1) {
        annotated.push({
          cell: members[j].cell,
          facing: members[j].facing,
          setback: Math.min(j - start, i - 1 - j),
        });
      }
      start = i;
    }
  }

  return annotated;
}

/** Chebyshev distance — the number of king moves between two cells. */
function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Places `count` doors, spread as far apart as the eligible wall allows.
 *
 * The first door is drawn at random from the candidates; each one after it is
 * drawn from the candidates furthest from the doors already placed, so two
 * doors never end up side by side.
 *
 * @throws {Error} if no wall cell can hold a door at all. A room with no way
 *                 in is not a usable map, and silently returning none would
 *                 push the failure into the renderer.
 */
export function placeDoors(cells: CellKind[][], size: Size, count: number, rng: Rng): Door[] {
  let pool: DoorCandidate[] = [];
  const all = doorCandidates(cells, size);
  for (const setback of DOOR_CORNER_SETBACKS) {
    pool = all.filter((candidate) => candidate.setback >= setback);
    if (pool.length > 0) {
      break;
    }
  }
  if (pool.length === 0) {
    throw new Error(`no wall cell of the ${size.w}x${size.h} plan can hold a door`);
  }

  const doors: Door[] = [];
  const wanted = Math.min(count, pool.length);
  while (doors.length < wanted) {
    let chosen: DoorCandidate;
    if (doors.length === 0) {
      chosen = rng.pick(pool);
    } else {
      const spread = pool.map((candidate) =>
        Math.min(...doors.map((door) => chebyshev(candidate.cell, door.cell))),
      );
      const best = Math.max(...spread);
      chosen = rng.pick(pool.filter((_, i) => spread[i] === best));
    }
    doors.push({ cell: chosen.cell, facing: chosen.facing });
    pool = pool.filter((candidate) => !sameKey(candidate.cell, chosen.cell));
  }

  return doors;
}

function sameKey(a: Cell, b: Cell): boolean {
  return cellKey(a) === cellKey(b);
}

/**
 * Grows four free-standing pillars, well inside the room.
 *
 * They sit two cells in from the interior's own edge, so they can never seal
 * a corner off or crowd a wall, and they are only grown in a room with space
 * to spare. This is the kind of variation stage one is allowed: a detail
 * inside a plan the grammar already fixed.
 */
function growPillars(cells: CellKind[][], interior: Rect): void {
  const xs = [interior.x + 2, interior.x + interior.w - 3];
  const ys = [interior.y + 2, interior.y + interior.h - 3];
  for (const x of xs) {
    for (const y of ys) {
      if (cellAt(cells, { x, y }) === 'floor') {
        setCellAt(cells, { x, y }, 'void');
      }
    }
  }
}

/**
 * Builds stage one: footprint, derived walls, wall segments and doors.
 *
 * Two features are answered here rather than by the prop stage, because they
 * are the shape of the room and not something standing in it: `alcove` picks
 * that footprint out of the grammar, and `pillars` grows columns in a hall
 * wide enough to need them. Neither is a promise — a room too small for
 * either simply does not get it.
 *
 * @throws {Error} if the plan admits no door.
 */
export function buildFloorplan(params: Params, profile: PlaceProfile, rng: Rng): FloorplanDraft {
  const size = clampSize(params.size, profile);
  const interior: Rect = { x: 1, y: 1, w: size.w - 2, h: size.h - 2 };

  // The draw happens either way, so asking for a feature shifts the plan
  // without shifting every later draw in the map along with it.
  const drawnShape = rng.pick(profile.shapes);
  const asked = params.features.includes(ALCOVE_FEATURE) && profile.shapes.includes('alcove');
  const regions = buildFootprint(asked ? 'alcove' : drawnShape, interior, rng);

  const cells = filledGrid<CellKind>(size, 'void');
  for (const region of regions) {
    for (let y = region.y; y < region.y + region.h; y += 1) {
      for (let x = region.x; x < region.x + region.w; x += 1) {
        setCellAt(cells, { x, y }, 'floor');
      }
    }
  }

  const roomy =
    interior.w >= MIN_INTERIOR_FOR_PILLARS.w && interior.h >= MIN_INTERIOR_FOR_PILLARS.h;
  const drawnPillars = rng.int(0, 1) === 1;
  const askedPillars = params.features.includes(PILLARS_FEATURE);
  if (profile.allowPillars && roomy && (askedPillars || drawnPillars)) {
    growPillars(cells, interior);
  }

  deriveWalls(cells, size);

  const walls = segmentWalls(cells, size);
  const doors = placeDoors(cells, size, clampDoorCount(params.doorCount, profile), rng);

  return { floorplan: { size, cells, doors, walls }, regions };
}

/** The floor cells of a plan, in reading order. */
export function floorCells(floorplan: Floorplan): Cell[] {
  const found: Cell[] = [];
  for (let y = 0; y < floorplan.size.h; y += 1) {
    for (let x = 0; x < floorplan.size.w; x += 1) {
      if (cellAt(floorplan.cells, { x, y }) === 'floor') {
        found.push({ x, y });
      }
    }
  }
  return found;
}
