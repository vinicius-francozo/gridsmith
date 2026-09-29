import { describe, expect, it } from 'vitest';

import { cellAt, cellKey } from '../core/grid';
import { createRng } from '../core/prng';
import type { Place, Rng } from '../core/types';
import { buildFloorplan, floorCells } from './floorplan';
import { paintMaterials, segmentZones } from './materials';
import {
  MATERIALS,
  materialDef,
  profileFor,
  ROTATIONS,
  VOID_MATERIAL,
  wallMaterialFor,
} from './profiles';
import type { Rect } from './shapes';
import { maxRng, minRng, paramsFor } from './test-fixtures';

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
