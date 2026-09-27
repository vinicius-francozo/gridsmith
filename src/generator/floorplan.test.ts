import { describe, expect, it } from 'vitest';

import { cellAt, cellKey, inBounds, step } from '../core/grid';
import { createRng } from '../core/prng';
import type { Cell, CellKind, Floorplan, PlaceType } from '../core/types';
import {
  buildFloorplan,
  doorCandidates,
  floorCells,
  opposite,
  placeDoors,
  segmentWalls,
} from './floorplan';
import { clampDoorCount, clampSize, profileFor } from './profiles';
import { paramsFor, planFrom } from './test-fixtures';

const PLACE_TYPES: PlaceType[] = ['tavern_hall', 'tavern_room', 'tavern_storeroom'];

/** The eight offsets around a cell. */
const AROUND: Cell[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

/** A plan for every place type, over a spread of seeds. */
function everyPlan(seeds = 25): { placeType: PlaceType; seed: number; floorplan: Floorplan }[] {
  const plans = [];
  for (const placeType of PLACE_TYPES) {
    const profile = profileFor(placeType);
    for (let seed = 0; seed < seeds; seed += 1) {
      const params = paramsFor(placeType, { size: profile.maxSize, doorCount: 2 });
      plans.push({
        placeType,
        seed,
        floorplan: buildFloorplan(params, profile, createRng(seed)).floorplan,
      });
    }
  }
  return plans;
}

describe('planFrom', () => {
  it('rejects ragged art, which would read past a short row as neither wall nor floor', () => {
    expect(() =>
      planFrom([
        '###',
        '#.',
        '###',
      ]),
    ).toThrow('row 1 is 2 characters, expected 3');
  });

  it('rejects a door with no single floor cell to face away from', () => {
    expect(() =>
      planFrom([
        '###',
        'D.#',
        '###',
      ]).doors,
    ).not.toThrow();
    expect(() =>
      planFrom([
        '###',
        '#D#',
        '###',
      ]),
    ).toThrow('faces nowhere in particular');
  });

  it('points a door away from the floor beside it', () => {
    const plan = planFrom([
      '#D#',
      '#.#',
      '###',
    ]);
    expect(plan.doors).toEqual([{ cell: { x: 1, y: 0 }, facing: 'n' }]);
  });
});

describe('opposite', () => {
  it('pairs each facing with the one across from it', () => {
    expect(opposite('n')).toBe('s');
    expect(opposite('s')).toBe('n');
    expect(opposite('e')).toBe('w');
    expect(opposite('w')).toBe('e');
  });
});

describe('segmentWalls', () => {
  /** The cells a segment spans. Segments are axis-aligned by contract. */
  function segmentCells(from: Cell, to: Cell): Cell[] {
    const cells: Cell[] = [];
    for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y += 1) {
      for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x += 1) {
        cells.push({ x, y });
      }
    }
    return cells;
  }

  it('cuts a plain room into its four sides', () => {
    const cells = planFrom([
      '####',
      '#..#',
      '####',
    ]).cells;
    expect(segmentWalls(cells, { w: 4, h: 3 })).toEqual([
      { from: { x: 0, y: 0 }, to: { x: 3, y: 0 } },
      { from: { x: 0, y: 2 }, to: { x: 3, y: 2 } },
      { from: { x: 0, y: 1 }, to: { x: 0, y: 1 } },
      { from: { x: 3, y: 1 }, to: { x: 3, y: 1 } },
    ]);
  });

  it('covers every wall cell exactly once, over every generated plan', () => {
    for (const { placeType, seed, floorplan } of everyPlan()) {
      const counted = new Map<string, number>();
      for (const segment of floorplan.walls) {
        expect(segment.from.x === segment.to.x || segment.from.y === segment.to.y).toBe(true);
        for (const cell of segmentCells(segment.from, segment.to)) {
          expect(cellAt(floorplan.cells, cell)).toBe('wall');
          counted.set(cellKey(cell), (counted.get(cellKey(cell)) ?? 0) + 1);
        }
      }
      for (const [key, times] of counted) {
        expect(`${placeType}/${seed} ${key} x${times}`).toBe(`${placeType}/${seed} ${key} x1`);
      }
      const walls = floorplan.cells.flat().filter((kind) => kind === 'wall').length;
      expect(counted.size).toBe(walls);
    }
  });
});

describe('the derived wall contour', () => {
  it('closes: no floor cell ever touches the void or the edge of the grid', () => {
    // This is what "walls are derived from the footprint" buys. A per-cell
    // sampler would leave a gap here every so often, and the room would spill
    // into nothing at that one square.
    // One assertion, not one per neighbour. The inner loop runs hundreds of
    // thousands of times across every plan; an `expect` with an interpolated
    // string and a regex in there costs enough to time the test out under
    // worker contention, which made the suite flaky without ever being wrong.
    const spills: string[] = [];
    for (const { placeType, seed, floorplan } of everyPlan()) {
      for (const cell of floorCells(floorplan)) {
        for (const offset of AROUND) {
          const neighbor = { x: cell.x + offset.x, y: cell.y + offset.y };
          const kind: CellKind | 'off-grid' = inBounds(neighbor, floorplan.size)
            ? cellAt(floorplan.cells, neighbor)
            : 'off-grid';
          if (kind === 'void' || kind === 'off-grid') {
            spills.push(`${placeType}/${seed} ${cellKey(neighbor)}: ${kind}`);
          }
        }
      }
    }
    expect(spills).toEqual([]);
  });

  it('leaves no wall cell stranded away from the floor', () => {
    for (const { floorplan } of everyPlan(10)) {
      for (let y = 0; y < floorplan.size.h; y += 1) {
        for (let x = 0; x < floorplan.size.w; x += 1) {
          const cell = { x, y };
          if (cellAt(floorplan.cells, cell) !== 'wall') {
            continue;
          }
          const touchesFloor = AROUND.some((offset) => {
            const neighbor = { x: x + offset.x, y: y + offset.y };
            return (
              inBounds(neighbor, floorplan.size) &&
              cellAt(floorplan.cells, neighbor) === 'floor'
            );
          });
          expect(touchesFloor).toBe(true);
        }
      }
    }
  });
});

describe('doorCandidates', () => {
  const room = planFrom([
    '#####',
    '#...#',
    '#...#',
    '#...#',
    '#####',
  ]);

  it('takes every wall cell with one floor cell behind it and open air in front', () => {
    const found = doorCandidates(room.cells, room.size);
    expect(found).toHaveLength(12);
  });

  it('never offers a corner, which has no jamb on one side', () => {
    const keys = doorCandidates(room.cells, room.size).map((c) => cellKey(c.cell));
    for (const corner of ['0,0', '4,0', '0,4', '4,4']) {
      expect(keys).not.toContain(corner);
    }
  });

  it('measures how far each cell sits from the end of its own wall run', () => {
    const top = doorCandidates(room.cells, room.size)
      .filter((c) => c.facing === 'n')
      .sort((a, b) => a.cell.x - b.cell.x);
    expect(top.map((c) => c.setback)).toEqual([0, 1, 0]);
  });

  it('refuses the inside corner of an L, which faces two rooms at once', () => {
    const plan = planFrom([
      '####  ',
      '#..###',
      '#....#',
      '######',
    ]);
    const keys = doorCandidates(plan.cells, plan.size).map((c) => cellKey(c.cell));
    expect(keys).not.toContain('3,1');
  });

  it('refuses a wall shared between two rooms, which faces both of them', () => {
    const plan = planFrom([
      '#####',
      '#.#.#',
      '#.#.#',
      '#####',
    ]);
    const keys = doorCandidates(plan.cells, plan.size).map((c) => cellKey(c.cell));
    expect(keys).not.toContain('2,1');
    expect(keys).not.toContain('2,2');
  });

  it('refuses a wall with more building on its far side rather than open air', () => {
    // Two rooms with a wall two cells thick between them. Cell (2,1) has one
    // room behind it and solid wall in front, so a door there would open into
    // masonry. Nothing about its own neighbours gives that away — only the
    // cell it would lead onto does.
    const plan = planFrom([
      '######',
      '#.##.#',
      '#.##.#',
      '######',
    ]);
    const keys = doorCandidates(plan.cells, plan.size).map((c) => cellKey(c.cell));
    expect(keys).not.toContain('2,1');
    expect(keys).not.toContain('3,1');
    expect(keys).not.toContain('2,2');
    expect(keys).not.toContain('3,2');
  });

  it('refuses a stub of wall with nothing beside it to hang a door on', () => {
    // A door needs a jamb on both sides. The wall cell at the top has open
    // air to its left and its right: a door there would be a frame standing
    // on its own in the middle of nowhere.
    const plan = planFrom([
      '  #  ',
      '  .  ',
      '#####',
    ]);
    expect(doorCandidates(plan.cells, plan.size).map((c) => cellKey(c.cell))).toEqual(['2,2']);
  });

  it('breaks a run where the wall stops, rather than measuring across the gap', () => {
    // A T puts two south-facing runs on one line, one either side of the
    // stem. The five-cell room every other test here uses has a single run
    // per side, so nothing exercised the break — and joining the two would
    // measure each cell's setback through the hole. The cells next to the
    // stem would come out as the middle of a long wall and a door could land
    // in an inside corner.
    const tee = planFrom([
      '#############',
      '#...........#',
      '#...........#',
      '#####...#####',
      '    #...#    ',
      '    #...#    ',
      '    #####    ',
    ]);

    const southOfTheBand = doorCandidates(tee.cells, tee.size)
      .filter((candidate) => candidate.facing === 's' && candidate.cell.y === 3)
      .sort((a, b) => a.cell.x - b.cell.x);

    expect(southOfTheBand.map((candidate) => candidate.cell.x)).toEqual([1, 2, 3, 9, 10, 11]);
    // Two runs of three: 0, 1, 0 and 0, 1, 0. Joined into one run of six it
    // would read 0, 1, 2, 2, 1, 0, and x=3 and x=9 — the cells hard against
    // the stem — would claim the full two-cell setback from a corner.
    expect(southOfTheBand.map((candidate) => candidate.setback)).toEqual([0, 1, 0, 0, 1, 0]);
  });

  it('finds nothing in a plan with no wall at all', () => {
    const plan = planFrom([
      '...',
      '...',
    ]);
    expect(doorCandidates(plan.cells, plan.size)).toEqual([]);
  });
});

describe('placeDoors', () => {
  it('sets a door back from the corner when the wall is long enough', () => {
    const plan = planFrom([
      '#########',
      '#.......#',
      '#.......#',
      '#.......#',
      '#########',
    ]);
    for (let seed = 0; seed < 30; seed += 1) {
      const [door] = placeDoors(plan.cells, plan.size, 1, createRng(seed));
      const match = doorCandidates(plan.cells, plan.size).find(
        (c) => cellKey(c.cell) === cellKey(door.cell),
      );
      expect(match?.setback).toBeGreaterThanOrEqual(2);
    }
  });

  it('relaxes the setback rather than leaving a room with no way in', () => {
    // A one-cell closet has no wall run long enough for a door set two cells
    // clear of the corner. A room with no door is worse than a door in a
    // short wall, so the rule gives way and the door stays.
    const closet = planFrom([
      '###',
      '#.#',
      '###',
    ]);
    const doors = placeDoors(closet.cells, closet.size, 1, createRng(4));
    expect(doors).toHaveLength(1);
    expect(cellAt(closet.cells, doors[0].cell)).toBe('wall');
  });

  it('spreads two doors apart instead of putting them side by side', () => {
    const plan = planFrom([
      '#########',
      '#.......#',
      '#.......#',
      '#.......#',
      '#.......#',
      '#.......#',
      '#########',
    ]);
    for (let seed = 0; seed < 30; seed += 1) {
      const [a, b] = placeDoors(plan.cells, plan.size, 2, createRng(seed));
      const apart = Math.max(Math.abs(a.cell.x - b.cell.x), Math.abs(a.cell.y - b.cell.y));
      expect(`seed ${seed}: ${apart}`).toBe(`seed ${seed}: ${apart >= 4 ? apart : 'too close'}`);
    }
  });

  it('gives back fewer doors than asked rather than repeating one', () => {
    const closet = planFrom([
      '###',
      '#.#',
      '###',
    ]);
    const doors = placeDoors(closet.cells, closet.size, 9, createRng(1));
    expect(doors).toHaveLength(4);
    expect(new Set(doors.map((door) => cellKey(door.cell))).size).toBe(4);
  });

  it('refuses a plan no door can open onto', () => {
    // Open ground with no wall anywhere. Returning an empty door list would
    // push the failure downstream into a map nobody can enter.
    const plan = planFrom([
      '...',
      '...',
    ]);
    expect(() => placeDoors(plan.cells, plan.size, 1, createRng(1))).toThrow(
      'no wall cell of the 3x2 plan can hold a door',
    );
  });
});

describe('buildFloorplan', () => {
  it('always opens at least one door', () => {
    for (const { placeType, seed, floorplan } of everyPlan()) {
      expect(`${placeType}/${seed}: ${floorplan.doors.length}`).not.toBe(
        `${placeType}/${seed}: 0`,
      );
    }
  });

  it('puts every door in an external wall, facing out of the building', () => {
    for (const { floorplan } of everyPlan()) {
      for (const door of floorplan.doors) {
        expect(cellAt(floorplan.cells, door.cell)).toBe('wall');

        const outward = step(door.cell, door.facing);
        const outside =
          !inBounds(outward, floorplan.size) || cellAt(floorplan.cells, outward) === 'void';
        expect(outside).toBe(true);

        expect(cellAt(floorplan.cells, step(door.cell, opposite(door.facing)))).toBe('floor');
      }
    }
  });

  it('never places two doors on the same cell', () => {
    for (const { floorplan } of everyPlan()) {
      const keys = floorplan.doors.map((door) => cellKey(door.cell));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('opens as many doors as the params ask for, held inside the profile range', () => {
    for (const placeType of PLACE_TYPES) {
      const profile = profileFor(placeType);
      for (const doorCount of [0, 1, 2, 7]) {
        const params = paramsFor(placeType, { size: profile.maxSize, doorCount });
        const { floorplan } = buildFloorplan(params, profile, createRng(9));
        expect(floorplan.doors).toHaveLength(clampDoorCount(doorCount, profile));
      }
    }
  });

  it('holds an out-of-range size inside the profile, and so inside 20 cells', () => {
    const profile = profileFor('tavern_hall');
    const params = paramsFor('tavern_hall', { size: { w: 400, h: 1 } });
    const { floorplan } = buildFloorplan(params, profile, createRng(2));
    expect(floorplan.size).toEqual(clampSize(params.size, profile));
    expect(floorplan.cells).toHaveLength(floorplan.size.h);
    expect(floorplan.cells[0]).toHaveLength(floorplan.size.w);
  });

  it('hands back the grammar regions stage two segments into zones', () => {
    const profile = profileFor('tavern_hall');
    const { regions, floorplan } = buildFloorplan(
      paramsFor('tavern_hall', { size: profile.maxSize }),
      profile,
      createRng(5),
    );
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(region.x).toBeGreaterThanOrEqual(1);
      expect(region.x + region.w).toBeLessThanOrEqual(floorplan.size.w - 1);
      expect(region.y).toBeGreaterThanOrEqual(1);
      expect(region.y + region.h).toBeLessThanOrEqual(floorplan.size.h - 1);
    }
  });

  it('varies the plan from seed to seed', () => {
    const profile = profileFor('tavern_hall');
    const params = paramsFor('tavern_hall', { size: profile.maxSize });
    const plans = new Set<string>();
    for (let seed = 0; seed < 20; seed += 1) {
      plans.add(JSON.stringify(buildFloorplan(params, profile, createRng(seed)).floorplan.cells));
    }
    expect(plans.size).toBeGreaterThan(1);
  });
});

describe('the features stage one answers to', () => {
  /** Whether any wall cell has floor on all four sides — that is a pillar. */
  function hasPillar(floorplan: Floorplan): boolean {
    for (let y = 0; y < floorplan.size.h; y += 1) {
      for (let x = 0; x < floorplan.size.w; x += 1) {
        const cell = { x, y };
        if (cellAt(floorplan.cells, cell) !== 'wall') {
          continue;
        }
        const enclosed = (['n', 'e', 's', 'w'] as const).every((facing) => {
          const next = step(cell, facing);
          return (
            inBounds(next, floorplan.size) && cellAt(floorplan.cells, next) === 'floor'
          );
        });
        if (enclosed) {
          return true;
        }
      }
    }
    return false;
  }

  it('cuts an alcove into the plan when one is asked for', () => {
    const profile = profileFor('tavern_hall');
    for (let seed = 0; seed < 20; seed += 1) {
      const params = paramsFor('tavern_hall', { size: profile.maxSize, features: ['alcove'] });
      const { regions } = buildFloorplan(params, profile, createRng(seed));
      expect(`seed ${seed}: ${regions.length} region(s)`).toBe(`seed ${seed}: 2 region(s)`);
    }
  });

  it('grows pillars in a hall when they are asked for', () => {
    const profile = profileFor('tavern_hall');
    for (let seed = 0; seed < 20; seed += 1) {
      const params = paramsFor('tavern_hall', { size: profile.maxSize, features: ['pillars'] });
      const { floorplan } = buildFloorplan(params, profile, createRng(seed));
      expect(`seed ${seed}: ${hasPillar(floorplan)}`).toBe(`seed ${seed}: true`);
    }
  });

  it('never grows a pillar in a place whose profile forbids them', () => {
    for (const placeType of ['tavern_room', 'tavern_storeroom'] as PlaceType[]) {
      const profile = profileFor(placeType);
      expect(profile.allowPillars).toBe(false);
      for (let seed = 0; seed < 20; seed += 1) {
        const params = paramsFor(placeType, { size: profile.maxSize, features: ['pillars'] });
        const { floorplan } = buildFloorplan(params, profile, createRng(seed));
        expect(`${placeType}/${seed}: ${hasPillar(floorplan)}`).toBe(`${placeType}/${seed}: false`);
      }
    }
  });
});
