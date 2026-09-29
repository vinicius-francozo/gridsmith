import { describe, expect, it } from 'vitest';

import { createRng } from '../core/prng';
import { buildFloorplan } from './floorplan';
import { isPillar } from './materials';
import { paramsFor } from './test-fixtures';
import { featureSuits, featuresFor } from '../interpreter/vocabulary';
import type { Feature } from '../interpreter/vocabulary';
import { materialColor } from '../assets/palette';
import { MATERIAL_VARIANTS, PLACEHOLDER_CATALOG } from '../assets/placeholder';
import type { Place, Size } from '../core/types';
import {
  ALCOVE_FEATURE,
  PILLAR_MATERIAL,
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
import type { ShapeName } from './profiles';

const PLACE_TYPES: Place[] = [
  { building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' },
  { building: 'tavern', room: 'storeroom' }, { building: 'dungeon', room: 'hall' },
  { building: 'dungeon', room: 'room' }, { building: 'dungeon', room: 'storeroom' },
  { building: 'dungeon', room: 'crypt' },
];

/** The rooms both buildings have, and so the ones whose geometry is shared. */
const SHARED_ROOMS = ['hall', 'room', 'storeroom'] as const;

describe('building and room composition', () => {
  it('declares all seven pairs and shares geometry for the rooms both buildings have', () => {
    expect(roomsFor('tavern')).toEqual([...SHARED_ROOMS]);
    // The crypt is the dungeon's alone, which is what makes the matrix sparse
    // and is the reason every table keyed on a building and a room is read
    // through `roomsFor` rather than over `RoomKind`.
    expect(roomsFor('dungeon')).toEqual([...SHARED_ROOMS, 'crypt']);
    for (const room of SHARED_ROOMS) {
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

  it('furnishes the crypt with the dead and the hall with the guard', () => {
    // The whole point of the room existing. A description of a catacomb used to
    // resolve to the hall, and the hall's filling is what the person saw: a war
    // table, four guard stools and a weapon rack. This is that contrast written
    // down — the two fillings share no asset at all, so the marker map reads as
    // a different kind of room at a glance rather than as the same room with a
    // different label on the line underneath it.
    //
    // Furniture only. The two rooms do share scatter — bone, rubble and dust
    // are litter on a dungeon floor wherever that floor is, and a crypt earns
    // `skull` and `shard` on top of them rather than instead of them. It is the
    // pieces that carry a label a person reads that have to differ.
    const crypt = profileFor({ building: 'dungeon', room: 'crypt' });
    const hall = profileFor({ building: 'dungeon', room: 'hall' });

    const idsOf = (profile: typeof crypt): string[] => [
      ...profile.anchors.map((anchor) => anchor.assetId),
      ...profile.groups.flatMap((group) => group.parts.map((part) => part.assetId)),
    ];

    expect(crypt.anchors.map((anchor) => anchor.assetId)).toEqual([
      'sarcophagus', 'bone_niche', 'votive_brazier',
    ]);
    expect(crypt.groups.map((group) => group.parts.map((part) => part.assetId))).toEqual([
      ['grave_slab', 'slab_lid', 'grave_marker'],
      ['funerary_urn', 'funerary_urn'],
    ]);
    const hallIds = new Set(idsOf(hall));
    expect(idsOf(crypt).filter((id) => hallIds.has(id))).toEqual([]);
    expect(crypt.scatter.map((slot) => slot.assetId)).toEqual([
      'bone', 'skull', 'rubble', 'shard', 'dust',
    ]);
    // The sarcophagus carries **no feature word**, and that is the net rather
    // than a detail of the table. `anchorOrder` drops an anchor whose feature is
    // in `excluded`, and a featureless one can never be in `excluded`, so this
    // is the single piece that cannot be refused. It is also what actually
    // saved the map this front exists for: "catacumba **escura**" scores the
    // `hearth` noul low enough to be read as a refusal, which takes the brazier
    // out of the draw before it starts. Give it a feature and the crypt becomes
    // refusable down to nothing.
    expect(crypt.anchors.find((anchor) => anchor.assetId === 'sarcophagus')?.feature).toBeUndefined();
    for (const guardRoomThing of ['war_table', 'guard_stool', 'weapon_rack', 'stone_stairs']) {
      expect(idsOf(crypt)).not.toContain(guardRoomThing);
    }
  });

  it('lets a crypt be asked for with no furniture at all, which a hall cannot be', () => {
    // The limit the front before this one left on the table: `groupTarget`
    // scales between these two numbers, so the `min` is a floor the furnishing
    // dial cannot reach under. A common room with no tables in it is not a
    // common room; a crypt with nothing standing in it is an ordinary crypt,
    // and "poucos móveis" was half of what the person asked for. The decision
    // belongs in this table and not in `props.ts`.
    expect(profileFor({ building: 'dungeon', room: 'crypt' }).groupsPerHundredCells.min).toBe(0);
    expect(profileFor({ building: 'dungeon', room: 'hall' }).groupsPerHundredCells.min).toBe(2);
  });

  it('grows pillars in the smallest crypt there is, and in no hall that small', () => {
    // **Built, not asserted about the table.** Written as `minSize.h >= 11` this
    // passed with `MIN_INTERIOR_FOR_PILLARS` moved from 9x9 to 10x10 — the very
    // constant the crypt's floor is chosen against, and the load-bearing
    // premise of its having a geometry of its own. So it asks stage one for the
    // plan and counts what came out.
    //
    // The hall is the other half and it is a real defect, left out of scope by
    // agreement: its floor is 12x10, an interior of 10x8, and eight is under
    // the nine `growPillars` wants. **Every** seed of 600 builds a 12x10 hall
    // that asked for pillars and got none, and it is not only the floor —
    // `jitterSize` moves each side a cell, so a *small* dungeon hall asking for
    // pillars comes back bare on **205 of 600 seeds, 34%**, every one of them
    // the seeds that landed on height 10.
    // Forty is chosen against the grammar rather than for comfort: the plan is
    // one of four shapes, and both invariants below hold shape by shape, so a
    // sweep only has to see each of them several times.
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
    const counts = (place: Place): number[] => {
      const profile = profileFor(place);
      return seeds.map((seed) => {
        const params = paramsFor(place, { size: profile.minSize, features: [PILLARS_FEATURE], doorCount: 1 });
        const { floorplan } = buildFloorplan(params, profile, createRng(seed));
        // `isPillar` rather than a rule written again here: it is the one stage
        // two paints by, so this counts the pillars the map will actually show.
        let grown = 0;
        for (let y = 0; y < floorplan.size.h; y += 1) {
          for (let x = 0; x < floorplan.size.w; x += 1) {
            if (isPillar(floorplan.cells, floorplan.size, { x, y })) {
              grown += 1;
            }
          }
        }
        return grown;
      });
    };

    const crypt = counts({ building: 'dungeon', room: 'crypt' });
    expect(`crypt at its floor, seeds with no pillar: ${String(crypt.filter((n) => n === 0).length)}`)
      .toBe('crypt at its floor, seeds with no pillar: 0');
    expect(profileFor({ building: 'dungeon', room: 'crypt' }).allowPillars).toBe(true);

    const hall = counts({ building: 'dungeon', room: 'hall' });
    expect(`hall at its floor, seeds with a pillar: ${String(hall.filter((n) => n > 0).length)}`)
      .toBe('hall at its floor, seeds with a pillar: 0');
  });

  it('offers the crypt every feature it can hold, and no staircase', () => {
    // The two sides of a feature have to agree: a word that names an anchor is
    // only offered where that anchor is declared, and a word answered by stage
    // one is offered where the plan can answer it. Nothing checks that but this.
    //
    // The second half is read off `shapes` and `allowPillars` rather than from a
    // pair of words written out here. Written out, it said `alcove` was answered
    // by the plan whether or not the plan offered the shape — so taking
    // `'alcove'` out of the crypt's `shapes` left this green while every request
    // for a burial recess vanished off the map with nothing recorded.
    const place: Place = { building: 'dungeon', room: 'crypt' };
    const crypt = profileFor(place);
    const answeredByPlan = new Set<string>([
      ...(crypt.allowPillars ? [PILLARS_FEATURE] : []),
      ...(crypt.shapes.includes(ALCOVE_FEATURE as ShapeName) ? [ALCOVE_FEATURE] : []),
    ]);
    const anchored = new Set(
      crypt.anchors.map((anchor) => anchor.feature).filter((feature) => feature !== undefined),
    );

    expect(featuresFor(place)).toEqual(['hearth', 'pillars', 'alcove', 'shelving']);
    for (const feature of featuresFor(place)) {
      expect(`${feature}: ${String(answeredByPlan.has(feature) || anchored.has(feature))}`).toBe(`${feature}: true`);
    }
    expect([...anchored].every((feature) => featureSuits(feature as Feature, place))).toBe(true);
    // Named on its own, because it is the one absence that is a decision: every
    // other room here offers a stair, and a crypt is reached along a passage.
    // The description that started this front said "sem escadaria".
    expect(featureSuits('stairs', place)).toBe(false);
    expect(crypt.anchors.map((anchor) => anchor.assetId)).not.toContain('stone_stairs');
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
    expect(() => profileFor({ building: 'dungeon', room: 'oubliette' } as unknown as Place)).toThrow("unknown place");
  });

  it('rejects a room one building has when it is asked for in the other', () => {
    // The half of the vocabulary that opened when the matrix went sparse. Both
    // halves of `dungeon_crypt` are words this project knows — `tavern` is a
    // building and `crypt` is a room with a geometry in `ROOM_KINDS` — so a
    // guard that only asked whether each word is declared would let the pair
    // through and hand back a profile with no slot filling behind it.
    expect(() => profileFor({ building: 'tavern', room: 'crypt' })).toThrow("unknown place 'tavern_crypt'");
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
 * How far from the floor a pillar has to be to be worth noticing, in ΔE2000.
 *
 * Measured at both ends. Below it: two variants of one material — the same
 * stone, cut differently — are 10.2 apart at most, so nothing under that means
 * anything. Above it: 32.7 is what `PILLAR_MATERIAL` manages against the worst
 * floor shade in the vocabulary, and 33.1 is the best *any* name reaches
 * against a dungeon hall, so there is no more headroom to be had from this
 * side of the project. 28 sits above the 23.4 the old wall material managed —
 * the map that prompted all this — and leaves 4.7 to the one in use.
 */
const STANDS_OUT = 28;

/**
 * CIEDE2000 between two `#rrggbb` colours.
 *
 * The obvious ruler — straight-line distance in sRGB channels — cannot answer
 * the question this file asks, and the reason is specific to `materialColor`:
 * it separates the variants of one material **by lightness alone**. So in sRGB
 * the four cuts of `wood_plank`, which are the same plank by construction,
 * span 54.4, while `dirt_floor` and `plaster_wall` — two different materials —
 * sit 13.7 apart. Any sRGB threshold therefore says "same material" and
 * "different material" at once. In ΔE2000 the same two facts read 10.2 and
 * 14.0, in the right order, because it discounts a pure lightness step and
 * weighs a change of hue.
 */
function deltaE2000(hexA: string, hexB: string): number {
  const [L1, a1, b1] = labOf(hexA);
  const [L2, a2, b2] = labOf(hexB);
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hueOf = (b: number, a: number): number => {
    if (b === 0 && a === 0) {
      return 0;
    }
    const angle = (Math.atan2(b, a) * 180) / Math.PI;
    return angle < 0 ? angle + 360 : angle;
  };
  const hp1 = hueOf(b1, ap1);
  const hp2 = hueOf(b2, ap2);
  const dLp = L2 - L1;
  const dCp = cp2 - cp1;
  let dhp = 0;
  if (cp1 * cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) {
      dhp -= 360;
    } else if (dhp < -180) {
      dhp += 360;
    }
  }
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const dHp = 2 * Math.sqrt(cp1 * cp2) * Math.sin(radians(dhp) / 2);
  const lBar = (L1 + L2) / 2;
  const cBarP = (cp1 + cp2) / 2;
  let hBar: number;
  if (cp1 * cp2 === 0) {
    hBar = hp1 + hp2;
  } else if (Math.abs(hp1 - hp2) <= 180) {
    hBar = (hp1 + hp2) / 2;
  } else {
    hBar = (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2;
  }
  const t =
    1 - 0.17 * Math.cos(radians(hBar - 30)) + 0.24 * Math.cos(radians(2 * hBar)) +
    0.32 * Math.cos(radians(3 * hBar + 6)) - 0.2 * Math.cos(radians(4 * hBar - 63));
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT =
    -Math.sin(radians(60 * Math.exp(-(((hBar - 275) / 25) ** 2)))) *
    2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  return Math.sqrt(
    (dLp / sL) ** 2 + (dCp / sC) ** 2 + (dHp / sH) ** 2 +
    rT * (dCp / sC) * (dHp / sH),
  );
}

/** `#rrggbb` to CIELAB under D65, the space ΔE2000 is defined in. */
function labOf(hex: string): [number, number, number] {
  const linear = (offset: number): number => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const r = linear(1);
  const g = linear(3);
  const b = linear(5);
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
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

/** Every floor material any profile can pave a zone with, and every shade of it. */
function everyFloorShade(): { material: string; variant: number; color: string }[] {
  const found: { material: string; variant: number; color: string }[] = [];
  for (const place of PLACE_TYPES) {
    for (const material of profileFor(place).floorMaterials) {
      if (found.some((shade) => shade.material === material)) {
        continue;
      }
      shadesOf(material).forEach((color, variant) => found.push({ material, variant, color }));
    }
  }
  return found;
}

describe('profile material vocabulary', () => {
  it('names only materials the catalogue declares', () => {
    for (const place of PLACE_TYPES) {
      const profile = profileFor(place);
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

  it('names a pillar material the catalogue declares, and no profile\u2019s own material', () => {
    expect(Object.keys(MATERIALS)).toContain(PILLAR_MATERIAL);
    for (const place of PLACE_TYPES) {
      const profile = profileFor(place);
      const own = [
        ...profile.floorMaterials,
        ...Object.values(profile.wallMaterials),
        profile.defaultWallMaterial,
      ];
      expect(`${place.building}/${place.room}: ${own.includes(PILLAR_MATERIAL)}`)
        .toBe(`${place.building}/${place.room}: false`);
    }
  });

  it('paints a pillar so that it stands out against every floor it can stand on', () => {
    // This is the test the whole front exists for, and what it compares is
    // the **floor**, not the wall. A pillar is surrounded by floor — of
    // 22,552 grown pillars only 9.3% touch a wall cell at all, none of them
    // in a `rectangle` or an `l_shape` — so the floor is what the eye puts it
    // next to.
    for (const shade of everyFloorShade()) {
      for (const pillarShade of shadesOf(PILLAR_MATERIAL)) {
        const apart = deltaE2000(pillarShade, shade.color);
        expect(`${PILLAR_MATERIAL} vs ${shade.material}#${shade.variant}: ${apart >= STANDS_OUT}`)
          .toBe(`${PILLAR_MATERIAL} vs ${shade.material}#${shade.variant}: true`);
      }
    }
  });

  it('would not have passed on the wall material a pillar used to be painted', () => {
    // The regression anchor. Painting a pillar `stone_wall` is what the map
    // that prompted this did, and against `dirt_floor` and `flagstone` it
    // measures 23.4 and 25.0 — under the ruler. It was 42.6 against
    // `stone_floor`, which is why "the pillars are invisible" was the wrong
    // diagnosis and "nobody looked at them" was the right one.
    const worst = Math.min(
      ...everyFloorShade().flatMap((shade) =>
        shadesOf('stone_wall').map((wall) => deltaE2000(wall, shade.color)),
      ),
    );
    expect(worst).toBeLessThan(STANDS_OUT);
    expect(Math.round(worst * 10) / 10).toBe(23.4);
  });

  it('is told apart from a floor by more than one material is told from itself', () => {
    // What the ruler has to clear. `materialColor` separates the variants of
    // one material by lightness alone, and they are the same material by
    // construction, so the largest gap between two of them is the point below
    // which a difference means nothing at all.
    let widest = 0;
    for (const material of Object.keys(MATERIAL_VARIANTS)) {
      const shades = shadesOf(material);
      for (let i = 0; i < shades.length; i += 1) {
        for (let j = i + 1; j < shades.length; j += 1) {
          widest = Math.max(widest, deltaE2000(shades[i], shades[j]));
        }
      }
    }
    expect(Math.round(widest * 10) / 10).toBe(10.2);
    expect(STANDS_OUT).toBeGreaterThan(widest * 2);
  });

  it('costs a pillar cell exactly the draws a wall cell already cost', () => {
    // `tileOf` draws a variant for every cell and a rotation only for a
    // rotatable material, and `Rng.int` takes one number whatever its range.
    // So one variant and no rotation means the rng sequence is untouched:
    // same plan, same props, same rotations, and three or four tiles — the
    // pillars — painted a different colour.
    expect(materialDef(PILLAR_MATERIAL)).toEqual({ variants: 1, rotatable: false });
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
