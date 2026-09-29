import { describe, expect, it } from 'vitest';

import { cellAt, cellKey } from '../core/grid';
import { createRng } from '../core/prng';
import type { Floorplan, Place, Rng } from '../core/types';
import { buildFloorplan, floorCells } from './floorplan';
import { isPillar, paintMaterials, segmentZones } from './materials';
import {
  MATERIALS,
  materialDef,
  profileFor,
  ROTATIONS,
  VOID_MATERIAL,
  wallMaterialFor,
} from './profiles';
import type { ShapeName } from './profiles';
import { validateScene } from './validate';
import { rectContains } from './shapes';
import type { Rect } from './shapes';
import { maxRng, minRng, paramsFor, planFrom, sceneFrom } from './test-fixtures';

const PLACE_TYPES: Place[] = [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'tavern', room: 'storeroom' }];

/** A plan and the tiles painted over it, for one place type and seed. */
function painted(place: Place, seed: number, rngFor: (s: number) => Rng = createRng) {
  const profile = profileFor(place);
  const params = paramsFor(place, { size: profile.maxSize, doorCount: 2 });
  const rng = rngFor(seed);
  const { floorplan, regions } = buildFloorplan(params, profile, rng);
  return { profile, floorplan, ...paintMaterials(floorplan, regions, profile, rng) };
}

describe('segmentZones', () => {
  const big: Rect = { x: 1, y: 1, w: 12, h: 10 };

  it('leaves the regions alone when the profile has a single floor material', () => {
    // Splitting a zone only to paint both halves the same colour would draw a
    // seam nobody can see and cost a draw from the rng.
    const room = profileFor({ building: 'tavern', room: 'room' });
    expect(room.floorMaterials).toHaveLength(1);
    expect(segmentZones([big], room, minRng())).toEqual([big]);
  });

  it('cuts a large region in two across its longer side', () => {
    const cut = segmentZones([big], profileFor({ building: 'tavern', room: 'hall' }), minRng());
    expect(cut).toEqual([
      { x: 1, y: 1, w: 4, h: 10 },
      { x: 5, y: 1, w: 8, h: 10 },
    ]);
  });

  it('leaves a small region whole', () => {
    const small: Rect = { x: 1, y: 1, w: 4, h: 4 };
    expect(segmentZones([small], profileFor({ building: 'tavern', room: 'hall' }), minRng())).toEqual([small]);
  });

  it('stops cutting once the room would carry more seams than the ceiling', () => {
    const hall = profileFor({ building: 'tavern', room: 'hall' });
    expect(segmentZones([big, big, big], hall, maxRng())).toHaveLength(4);
  });

  it('hands back every region it was given, even past the ceiling', () => {
    // Dropping a region would leave its cells in no zone at all, and they
    // would then be painted as though they belonged to a zone elsewhere.
    const many = [big, big, big, big, big];
    expect(segmentZones(many, profileFor({ building: 'tavern', room: 'hall' }), maxRng())).toEqual(many);
  });

  it('keeps every cut inside the region it came from', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      for (const rect of segmentZones([big], profileFor({ building: 'tavern', room: 'hall' }), createRng(seed))) {
        expect(rect.x).toBeGreaterThanOrEqual(big.x);
        expect(rect.y).toBeGreaterThanOrEqual(big.y);
        expect(rect.x + rect.w).toBeLessThanOrEqual(big.x + big.w);
        expect(rect.y + rect.h).toBeLessThanOrEqual(big.y + big.h);
        expect(rect.w).toBeGreaterThan(0);
        expect(rect.h).toBeGreaterThan(0);
      }
    }
  });
});

describe('zones', () => {
  it('partition the floor: every floor cell in exactly one zone, and nothing else', () => {
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { floorplan, zones } = painted(place, seed);
        const counted = new Map<string, number>();
        for (const zone of zones) {
          for (const cell of zone.cells) {
            expect(cellAt(floorplan.cells, cell)).toBe('floor');
            counted.set(cellKey(cell), (counted.get(cellKey(cell)) ?? 0) + 1);
          }
        }
        for (const [key, times] of counted) {
          expect(`${place}/${seed} ${key} x${times}`).toBe(`${place}/${seed} ${key} x1`);
        }
        expect(counted.size).toBe(floorCells(floorplan).length);
      }
    }
  });

  it('name a material from their own profile', () => {
    for (const place of PLACE_TYPES) {
      const { profile, zones } = painted(place, 3);
      for (const zone of zones) {
        expect(profile.floorMaterials).toContain(zone.material);
      }
    }
  });

  it('do not paint two neighbouring zones the same material', () => {
    // The seam between two zones is the whole reason for segmenting the
    // room; painting both halves alike erases it.
    const { zones } = painted({ building: 'tavern', room: 'hall' }, 6);
    expect(zones.length).toBeGreaterThan(1);
    for (let i = 1; i < zones.length; i += 1) {
      expect(zones[i].material).not.toBe(zones[i - 1].material);
    }
  });
});

describe('tiles', () => {
  it('cover every cell of the grid, wall and void included', () => {
    // `Scene.tiles` is total by contract: the renderer indexes it for every
    // cell it draws and has no null to fall back on.
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 10; seed += 1) {
        const { floorplan, tiles } = painted(place, seed);
        expect(tiles).toHaveLength(floorplan.size.h);
        for (let y = 0; y < floorplan.size.h; y += 1) {
          expect(tiles[y]).toHaveLength(floorplan.size.w);
          for (let x = 0; x < floorplan.size.w; x += 1) {
            const tile = cellAt(tiles, { x, y });
            expect(Object.keys(MATERIALS)).toContain(tile.material);
            expect(ROTATIONS).toContain(tile.rotation);
            expect(tile.variant).toBeGreaterThanOrEqual(0);
            expect(tile.variant).toBeLessThan(materialDef(tile.material).variants);
          }
        }
      }
    }
  });

  it('give a floor cell the material of the zone that owns it', () => {
    for (const place of PLACE_TYPES) {
      const { zones, tiles } = painted(place, 8);
      for (const zone of zones) {
        for (const cell of zone.cells) {
          expect(cellAt(tiles, cell).material).toBe(zone.material);
        }
      }
    }
  });

  it('give a void cell the void material and nothing else', () => {
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 10; seed += 1) {
        const { floorplan, tiles } = painted(place, seed);
        for (let y = 0; y < floorplan.size.h; y += 1) {
          for (let x = 0; x < floorplan.size.w; x += 1) {
            const cell = { x, y };
            if (cellAt(floorplan.cells, cell) === 'void') {
              expect(cellAt(tiles, cell).material).toBe(VOID_MATERIAL);
            } else {
              expect(cellAt(tiles, cell).material).not.toBe(VOID_MATERIAL);
            }
          }
        }
      }
    }
  });

  it('give a wall cell some wall material of its own profile, never a floor one', () => {
    for (const place of PLACE_TYPES) {
      const { profile, floorplan, tiles } = painted(place, 12);
      const walls = new Set(Object.values(profile.wallMaterials));
      walls.add(profile.defaultWallMaterial);
      // A pillar is a wall cell too, and the one wall cell that is allowed a
      // material of its own. The rule being checked here is that no wall ever
      // takes a *floor* material.
      walls.add(profile.pillarMaterial);
      for (let y = 0; y < floorplan.size.h; y += 1) {
        for (let x = 0; x < floorplan.size.w; x += 1) {
          const cell = { x, y };
          if (cellAt(floorplan.cells, cell) === 'wall') {
            expect([...walls]).toContain(cellAt(tiles, cell).material);
          }
        }
      }
    }
  });

  it('give a wall cell the wall material of the zone it actually borders', () => {
    // Membership of the profile's set of wall materials is not the rule: the
    // set contains the default, so painting every wall the default satisfies
    // it. The rule is timber around the plank and stone around the flagstone,
    // and only the hall has two of each to tell apart.
    const profile = profileFor({ building: 'tavern', room: 'hall' });
    expect(new Set(Object.values(profile.wallMaterials)).size).toBeGreaterThan(1);

    const exercised = new Set<string>();
    for (let seed = 0; seed < 15; seed += 1) {
      const { floorplan, zones, tiles } = painted({ building: 'tavern', room: 'hall' }, seed);
      const zoneMaterial = new Map<string, string>();
      for (const zone of zones) {
        for (const cell of zone.cells) {
          zoneMaterial.set(cellKey(cell), zone.material);
        }
      }

      for (let y = 0; y < floorplan.size.h; y += 1) {
        for (let x = 0; x < floorplan.size.w; x += 1) {
          const cell = { x, y };
          if (cellAt(floorplan.cells, cell) !== 'wall') {
            continue;
          }
          // A pillar borders a zone on every side and takes none of their
          // wall materials; it is answered by its own test below.
          if (isPillar(floorplan.cells, floorplan.size, cell)) {
            continue;
          }
          // Only walls facing one zone across their four sides. A wall
          // wedged between two zones is answered by the implementation's
          // tie-break, which is not what this test is about.
          const beside = new Set(
            [
              { x, y: y - 1 },
              { x: x + 1, y },
              { x, y: y + 1 },
              { x: x - 1, y },
            ]
              .map((neighbour) => zoneMaterial.get(cellKey(neighbour)))
              .filter((material): material is string => material !== undefined),
          );
          if (beside.size !== 1) {
            continue;
          }
          const [floorMaterial] = [...beside];
          const expected = wallMaterialFor(floorMaterial, profile);
          exercised.add(expected);
          expect(
            `${seed} ${cellKey(cell)} beside ${floorMaterial}: ${cellAt(tiles, cell).material}`,
          ).toBe(`${seed} ${cellKey(cell)} beside ${floorMaterial}: ${expected}`);
        }
      }
    }

    // Both halves of the rule have to have been reached, or the loop above
    // proves only that one wall material is used everywhere.
    expect([...exercised].sort()).toEqual(['stone_wall', 'timber_wall']);
  });

  it('does not share one tile object between two void cells', () => {
    // A shared object would let a consumer that edits one void cell change
    // every other one, and the bug would surface as a map, not as an error.
    const { floorplan, tiles } = painted({ building: 'tavern', room: 'hall' }, 0);
    const voids = [];
    for (let y = 0; y < floorplan.size.h; y += 1) {
      for (let x = 0; x < floorplan.size.w; x += 1) {
        if (cellAt(floorplan.cells, { x, y }) === 'void') {
          voids.push(cellAt(tiles, { x, y }));
        }
      }
    }
    expect(voids.length).toBeGreaterThan(1);
    expect(voids[0]).not.toBe(voids[1]);
  });

  it('never spins a material whose grain runs one way', () => {
    // Plank floors have a direction. Rotating them at random is exactly the
    // per-cell noise stage two exists to avoid.
    expect(materialDef('wood_plank').rotatable).toBe(false);
    for (let seed = 0; seed < 10; seed += 1) {
      const { tiles } = painted({ building: 'tavern', room: 'room' }, seed);
      for (const row of tiles) {
        for (const tile of row) {
          if (tile.material === 'wood_plank') {
            expect(tile.rotation).toBe(0);
          }
        }
      }
    }
  });

  it('does spin a material that reads the same either way', () => {
    expect(materialDef('flagstone').rotatable).toBe(true);
    const seen = new Set<number>();
    for (let seed = 0; seed < 10; seed += 1) {
      for (const row of painted({ building: 'tavern', room: 'hall' }, seed).tiles) {
        for (const tile of row) {
          if (tile.material === 'flagstone') {
            seen.add(tile.rotation);
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('draws more than one variant of a material across a room', () => {
    const seen = new Set<number>();
    for (const row of painted({ building: 'tavern', room: 'room' }, 1).tiles) {
      for (const tile of row) {
        if (tile.material === 'wood_plank') {
          seen.add(tile.variant);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

// --- Pillars ---------------------------------------------------------------
//
// Stage one grows free-standing pillars and then throws away the fact that it
// did: `growPillars` marks them `'void'` and `deriveWalls` turns them into
// `'wall'` like any other cell that touches floor. Stage two used to paint
// every wall with the material of the zone it borders, so a pillar came out in
// the perimeter's own colour and the person looking at the PNG reported that
// the pillars he had asked for were missing. They were not missing; they were
// invisible.

/** The plans below are drawn small so the cell each test is about is visible. */
const PILLAR_IN_THE_OPEN = [
  '#######',
  '#.....#',
  '#..#..#',
  '#.....#',
  '###D###',
];

const PILLAR_AGAINST_THE_WALL = [
  '#######',
  '#.....#',
  '##....#',
  '#.....#',
  '###D###',
];

const INSIDE_CORNER = [
  '#####D##',
  '#......#',
  '#......#',
  '#...####',
  '#...#   ',
  '#...#   ',
  '#####   ',
];

describe('isPillar', () => {
  it('names the free-standing column in the middle of a room', () => {
    const plan = planFrom(PILLAR_IN_THE_OPEN);
    expect(cellAt(plan.cells, { x: 3, y: 2 })).toBe('wall');
    expect(isPillar(plan.cells, plan.size, { x: 3, y: 2 })).toBe(true);
  });

  it('names a column that grew flush against the perimeter', () => {
    // Not a corner case invented for the test: with a `t_shape` or an
    // `alcove` footprint the grammar puts the floor's edge exactly where
    // stage one wants a pillar, and three of its four sides face floor. A
    // rule that asked for all four would leave those unpainted.
    const plan = planFrom(PILLAR_AGAINST_THE_WALL);
    expect(isPillar(plan.cells, plan.size, { x: 1, y: 2 })).toBe(true);
  });

  it('names nothing else in either plan', () => {
    for (const rows of [PILLAR_IN_THE_OPEN, PILLAR_AGAINST_THE_WALL]) {
      const plan = planFrom(rows);
      const found: string[] = [];
      for (let y = 0; y < plan.size.h; y += 1) {
        for (let x = 0; x < plan.size.w; x += 1) {
          if (isPillar(plan.cells, plan.size, { x, y })) {
            found.push(cellKey({ x, y }));
          }
        }
      }
      expect(found).toHaveLength(1);
    }
  });

  it('does not name the inside corner of an L-shaped plan', () => {
    // The trap. An inside corner faces floor on two of its four sides, and on
    // *five* of its eight once diagonals are counted — so a rule written over
    // the eight neighbours selects it, and selects every straight run of
    // perimeter with it.
    const plan = planFrom(INSIDE_CORNER);
    expect(cellAt(plan.cells, { x: 4, y: 3 })).toBe('wall');
    expect(isPillar(plan.cells, plan.size, { x: 4, y: 3 })).toBe(false);
    for (let y = 0; y < plan.size.h; y += 1) {
      for (let x = 0; x < plan.size.w; x += 1) {
        expect(`${cellKey({ x, y })}: ${isPillar(plan.cells, plan.size, { x, y })}`)
          .toBe(`${cellKey({ x, y })}: false`);
      }
    }
  });

  it('names neither floor nor void, whatever they are surrounded by', () => {
    const plan = planFrom(PILLAR_IN_THE_OPEN);
    expect(isPillar(plan.cells, plan.size, { x: 2, y: 2 })).toBe(false);
    expect(isPillar(planFrom(INSIDE_CORNER).cells, { w: 8, h: 7 }, { x: 6, y: 5 })).toBe(false);
  });
});

/** Where `growPillars` puts its four columns, and which of them became one. */
function grownPillars(floorplan: Floorplan, regions: Rect[]): string[] {
  const interior = { x: 1, y: 1, w: floorplan.size.w - 2, h: floorplan.size.h - 2 };
  const found: string[] = [];
  for (const x of [interior.x + 2, interior.x + interior.w - 3]) {
    for (const y of [interior.y + 2, interior.y + interior.h - 3]) {
      // A spot the footprint left outside the room was never turned into a
      // pillar — `growPillars` only marks a cell that was floor — though it
      // may well have become perimeter wall, which is why both halves matter.
      if (regions.some((region) => rectContains(region, x, y)) &&
          cellAt(floorplan.cells, { x, y }) === 'wall') {
        found.push(cellKey({ x, y }));
      }
    }
  }
  return found;
}

describe('pillars on a generated plan', () => {
  const SHAPES: ShapeName[] = ['rectangle', 'l_shape', 't_shape', 'alcove'];
  const HALLS: Place[] = [{ building: 'tavern', room: 'hall' }, { building: 'dungeon', room: 'hall' }];

  it('paints every grown pillar in the profile material, and paints nothing else in it', () => {
    // Driven over all four footprint shapes because that is where the rule
    // could go wrong: a rectangle has no inside corner to mistake for a
    // pillar and no floor edge for a pillar to grow against, and a test
    // written only against one would pass on a rule that fails on the other
    // three.
    for (const place of HALLS) {
      const base = profileFor(place);
      for (const shape of SHAPES) {
        const profile = { ...base, shapes: [shape] };
        let seen = 0;
        for (let seed = 0; seed < 30; seed += 1) {
          const params = paramsFor(place, {
            size: base.maxSize, doorCount: 2, features: ['pillars'],
          });
          const rng = createRng(seed);
          const { floorplan, regions } = buildFloorplan(params, profile, rng);
          const { tiles } = paintMaterials(floorplan, regions, profile, rng);
          const grown = new Set(grownPillars(floorplan, regions));
          seen += grown.size;

          const painted: string[] = [];
          for (let y = 0; y < floorplan.size.h; y += 1) {
            for (let x = 0; x < floorplan.size.w; x += 1) {
              if (cellAt(tiles, { x, y }).material === profile.pillarMaterial) {
                painted.push(cellKey({ x, y }));
              }
            }
          }
          expect(`${place.building} ${shape}/${seed}: ${painted.sort().join(' ')}`)
            .toBe(`${place.building} ${shape}/${seed}: ${[...grown].sort().join(' ')}`);
        }
        // Or the loop above proved only that nothing at all was painted.
        expect(`${place.building} ${shape}: ${seen > 0}`).toBe(`${place.building} ${shape}: true`);
      }
    }
  });

  it('paints a pillar in something no wall of the same profile is painted in', () => {
    for (const place of HALLS) {
      const profile = profileFor(place);
      const walls = [...Object.values(profile.wallMaterials), profile.defaultWallMaterial];
      expect(`${place.building}: ${walls.includes(profile.pillarMaterial)}`)
        .toBe(`${place.building}: false`);
    }
  });
});

describe('a painted pillar is still a wall', () => {
  // Sub-task 1.4, and the one thing about this front that is not negotiable.
  // Pillars hold the room up in the fiction and block movement in the rules,
  // and the validation pass reads `Floorplan.cells` rather than the tiles. A
  // pillar that stopped being `'wall'` would still look right and would let
  // the generator emit a plan nobody can walk.

  it('leaves every cell of the plan exactly as stage one left it', () => {
    const place: Place = { building: 'dungeon', room: 'hall' };
    const profile = profileFor(place);
    const params = paramsFor(place, { size: profile.maxSize, doorCount: 2, features: ['pillars'] });
    const rng = createRng(4);
    const { floorplan, regions } = buildFloorplan(params, profile, rng);
    const grown = grownPillars(floorplan, regions);
    expect(grown.length).toBeGreaterThan(0);

    const before = JSON.stringify(floorplan.cells);
    paintMaterials(floorplan, regions, profile, rng);
    expect(JSON.stringify(floorplan.cells)).toBe(before);
    for (const key of grown) {
      const [x, y] = key.split(',').map(Number);
      expect(cellAt(floorplan.cells, { x, y })).toBe('wall');
      expect(floorCells(floorplan).map(cellKey)).not.toContain(key);
    }
  });

  it('still cuts the floor off, which is how the validation pass sees it', () => {
    // Four floor cells around one pillar, and a door onto one of them. Were
    // the pillar anything but a blocker the other three would be reachable;
    // as it is, the pass reports all three as cut off. This is the same read
    // of `cells` that `isolated_floor` and the circulation check are built
    // on, exercised on the smallest plan that can show it.
    const plan = planFrom([
      '##D##',
      '##.##',
      '#.#.#',
      '##.##',
      '#####',
    ]);
    expect(isPillar(plan.cells, plan.size, { x: 2, y: 2 })).toBe(true);
    const issues = validateScene(sceneFrom(plan));
    expect(issues.map((issue) => issue.kind)).toEqual([
      'isolated_floor', 'isolated_floor', 'isolated_floor',
    ]);
    expect(issues.map((issue) => cellKey(issue.cell!)).sort()).toEqual(['1,2', '2,3', '3,2']);
  });
});
