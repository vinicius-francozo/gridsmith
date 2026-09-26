import { describe, expect, it } from 'vitest';

import { createRng } from '../core/prng';
import type { PlaceType, Size } from '../core/types';
import {
  ALCOVE_FEATURE,
  clampDoorCount,
  clampSize,
  FEATURE_VOCABULARY,
  MATERIALS,
  materialDef,
  pickRotation,
  PILLARS_FEATURE,
  profileFor,
  ROTATIONS,
  wallMaterialFor,
} from './profiles';

const PLACE_TYPES: PlaceType[] = ['tavern_hall', 'tavern_room', 'tavern_storeroom'];

describe('profileFor', () => {
  it('has a profile for every place type', () => {
    for (const placeType of PLACE_TYPES) {
      expect(profileFor(placeType).placeType).toBe(placeType);
    }
  });

  it('rejects a place type it does not know', () => {
    // `Params` can arrive from a language model through JSON, where the type
    // system guarantees nothing. Without the guard the caller would get
    // `undefined` and fail several layers away, reading a property of it.
    expect(() => profileFor('dungeon_crypt' as PlaceType)).toThrow("unknown place type");
  });
});

describe('profile material vocabulary', () => {
  it('names only materials the catalogue declares', () => {
    for (const placeType of PLACE_TYPES) {
      const profile = profileFor(placeType);
      const named = [
        ...profile.floorMaterials,
        ...Object.values(profile.wallMaterials),
        profile.defaultWallMaterial,
      ];
      for (const material of named) {
        expect(Object.keys(MATERIALS)).toContain(material);
      }
    }
  });

  it('gives every floor material of a profile a wall counterpart', () => {
    for (const placeType of PLACE_TYPES) {
      const profile = profileFor(placeType);
      for (const floor of profile.floorMaterials) {
        expect(profile.wallMaterials[floor]).toBeDefined();
      }
    }
  });
});

describe('profile furniture', () => {
  it('keeps every anchor small enough to stand in the smallest room of its kind', () => {
    for (const placeType of PLACE_TYPES) {
      const profile = profileFor(placeType);
      // The interior is the footprint minus the wall ring on both sides.
      const interior: Size = { w: profile.minSize.w - 2, h: profile.minSize.h - 2 };
      for (const anchor of profile.anchors) {
        const longest = Math.max(anchor.footprint.w, anchor.footprint.h);
        expect(longest).toBeLessThanOrEqual(Math.max(interior.w, interior.h));
      }
    }
  });

  it('keeps every group part inside the box its offsets are measured in', () => {
    for (const placeType of PLACE_TYPES) {
      for (const group of profileFor(placeType).groups) {
        for (const part of group.parts) {
          expect(part.offset.x + part.footprint.w).toBeLessThanOrEqual(group.size.w);
          expect(part.offset.y + part.footprint.h).toBeLessThanOrEqual(group.size.h);
        }
      }
    }
  });

  it('gives every scatter prop a positive weight', () => {
    for (const placeType of PLACE_TYPES) {
      for (const spec of profileFor(placeType).scatter) {
        expect(spec.weight).toBeGreaterThan(0);
      }
    }
  });
});

describe('materialDef', () => {
  it('describes a declared material', () => {
    expect(materialDef('wood_plank').variants).toBeGreaterThan(0);
  });

  it('rejects a material the asset library would not know', () => {
    // A material nobody declared renders as nothing at all, and a map with an
    // invisible floor is far harder to diagnose than a thrown error.
    expect(() => materialDef('marble')).toThrow("unknown material 'marble'");
  });
});

describe('clampSize', () => {
  it('leaves a size already inside the profile alone', () => {
    const profile = profileFor('tavern_hall');
    expect(clampSize({ w: 14, h: 12 }, profile)).toEqual({ w: 14, h: 12 });
  });

  it('raises a size below the profile minimum', () => {
    const profile = profileFor('tavern_hall');
    expect(clampSize({ w: 3, h: 2 }, profile)).toEqual(profile.minSize);
  });

  it('lowers a size above the profile maximum, which is never past 20 cells', () => {
    const profile = profileFor('tavern_hall');
    const clamped = clampSize({ w: 99, h: 99 }, profile);
    expect(clamped).toEqual(profile.maxSize);
    expect(clamped.w).toBeLessThanOrEqual(20);
    expect(clamped.h).toBeLessThanOrEqual(20);
  });

  it('rounds a fractional size to whole cells', () => {
    expect(clampSize({ w: 13.4, h: 12.6 }, profileFor('tavern_hall'))).toEqual({ w: 13, h: 13 });
  });

  it('keeps every profile inside the twenty-cell ceiling of the project', () => {
    for (const placeType of PLACE_TYPES) {
      const profile = profileFor(placeType);
      expect(profile.maxSize.w).toBeLessThanOrEqual(20);
      expect(profile.maxSize.h).toBeLessThanOrEqual(20);
      expect(profile.minSize.w).toBeLessThanOrEqual(profile.maxSize.w);
      expect(profile.minSize.h).toBeLessThanOrEqual(profile.maxSize.h);
    }
  });
});

describe('clampDoorCount', () => {
  const profile = profileFor('tavern_hall');

  it('keeps a count inside the profile range', () => {
    expect(clampDoorCount(2, profile)).toBe(2);
  });

  it('never returns fewer than one door, whatever it is asked for', () => {
    // A room with no way in cannot be played, so zero is not an answer the
    // generator is allowed to give.
    expect(clampDoorCount(0, profile)).toBe(1);
    expect(clampDoorCount(-4, profile)).toBe(1);
  });

  it('caps a count above the profile range', () => {
    expect(clampDoorCount(9, profile)).toBe(profile.doorRange.max);
  });

  it('falls back to the profile minimum for a count that is not a number', () => {
    expect(clampDoorCount(Number.NaN, profile)).toBe(Math.max(1, profile.doorRange.min));
  });
});

describe('wallMaterialFor', () => {
  it('gives each floor material its declared wall', () => {
    const profile = profileFor('tavern_hall');
    expect(wallMaterialFor('wood_plank', profile)).toBe('timber_wall');
    expect(wallMaterialFor('flagstone', profile)).toBe('stone_wall');
  });

  it('falls back to the profile default for a floor material it has no pairing for', () => {
    const profile = profileFor('tavern_hall');
    expect(wallMaterialFor('dirt_floor', profile)).toBe(profile.defaultWallMaterial);
  });
});

describe('pickRotation', () => {
  it('only ever returns one of the four quarter turns', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i += 1) {
      expect(ROTATIONS).toContain(pickRotation(rng));
    }
  });

  it('reaches all four over a run, so rotation is not pinned to zero', () => {
    const rng = createRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      seen.add(pickRotation(rng));
    }
    expect(seen.size).toBe(4);
  });
});

describe('the feature vocabulary', () => {
  /**
   * The words the interpreter writes `Params.features` in, and the places
   * each one belongs to. Copied from `FEATURES` and `FEATURE_PLACES` in
   * `src/interpreter/vocabulary.ts`: the two fronts are separate worktrees,
   * so the agreement cannot be imported, only kept — and a word the
   * generator answers to nothing for is a request that disappears from the
   * map without an error anywhere.
   */
  const FEATURE_PLACES: Record<string, PlaceType[]> = {
    bar: ['tavern_hall'],
    hearth: ['tavern_hall', 'tavern_room'],
    stairs: ['tavern_hall', 'tavern_storeroom'],
    pillars: ['tavern_hall'],
    alcove: ['tavern_hall', 'tavern_room'],
    shelving: ['tavern_storeroom', 'tavern_room'],
    bunks: ['tavern_room'],
  };

  it('is the same seven words the interpreter writes', () => {
    expect([...FEATURE_VOCABULARY].sort()).toEqual(Object.keys(FEATURE_PLACES).sort());
  });

  it('answers to every word, either with an anchor or with the plan itself', () => {
    const byAnchor = new Set(
      PLACE_TYPES.flatMap((placeType) =>
        profileFor(placeType)
          .anchors.map((spec) => spec.feature)
          .filter((feature): feature is string => feature !== undefined),
      ),
    );
    for (const feature of FEATURE_VOCABULARY) {
      const answered =
        byAnchor.has(feature) || feature === ALCOVE_FEATURE || feature === PILLARS_FEATURE;
      expect(`${feature}: ${answered ? 'answered' : 'silently ignored'}`).toBe(
        `${feature}: answered`,
      );
    }
  });

  it('answers to each word in every place the interpreter offers it for', () => {
    for (const [feature, places] of Object.entries(FEATURE_PLACES)) {
      if (feature === ALCOVE_FEATURE || feature === PILLARS_FEATURE) {
        continue;
      }
      for (const placeType of places) {
        const anchors = profileFor(placeType).anchors.filter((spec) => spec.feature === feature);
        expect(`${placeType}/${feature}: ${anchors.length} anchor(s)`).not.toBe(
          `${placeType}/${feature}: 0 anchor(s)`,
        );
      }
    }
  });

  it('names no feature the interpreter would never send', () => {
    for (const placeType of PLACE_TYPES) {
      for (const spec of profileFor(placeType).anchors) {
        if (spec.feature !== undefined) {
          expect(FEATURE_VOCABULARY).toContain(spec.feature);
        }
      }
    }
  });
});

describe('the asset vocabulary the profiles declare', () => {
  /** Every (assetId, footprint) a profile names, wherever it names it. */
  function declarations(): { assetId: string; footprint: Size; where: string }[] {
    const found: { assetId: string; footprint: Size; where: string }[] = [];
    for (const placeType of PLACE_TYPES) {
      const profile = profileFor(placeType);
      for (const spec of profile.anchors) {
        found.push({ assetId: spec.assetId, footprint: spec.footprint, where: `${placeType} anchor` });
      }
      for (const group of profile.groups) {
        for (const part of group.parts) {
          found.push({
            assetId: part.assetId,
            footprint: part.footprint,
            where: `${placeType} group ${group.id}`,
          });
        }
      }
      for (const spec of profile.scatter) {
        found.push({ assetId: spec.assetId, footprint: { w: 1, h: 1 }, where: `${placeType} scatter` });
      }
    }
    return found;
  }

  it('gives one footprint to each asset id, never two', () => {
    // The asset library is indexed by id, and the renderer validates
    // `prop.footprint === rotateFootprint(def.footprint, prop.rotation)`. One
    // id carrying two sizes has no `def` that satisfies both, so every scene
    // holding the smaller of the two throws at the contract. It is also the
    // physically right model: a three-cell shelf and a four-cell shelf are
    // different pictures, not one picture used twice.
    const sizes = new Map<string, Map<string, string[]>>();
    for (const { assetId, footprint, where } of declarations()) {
      const key = `${footprint.w}x${footprint.h}`;
      const byId = sizes.get(assetId) ?? new Map<string, string[]>();
      byId.set(key, [...(byId.get(key) ?? []), where]);
      sizes.set(assetId, byId);
    }
    const clashes = [...sizes]
      .filter(([, byId]) => byId.size > 1)
      .map(
        ([assetId, byId]) =>
          `${assetId}: ${[...byId].map(([key, wheres]) => `${key} (${wheres.join(', ')})`).join(' vs ')}`,
      );
    expect(`clashes: ${clashes.join(' | ')}`).toBe('clashes: ');
  });

  it('declares a footprint of at least one cell on every side', () => {
    for (const { assetId, footprint, where } of declarations()) {
      expect(`${where}/${assetId}: ${footprint.w}x${footprint.h}`).toBe(
        `${where}/${assetId}: ${Math.max(1, footprint.w)}x${Math.max(1, footprint.h)}`,
      );
    }
  });
});
