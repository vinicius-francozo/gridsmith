/**
 * Stage three — props, in three layers.
 *
 * Props are not independent per cell. A table covers several cells, its
 * chairs orbit it, a barrel leans on a wall, a counter is one continuous run.
 * Drawing each cell on its own would scatter furniture like confetti, so the
 * stage runs in three passes, in this order:
 *
 * 1. **Anchors** — few, fixed to a wall or a corner, and what makes the room
 *    read as a bar or a bedroom rather than as a box with things in it.
 * 2. **Groups** — a table with its chairs, a stack of crates: placed as one
 *    arrangement, with a cell of circulation clearance kept around it.
 * 3. **Scatter** — mugs, shards, straw. This is the one layer where a
 *    per-cell draw is the right instrument, because loose debris genuinely
 *    has no relationship to its neighbours.
 *
 * Two invariants are upheld here rather than repaired afterwards: no piece of
 * furniture is placed where it would cut part of the floor off from the
 * doors, and no piece is placed against the door itself.
 *
 * **`PlacedProp.cell` is the top-left cell of the rectangle the prop covers,
 * and `PlacedProp.footprint` is that rectangle — already turned by
 * `PlacedProp.rotation`.** A 3x1 table placed on its end is recorded as 1x3,
 * not as 3x1 with a rotation to apply later. The frozen types say neither
 * way; the renderer reads the footprint as the cells actually covered and
 * applies no transform of its own, so recording the unturned footprint here
 * would draw every quarter-turned prop transposed.
 */

import { bfs, cellAt, cellKey, inBounds, sameCell, setCellAt, step } from '../core/grid';
import type {
  Cell,
  Condition,
  Facing,
  Floorplan,
  Params,
  PlacedProp,
  Rng,
  Rotation,
  Size,
} from '../core/types';
import { floorCells, opposite } from './floorplan';
import { assetIdFor, ROTATIONS, pickRotation } from './profiles';
import type { AnchorSpec, GroupPart, GroupSpec, PlaceProfile, ScatterSpec } from './profiles';
import type { Rect } from './shapes';

/** Cells of walking space kept between one piece of furniture and the next. */
const CIRCULATION_CLEARANCE = 1;

/** How far into the room the ground in front of a door is kept clear. */
const DOOR_CLEARANCE_DEPTH = 2;

/** A room can only be so messy before the floor stops being walkable. */
const MAX_SCATTER_CHANCE = 0.6;

/** How much debris each state of repair invites, as a factor on the clutter. */
const CONDITION_SCATTER: Record<Condition, number> = {
  tidy: 0.3,
  lived_in: 0.7,
  disordered: 1,
  ruined: 1.4,
};

/**
 * The scatter factor of `condition`.
 *
 * @throws {Error} if `condition` is outside the closed vocabulary. The type
 *                 system rules it out inside the project, but `Params` may
 *                 have come through a language model and a JSON boundary, and
 *                 the API does not enforce the schema — the client-side
 *                 validation is the only thing that closes the vocabulary, so
 *                 the generator closes it again here, as `profileFor` does
 *                 for `placeType`.
 *
 * Left unguarded the lookup gives `undefined`, `chance` becomes `NaN`, and
 * `rng.float() >= NaN` is false — so the skip never fires and the scatter
 * layer drops a prop on every free cell in the room. Measured in a 20x18
 * hall: 145 pieces of debris over 222 floor cells, against 8 with a valid
 * condition on the same seed. Worse, the scene it hands back passes
 * `validateScene` in full, because debris is meant to be walked over.
 */
function conditionScatter(condition: Condition): number {
  const factor = CONDITION_SCATTER[condition];
  if (factor === undefined) {
    throw new Error(`unknown condition '${condition}'`);
  }
  return factor;
}

/**
 * The wall a prop has its back to, per rotation.
 *
 * An unrotated prop stands with its back against a wall to its north; each
 * further quarter turn clockwise moves the back one facing clockwise.
 */
const BACK_OF: Record<Rotation, Facing> = { 0: 'n', 90: 'e', 180: 's', 270: 'w' };

/** A footprint after `rotation`: a quarter turn swaps its axes. */
export function rotateFootprint(footprint: Size, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270
    ? { w: footprint.h, h: footprint.w }
    : { w: footprint.w, h: footprint.h };
}

/**
 * A group template turned by `rotation` inside its own bounding box.
 *
 * Written out rather than applied to each part independently because the
 * parts have to stay in the same arrangement relative to one another: a bench
 * that turns while its table does not is no longer a long table.
 */
export function rotateTemplate(
  size: Size,
  parts: GroupPart[],
  rotation: Rotation,
): { size: Size; parts: GroupPart[] } {
  const turned = rotateFootprint(size, rotation);
  const moved = parts.map((part) => {
    const { offset, footprint } = part;
    // A fresh `offset` and `footprint` on every branch, the identity turn
    // included. Handing a part back by reference would put the very object
    // stored in `PROFILES` into a `PlacedProp`, and one consumer scaling or
    // normalising it in place would corrupt the profile for the rest of the
    // session. See `placedFootprint`.
    const spun: Size =
      rotation === 90 || rotation === 270
        ? { w: footprint.h, h: footprint.w }
        : { w: footprint.w, h: footprint.h };
    switch (rotation) {
      case 0:
        return { assetId: part.assetId, offset: { x: offset.x, y: offset.y }, footprint: spun };
      case 180:
        return {
          assetId: part.assetId,
          offset: { x: size.w - offset.x - footprint.w, y: size.h - offset.y - footprint.h },
          footprint: spun,
        };
      case 90:
        return {
          assetId: part.assetId,
          offset: { x: size.h - offset.y - footprint.h, y: offset.x },
          footprint: spun,
        };
      default:
        return {
          assetId: part.assetId,
          offset: { x: offset.y, y: size.w - offset.x - footprint.w },
          footprint: spun,
        };
    }
  });
  return { size: turned, parts: moved };
}

/** A grid of `size`, every cell filled — never a sparse array. */
function filledGrid(size: Size, value: boolean): boolean[][] {
  return Array.from({ length: size.h }, () => new Array<boolean>(size.w).fill(value));
}

/** Every cell of `rect`, in reading order. */
function rectCells(rect: Rect): Cell[] {
  const cells: Cell[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

/** The strip of cells just outside `rect` on the `facing` side. */
function outsideStrip(rect: Rect, facing: Facing): Cell[] {
  switch (facing) {
    case 'n':
      return rectCells({ x: rect.x, y: rect.y - 1, w: rect.w, h: 1 });
    case 's':
      return rectCells({ x: rect.x, y: rect.y + rect.h, w: rect.w, h: 1 });
    case 'e':
      return rectCells({ x: rect.x + rect.w, y: rect.y, w: 1, h: rect.h });
    case 'w':
      return rectCells({ x: rect.x - 1, y: rect.y, w: 1, h: rect.h });
  }
}

/** The two sides at right angles to `facing`. */
function lateralsOf(facing: Facing): Facing[] {
  return facing === 'n' || facing === 's' ? ['e', 'w'] : ['n', 's'];
}

/** A placement the room is still holding open, by layer. */
type Placement = { rects: Rect[]; parts: PlacedProp[] };

/**
 * The placement bookkeeping of one room.
 *
 * Three grids, because the three layers answer to different rules. `blocked`
 * is what a prop physically stands on. `reserved` is `blocked` plus the
 * circulation gap and everything that is not open floor — what the anchor and
 * group layers must stay out of. `doorClear` is the ground in front of a
 * door, which every layer stays out of, scatter included: a mug in the
 * doorway blocks the door as surely as a crate does.
 */
class Room {
  readonly blocked: boolean[][];
  readonly reserved: boolean[][];
  readonly doorClear: boolean[][];
  private readonly doorCells: Cell[];

  constructor(private readonly floorplan: Floorplan) {
    const { size, cells } = floorplan;
    this.blocked = filledGrid(size, false);
    this.reserved = filledGrid(size, false);
    this.doorClear = filledGrid(size, false);
    this.doorCells = floorplan.doors.map((door) => door.cell);

    for (let y = 0; y < size.h; y += 1) {
      for (let x = 0; x < size.w; x += 1) {
        if (cellAt(cells, { x, y }) !== 'floor') {
          setCellAt(this.reserved, { x, y }, true);
        }
      }
    }

    for (const door of floorplan.doors) {
      setCellAt(this.doorClear, door.cell, true);
      let cursor = door.cell;
      for (let depth = 0; depth < DOOR_CLEARANCE_DEPTH; depth += 1) {
        cursor = step(cursor, opposite(door.facing));
        if (!this.isFloor(cursor)) {
          break;
        }
        setCellAt(this.doorClear, cursor, true);
        setCellAt(this.reserved, cursor, true);
      }
    }
  }

  isFloor(cell: Cell): boolean {
    return (
      inBounds(cell, this.floorplan.size) && cellAt(this.floorplan.cells, cell) === 'floor'
    );
  }

  isWall(cell: Cell): boolean {
    return inBounds(cell, this.floorplan.size) && cellAt(this.floorplan.cells, cell) === 'wall';
  }

  /** Whether every cell of `rect` is open floor no earlier layer has claimed. */
  fits(rect: Rect): boolean {
    return rectCells(rect).every(
      (cell) => this.isFloor(cell) && !cellAt(this.reserved, cell) && !cellAt(this.blocked, cell),
    );
  }

  /** Whether the whole strip outside `rect` on that side is wall. */
  backsOnto(rect: Rect, facing: Facing): boolean {
    return outsideStrip(rect, facing).every((cell) => this.isWall(cell));
  }

  /**
   * Whether every open floor cell is still reachable from a door, walking
   * only over floor the furniture has not taken.
   *
   * This is checked *before* a placement is committed rather than reported
   * afterwards, because a table that seals a corner off has no repair short
   * of moving it, and moving it is exactly what rejecting the candidate does.
   */
  freeSpaceConnected(): boolean {
    const { size } = this.floorplan;
    const passable = (cell: Cell): boolean =>
      this.doorCells.some((door) => sameCell(door, cell)) ||
      (this.isFloor(cell) && !cellAt(this.blocked, cell));

    const reached = new Set<string>();
    for (const door of this.doorCells) {
      for (const cell of bfs(door, size, passable)) {
        reached.add(cellKey(cell));
      }
    }

    for (let y = 0; y < size.h; y += 1) {
      for (let x = 0; x < size.w; x += 1) {
        const cell = { x, y };
        if (this.isFloor(cell) && !cellAt(this.blocked, cell) && !reached.has(cellKey(cell))) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Commits a placement if it leaves the floor connected, and reports whether
   * it did. A rejected placement leaves the room exactly as it was.
   */
  commit(placement: Placement): boolean {
    for (const rect of placement.rects) {
      this.mark(this.blocked, rect, true);
    }
    if (!this.freeSpaceConnected()) {
      for (const rect of placement.rects) {
        this.mark(this.blocked, rect, false);
      }
      return false;
    }
    for (const rect of placement.rects) {
      this.mark(this.reserved, this.grow(rect, CIRCULATION_CLEARANCE), true);
    }
    return true;
  }

  /** Marks a scatter prop's cell. Debris is stepped over, so it reserves nothing. */
  markScatter(cell: Cell): void {
    setCellAt(this.blocked, cell, true);
  }

  private mark(grid: boolean[][], rect: Rect, value: boolean): void {
    for (const cell of rectCells(rect)) {
      if (inBounds(cell, this.floorplan.size)) {
        setCellAt(grid, cell, value);
      }
    }
  }

  private grow(rect: Rect, by: number): Rect {
    return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
  }
}

/** One element of `specs`, drawn in proportion to its weight. */
function weightedPick<T extends { weight: number }>(specs: T[], rng: Rng): T {
  if (specs.length === 0) {
    throw new RangeError('weightedPick() needs a non-empty array');
  }
  const total = specs.reduce((sum, spec) => sum + spec.weight, 0);
  let roll = rng.float() * total;
  for (const spec of specs) {
    roll -= spec.weight;
    if (roll < 0) {
      return spec;
    }
  }
  return specs[specs.length - 1];
}

/**
 * The footprint object a `PlacedProp` leaves with: always a fresh one.
 *
 * Every candidate placement of one rotation would otherwise share the single
 * `Size` the loop computed, and a template part would share the object held
 * in `PROFILES`. `PlacedProp` is handed to the renderer and to the interface,
 * and a consumer that normalises or scales a footprint in place would then be
 * writing into the generator's own profile — after which `generate` stops
 * agreeing with itself under one seed, with no exception and no log.
 *
 * `rotateTemplate` no longer hands back anything it was given, so this copy
 * is a second line rather than the only one; it is kept because it makes the
 * guarantee a property of `PlacedProp` itself, readable at the one place a
 * `PlacedProp` is built, instead of a conclusion about two callers.
 */
function placedFootprint(footprint: Size): Size {
  return { w: footprint.w, h: footprint.h };
}

/** Every way `spec` could stand against a wall of this room. */
function anchorCandidates(room: Room, spec: AnchorSpec, size: Size): Placement[] {
  const found: Placement[] = [];
  for (const rotation of ROTATIONS) {
    const footprint = rotateFootprint(spec.footprint, rotation);
    const back = BACK_OF[rotation];
    for (let y = 0; y + footprint.h <= size.h; y += 1) {
      for (let x = 0; x + footprint.w <= size.w; x += 1) {
        const rect: Rect = { x, y, w: footprint.w, h: footprint.h };
        if (!room.fits(rect) || !room.backsOnto(rect, back)) {
          continue;
        }
        if (
          spec.placement === 'corner' &&
          !lateralsOf(back).some((facing) => room.backsOnto(rect, facing))
        ) {
          continue;
        }
        found.push({
          rects: [rect],
          parts: [
            {
              assetId: assetIdFor('anchor', spec.assetId),
              cell: { x, y },
              footprint: placedFootprint(footprint),
              rotation,
              layer: 'anchor',
            },
          ],
        });
      }
    }
  }
  return found;
}

/** Every way `spec` could stand in the open floor of this room. */
function groupCandidates(room: Room, spec: GroupSpec, size: Size): Placement[] {
  const found: Placement[] = [];
  for (const rotation of ROTATIONS) {
    const template = rotateTemplate(spec.size, spec.parts, rotation);
    for (let y = 0; y + template.size.h <= size.h; y += 1) {
      for (let x = 0; x + template.size.w <= size.w; x += 1) {
        const rects = template.parts.map((part) => ({
          x: x + part.offset.x,
          y: y + part.offset.y,
          w: part.footprint.w,
          h: part.footprint.h,
        }));
        if (!rects.every((rect) => room.fits(rect))) {
          continue;
        }
        found.push({
          rects,
          parts: template.parts.map((part, i) => ({
            assetId: assetIdFor('group', part.assetId),
            cell: { x: rects[i].x, y: rects[i].y },
            footprint: placedFootprint(part.footprint),
            rotation,
            layer: 'group' as const,
          })),
        });
      }
    }
  }
  return found;
}

/**
 * Draws from `candidates` until one commits, discarding each that would cut
 * the floor in two. Returns the props placed, or an empty list if none could
 * be.
 */
function placeOneOf(room: Room, candidates: Placement[], rng: Rng): PlacedProp[] {
  let pool = candidates;
  while (pool.length > 0) {
    const chosen = rng.pick(pool);
    if (room.commit(chosen)) {
      return chosen.parts;
    }
    pool = pool.filter((candidate) => candidate !== chosen);
  }
  return [];
}

/**
 * The anchors this room wants: the ones its features asked for by name first,
 * then whatever else the profile offers, up to the profile's count.
 */
function anchorOrder(params: Params, profile: PlaceProfile, rng: Rng): AnchorSpec[] {
  const requested = profile.anchors.filter(
    (spec) => spec.feature !== undefined && params.features.includes(spec.feature),
  );
  const wanted = rng.int(profile.anchorRange.min, profile.anchorRange.max);

  const order = [...requested];
  let rest = profile.anchors.filter((spec) => !order.includes(spec));
  while (order.length < wanted && rest.length > 0) {
    const spec = rng.pick(rest);
    order.push(spec);
    rest = rest.filter((other) => other !== spec);
  }
  return order;
}

/** How many groups a room of `floorArea` cells wants at this clutter. */
function groupTarget(floorArea: number, params: Params, profile: PlaceProfile): number {
  const clutter = Math.min(1, Math.max(0, params.clutter));
  const { min, max } = profile.groupsPerHundredCells;
  return Math.round((floorArea / 100) * (min + (max - min) * clutter));
}

/**
 * Places the three layers over `floorplan` and returns every prop, anchors
 * first, then groups, then scatter — the order the renderer draws them in.
 */
export function placeProps(
  floorplan: Floorplan,
  params: Params,
  profile: PlaceProfile,
  rng: Rng,
): PlacedProp[] {
  const room = new Room(floorplan);
  const size = floorplan.size;
  const props: PlacedProp[] = [];

  for (const spec of anchorOrder(params, profile, rng)) {
    props.push(...placeOneOf(room, anchorCandidates(room, spec, size), rng));
  }

  const floor = floorCells(floorplan);
  const target = groupTarget(floor.length, params, profile);
  let specs = [...profile.groups];
  for (let placed = 0; placed < target && specs.length > 0; placed += 1) {
    const spec = rng.pick(specs);
    const parts = placeOneOf(room, groupCandidates(room, spec, size), rng);
    if (parts.length === 0) {
      // This template no longer fits anywhere; stop offering it.
      specs = specs.filter((other) => other !== spec);
      placed -= 1;
      continue;
    }
    props.push(...parts);
  }

  props.push(...scatterProps(room, floor, params, profile, rng));
  return props;
}

/** The per-cell layer: loose debris over whatever floor is still open. */
function scatterProps(
  room: Room,
  floor: Cell[],
  params: Params,
  profile: PlaceProfile,
  rng: Rng,
): PlacedProp[] {
  const specs: ScatterSpec[] = profile.scatter;
  if (specs.length === 0) {
    return [];
  }
  const clutter = Math.min(1, Math.max(0, params.clutter));
  const chance = Math.min(
    MAX_SCATTER_CHANCE,
    profile.scatterChance * clutter * conditionScatter(params.condition),
  );

  const props: PlacedProp[] = [];
  for (const cell of floor) {
    if (cellAt(room.blocked, cell) || cellAt(room.doorClear, cell)) {
      continue;
    }
    if (rng.float() >= chance) {
      continue;
    }
    props.push({
      assetId: assetIdFor('scatter', weightedPick(specs, rng).assetId),
      cell,
      footprint: { w: 1, h: 1 },
      rotation: pickRotation(rng),
      layer: 'scatter',
    });
    room.markScatter(cell);
  }
  return props;
}
