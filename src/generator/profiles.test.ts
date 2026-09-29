import { describe, expect, it } from 'vitest';

import { createRng } from '../core/prng';
import { materialColor } from '../assets/palette';
import { MATERIAL_VARIANTS, PLACEHOLDER_CATALOG } from '../assets/placeholder';
import type { Place, Size } from '../core/types';
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
  roomsFor,
  BUILDINGS,
  ROOM_KINDS,
  ROTATIONS,
  wallMaterialFor,
} from './profiles';

const PLACE_TYPES: Place[] = [
  { building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' },
  { building: 'tavern', room: 'storeroom' }, { building: 'dungeon', room: 'hall' },
  { building: 'dungeon', room: 'room' }, { building: 'dungeon', room: 'storeroom' },
];

describe('building and room composition', () => {
  it('declares all six pairs and shares geometry for the same room', () => {
    for (const building of ['tavern', 'dungeon'] as const) {
      expect(roomsFor(building)).toEqual(['hall', 'room', 'storeroom']);
    }
    for (const room of ['hall', 'room', 'storeroom'] as const) {
      const tavern = profileFor({ building: 'tavern', room });
      const dungeon = profileFor({ building: 'dungeon', room });
      expect(tavern.minSize).toEqual(dungeon.minSize);
      expect(tavern.maxSize).toEqual(dungeon.maxSize);
      expect(tavern.doorRange).toEqual(dungeon.doorRange);
      expect(tavern.shapes).toEqual(dungeon.shapes);
      expect(tavern.anchors.map(({ footprint, placement }) => ({ footprint, placement }))).toEqual(
        dungeon.anchors.map(({ footprint, placement }) => ({ footprint, placement })),
      );
      expect(tavern.anchors.map((anchor) => anchor.assetId)).not.toEqual(
        dungeon.anchors.map((anchor) => anchor.assetId),
      );
      expect(ROOM_KINDS[room].groupsPerHundredCells).toEqual(tavern.groupsPerHundredCells);
    }
  });

  it('rejects an incomplete slot filling before assigning an undefined asset', () => {
    const filling = BUILDINGS.dungeon.rooms.room!;
    const original = filling.anchors;
    filling.anchors = original.slice(0, -1);
    try {
      expect(() => profileFor({ building: 'dungeon', room: 'room' })).toThrow('invalid slot filling');
    } finally {
      filling.anchors = original;
    }
  });

  it('fills the dungeon hearth feature with a hearth instead of a torch', () => {
    const hall = profileFor({ building: 'dungeon', room: 'hall' });
    const room = profileFor({ building: 'dungeon', room: 'room' });
    expect(hall.anchors.find((anchor) => anchor.feature === 'hearth')?.assetId).toBe('stone_hearth');
    expect(room.anchors.find((anchor) => anchor.assetId === 'wall_torch')?.feature).toBeUndefined();
  });
});

describe('profileFor', () => {
  it('has a profile for every place type', () => {
    for (const place of PLACE_TYPES) {
      expect(profileFor(place).place).toBe(place);
    }
  });

  it('rejects a place type it does not know', () => {
    // `Params` can arrive from a language model through JSON, where the type
    // system guarantees nothing. Without the guard the caller would get
    // `undefined` and fail several layers away, reading a property of it.
    expect(() => profileFor({ building: 'dungeon', room: 'crypt' } as unknown as Place)).toThrow("unknown place");
  });

  it('rejects a place type that is only a key of Object.prototype', () => {
    // A word nothing declares is the easy half of the vocabulary. The hard
    // half is the words every object literal already answers to: `PROFILES`
    // inherits from `Object.prototype`, so a lookup on `toString` returns a
    // function and one on `__proto__` returns the prototype — neither is
    // `undefined`, and both would be handed on as a profile to all three
    // generation stages. Every one of these survives `JSON.parse`.
    for (const key of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(() => profileFor({ building: key, room: 'hall' } as unknown as Place)).toThrow(`unknown place '${key}_hall'`);
    }
  });
});

/**
 * How far apart two materials have to be to read as two materials, in sRGB
 * channels.
 *
 * Measured, not chosen. Across the vocabulary as it stood before a pillar had
 * a material of its own, the *worst* separation between two different
 * materials was 13.7 — `dirt_floor` variant 0 (#723771) against
 * `plaster_wall` variant 1 (#673569) — and that pair is one colour on the map.
 * 30 clears the whole of that noise floor and sits below every measurement the
 * two pillar materials produce; the nearest of them is 31.5.
 */
const READS_AS_DIFFERENT = 30;

/**
 * The straight-line distance between two `#rrggbb` colours in sRGB channels.
 *
 * Crude next to a perceptual metric, and enough for the one question asked of
 * it — whether two flat fills side by side read as two colours or as one —
 * because it needs no colour science in a test and the yardstick above is
 * measured in these same units.
 */
function channelDistance(a: string, b: string): number {
  const channels = (hex: string): number[] =>
    [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

/**
 * Every colour a material can be drawn in.
 *
 * @throws {Error} if the marking library has no record of the material, which
 *                 would otherwise make every comparison below vacuously true.
 */
function shadesOf(material: string): string[] {
  const variants = MATERIAL_VARIANTS[material];
  if (variants === undefined) {
    throw new Error(`the test expects ${material} in the marking library's material record`);
  }
  return Array.from({ length: variants }, (_, variant) => materialColor(material, variant));
}

describe('profile material vocabulary', () => {
  it('names only materials the catalogue declares', () => {
    for (const place of PLACE_TYPES) {
      const profile = profileFor(place);
      const named = [
        ...profile.floorMaterials,
        ...Object.values(profile.wallMaterials),
        profile.defaultWallMaterial,
        profile.pillarMaterial,
      ];
      for (const material of named) {
        expect(Object.keys(MATERIALS)).toContain(material);
      }
    }
  });

  it('gives every profile a pillar material that is none of its other materials', () => {
    // The whole of the pillar defect was that a pillar took the material of
    // the wall beside it. A profile that named its wall here would put it
    // straight back, and would do it silently, because every other check in
    // this file would still pass.
    for (const place of PLACE_TYPES) {
      const profile = profileFor(place);
      const others = [
        ...profile.floorMaterials,
        ...Object.values(profile.wallMaterials),
        profile.defaultWallMaterial,
      ];
      expect(`${place.building}/${place.room}: ${others.includes(profile.pillarMaterial)}`)
        .toBe(`${place.building}/${place.room}: false`);
    }
  });

  it('paints a pillar in a colour none of the same profile\u2019s materials is painted in', () => {
    // The name-level check above is not the property the person looking at the
    // PNG cares about. `materialColor` derives a colour from the material name
    // by FNV-1a, so two different names can still come out as one colour — and
    // the obvious names for this field do exactly that, which the test below
    // pins. This is the one that says the pillars are visible.
    for (const place of PLACE_TYPES) {
      const profile = profileFor(place);
      const others = [
        ...profile.floorMaterials,
        ...Object.values(profile.wallMaterials),
        profile.defaultWallMaterial,
      ];
      for (const material of others) {
        for (const shade of shadesOf(material)) {
          for (const pillarShade of shadesOf(profile.pillarMaterial)) {
            const apart = channelDistance(pillarShade, shade) >= READS_AS_DIFFERENT;
            expect(`${place.building}/${place.room} ${profile.pillarMaterial} vs ${material}: ${apart}`)
              .toBe(`${place.building}/${place.room} ${profile.pillarMaterial} vs ${material}: true`);
          }
        }
      }
    }
  });

  it('would not have been distinct under the names this field invites', () => {
    // `stone_pillar` measures 16.6 against `timber_wall` variant 1, and
    // `timber_pillar` 12.9 against `flagstone` variant 1 — the second below
    // even the noise floor above. Pinned so that the two names in use are
    // visibly a measurement and not a preference, and so that renaming them
    // back to the obvious thing fails here rather than on someone's screen.
    expect(channelDistance(materialColor('stone_pillar', 0), materialColor('timber_wall', 1)))
      .toBeLessThan(READS_AS_DIFFERENT);
    expect(channelDistance(materialColor('timber_pillar', 0), materialColor('flagstone', 1)))
      .toBeLessThan(READS_AS_DIFFERENT);
  });

  it('costs a pillar cell exactly the draws a wall cell already cost', () => {
    // `tileOf` draws a variant for every cell and a rotation only for a
    // rotatable material, and `Rng.int` takes one number whatever its range.
    // So one variant and no rotation means painting a pillar differently
    // moves nothing in the rng sequence: the only thing that changes about a
    // map generated before this field existed is the colour of four cells.
    for (const place of PLACE_TYPES) {
      const def = materialDef(profileFor(place).pillarMaterial);
      expect(def).toEqual({ variants: 1, rotatable: false });
    }
  });

  it('gives every floor material of a profile a wall counterpart', () => {
    for (const place of PLACE_TYPES) {
      const profile = profileFor(place);
      for (const floor of profile.floorMaterials) {
        expect(profile.wallMaterials[floor]).toBeDefined();
      }
    }
  });
});

describe('profile furniture', () => {
  it('keeps every anchor small enough to stand in the smallest room of its kind', () => {
    for (const place of PLACE_TYPES) {
      const profile = profileFor(place);
      // The interior is the footprint minus the wall ring on both sides.
      const interior: Size = { w: profile.minSize.w - 2, h: profile.minSize.h - 2 };
      for (const anchor of profile.anchors) {
        const longest = Math.max(anchor.footprint.w, anchor.footprint.h);
        expect(longest).toBeLessThanOrEqual(Math.max(interior.w, interior.h));
      }
    }
  });

  it('keeps every group part inside the box its offsets are measured in', () => {
    for (const place of PLACE_TYPES) {
      for (const group of profileFor(place).groups) {
        for (const part of group.parts) {
          expect(part.offset.x + part.footprint.w).toBeLessThanOrEqual(group.size.w);
          expect(part.offset.y + part.footprint.h).toBeLessThanOrEqual(group.size.h);
        }
      }
    }
  });

  it('gives every scatter prop a positive weight', () => {
    for (const place of PLACE_TYPES) {
      for (const spec of profileFor(place).scatter) {
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

  it('rejects a material that is only a key of Object.prototype', () => {
    // `materialDef` takes a bare `string`, so this is the lookup with no type
    // in front of it at all. Unguarded, `materialDef('__proto__')` hands back
    // `Object.prototype`, `def.variants` is `undefined`, and every tile of
    // the map draws its variant from `rng.int(0, NaN)`.
    for (const key of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(() => materialDef(key)).toThrow(`unknown material '${key}'`);
    }
  });
});

describe('clampSize', () => {
  it('leaves a size already inside the profile alone', () => {
    const profile = profileFor({ building: 'tavern', room: 'hall' });
    expect(clampSize({ w: 14, h: 12 }, profile)).toEqual({ w: 14, h: 12 });
  });

  it('raises a size below the profile minimum', () => {
    const profile = profileFor({ building: 'tavern', room: 'hall' });
    expect(clampSize({ w: 3, h: 2 }, profile)).toEqual(profile.minSize);
  });

  it('lowers a size above the profile maximum, which is never past 20 cells', () => {
    const profile = profileFor({ building: 'tavern', room: 'hall' });
    const clamped = clampSize({ w: 99, h: 99 }, profile);
    expect(clamped).toEqual(profile.maxSize);
    expect(clamped.w).toBeLessThanOrEqual(20);
    expect(clamped.h).toBeLessThanOrEqual(20);
  });

  it('rounds a fractional size to whole cells', () => {
    expect(clampSize({ w: 13.4, h: 12.6 }, profileFor({ building: 'tavern', room: 'hall' }))).toEqual({ w: 13, h: 13 });
  });

  it('keeps every profile inside the twenty-cell ceiling of the project', () => {
    for (const place of PLACE_TYPES) {
      const profile = profileFor(place);
      expect(profile.maxSize.w).toBeLessThanOrEqual(20);
      expect(profile.maxSize.h).toBeLessThanOrEqual(20);
      expect(profile.minSize.w).toBeLessThanOrEqual(profile.maxSize.w);
      expect(profile.minSize.h).toBeLessThanOrEqual(profile.maxSize.h);
    }
  });
});

describe('clampDoorCount', () => {
  const profile = profileFor({ building: 'tavern', room: 'hall' });

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
    const profile = profileFor({ building: 'tavern', room: 'hall' });
    expect(wallMaterialFor('wood_plank', profile)).toBe('timber_wall');
    expect(wallMaterialFor('flagstone', profile)).toBe('stone_wall');
  });

  it('falls back to the profile default for a floor material it has no pairing for', () => {
    const profile = profileFor({ building: 'tavern', room: 'hall' });
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
  const FEATURE_PLACES: Record<string, Place[]> = {
    bar: [{ building: 'tavern', room: 'hall' }],
    hearth: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'hall' }],
    stairs: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'storeroom' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'storeroom' }],
    pillars: [{ building: 'tavern', room: 'hall' }, { building: 'dungeon', room: 'hall' }],
    alcove: [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'hall' }, { building: 'dungeon', room: 'room' }],
    shelving: [{ building: 'tavern', room: 'storeroom' }, { building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'storeroom' }, { building: 'dungeon', room: 'room' }],
    bunks: [{ building: 'tavern', room: 'room' }, { building: 'dungeon', room: 'room' }],
  };

  it('is the same seven words the interpreter writes', () => {
    expect([...FEATURE_VOCABULARY].sort()).toEqual(Object.keys(FEATURE_PLACES).sort());
  });

  it('answers to every word, either with an anchor or with the plan itself', () => {
    const byAnchor = new Set(
      PLACE_TYPES.flatMap((place) =>
        profileFor(place)
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
      for (const place of places) {
        const anchors = profileFor(place).anchors.filter((spec) => spec.feature === feature);
        expect(`${place}/${feature}: ${anchors.length} anchor(s)`).not.toBe(
          `${place}/${feature}: 0 anchor(s)`,
        );
      }
    }
  });

  it('names no feature the interpreter would never send', () => {
    for (const place of PLACE_TYPES) {
      for (const spec of profileFor(place).anchors) {
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
    for (const place of PLACE_TYPES) {
      const profile = profileFor(place);
      for (const spec of profile.anchors) {
        found.push({ assetId: spec.assetId, footprint: spec.footprint, where: `${place} anchor` });
      }
      for (const group of profile.groups) {
        for (const part of group.parts) {
          found.push({
            assetId: part.assetId,
            footprint: part.footprint,
            where: `${place} group ${group.id}`,
          });
        }
      }
      for (const spec of profile.scatter) {
        found.push({ assetId: spec.assetId, footprint: { w: 1, h: 1 }, where: `${place} scatter` });
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
    const declared = declarations();
    // The sweep has to have swept: every assertion below is over a
    // collection, so an empty `PLACE_TYPES` would pass this test by saying
    // nothing at all.
    expect(declared.length).toBeGreaterThan(0);
    const sizes = new Map<string, Map<string, string[]>>();
    for (const { assetId, footprint, where } of declared) {
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
    const declared = declarations();
    expect(declared.length).toBeGreaterThan(0);
    for (const { assetId, footprint, where } of declared) {
      expect(`${where}/${assetId}: ${footprint.w}x${footprint.h}`).toBe(
        `${where}/${assetId}: ${Math.max(1, footprint.w)}x${Math.max(1, footprint.h)}`,
      );
    }
  });

  it('matches every declared profile asset with a marker of the same footprint', () => {
    const catalog = new Map(PLACEHOLDER_CATALOG.map((asset) => [asset.id, asset]));
    for (const { assetId, footprint } of declarations()) {
      const kind = PLACEHOLDER_CATALOG.find((asset) => asset.id.endsWith(`/${assetId}`));
      expect(kind, assetId).toBeDefined();
      expect(catalog.get(kind!.id)?.footprint).toEqual(footprint);
    }
  });
});
