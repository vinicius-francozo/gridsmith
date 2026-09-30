import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createRng } from '../core/prng';
import { buildFloorplan } from './floorplan';
import { isPillar } from './materials';
import { paramsFor } from './test-fixtures';
import { FEATURES, featureSuits, featuresFor } from '../interpreter/vocabulary';
import type { Feature } from '../interpreter/vocabulary';
import { materialColor } from '../assets/palette';
import { createPlaceholderLibrary, MATERIAL_VARIANTS, PLACEHOLDER_CATALOG } from '../assets/placeholder';
import type { AssetDef, Place, Size } from '../core/types';
import {
  ALCOVE_FEATURE,
  PILLAR_MATERIAL,
  clampDoorCount,
  clampSize,
  CONCEPTS,
  FEATURE_VOCABULARY,
  MATERIALS,
  materialDef,
  pickRotation,
  PILLARS_FEATURE,
  profileFor,
  resolveAssets,
  roomsFor,
  BUILDINGS,
  ROOMS,
  ROTATIONS,
  wallMaterialFor,
} from './profiles';
import type { Concept, ResolvedProfile, ShapeName } from './profiles';

const library = createPlaceholderLibrary();

/**
 * A profile with its variants drawn, the way `generate` hands one to the
 * stages.
 *
 * Every slot every room declares settles to exactly one candidate once the
 * concept, the footprint and the room's palette ladder have been applied —
 * measured, and the tests below name the pieces — so this needs no seed of its
 * own and nothing here depends on which one it uses. It is a property each new
 * building has to keep: a slot with two candidates left would make the piece a
 * room comes back with depend on the seed, which no test here would notice and
 * every reader of the map would.
 */
function resolved(place: Place): ResolvedProfile {
  return resolveAssets(profileFor(place), library, createRng(1));
}

/**
 * Every pair the project builds, written out rather than read off `BUILDINGS`.
 *
 * A sweep derived from the registry would grow with the registry and would
 * therefore never report a building added without anybody looking at what it
 * costs the rooms already here — which is exactly what these sweeps are for.
 */
const PLACE_TYPES: Place[] = [
  { building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' },
  { building: 'tavern', room: 'storeroom' }, { building: 'dungeon', room: 'hall' },
  { building: 'dungeon', room: 'room' }, { building: 'dungeon', room: 'storeroom' },
  { building: 'dungeon', room: 'crypt' },
  { building: 'forge', room: 'smithy' }, { building: 'forge', room: 'room' },
  { building: 'temple', room: 'hall' }, { building: 'temple', room: 'room' },
  { building: 'library', room: 'reading' }, { building: 'library', room: 'archive' },
  { building: 'tower', room: 'laboratory' }, { building: 'tower', room: 'observatory' },
  { building: 'mine', room: 'room' }, { building: 'mine', room: 'hoist' },
  { building: 'ship', room: 'room' }, { building: 'ship', room: 'cabin' },
  { building: 'apothecary', room: 'distillery' }, { building: 'apothecary', room: 'hall' },
  { building: 'den', room: 'fencing' }, { building: 'den', room: 'tunnel' },
];

/** The rooms both buildings have, and so the ones whose geometry is shared. */
const SHARED_ROOMS = ['hall', 'room', 'storeroom'] as const;

describe('building and room composition', () => {
  it('shares one geometry between the two buildings that were written against it', () => {
    // `SHARED_ROOMS` is the tavern's three, and the claim is about the tavern
    // and the dungeon: those two were drawn as one set of shapes and differ
    // only in what they put in the slots. A third building reusing one of these
    // geometries is a different claim and is checked where it is made — its own
    // filling, against the slot count `profileFor` enforces.
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
      // **The slots are one object, so the two buildings stand their furniture
      // in the same places.** What a building may differ in is which of those
      // slots it fills: the dungeon cell leaves the guest room's fire empty,
      // and `null` is how a filling says so without shifting every slot after
      // it onto the wrong footprint. So each side is held to the shared slots
      // minus its own empty ones, which is what a mis-paired index would break.
      const fitted = (building: 'tavern' | 'dungeon'): Pick<(typeof ROOMS)[typeof room]['anchors'][number], 'footprint' | 'placement'>[] =>
        ROOMS[room].anchors.filter(
          (_, index) => BUILDINGS[building].rooms[room]!.anchors[index] !== null,
        );
      expect(tavern.anchors.map(({ footprint, placement }) => ({ footprint, placement }))).toEqual(fitted('tavern'));
      expect(dungeon.anchors.map(({ footprint, placement }) => ({ footprint, placement }))).toEqual(fitted('dungeon'));
      // **The concepts may well be the same; the pieces are not.** A guest
      // room and a cell both hold a bed, a set of bunks, somewhere to put
      // things, a shelf and a fire — the three shared rooms declare the same
      // concepts in the same slots for both buildings — and what separates
      // them is which variant the palette prefers. That is the whole of what
      // this front moved, so it is read off the resolved profile.
      expect(resolved({ building: 'tavern', room }).anchors.map((anchor) => anchor.assetId)).not.toEqual(
        resolved({ building: 'dungeon', room }).anchors.map((anchor) => anchor.assetId),
      );
      expect(ROOMS[room].groupsPerHundredCells).toEqual(tavern.groupsPerHundredCells);
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

  it('refuses a slot asked for by a word that names another concept', () => {
    // `anchorOrder` reads `feature` and nothing else: a requested one goes to
    // the front of the draw, an excluded one is out of it at every seed. So a
    // slot whose word does not name its own concept is a request answered by
    // the wrong furniture — "sem lareira" taking the beds out of a room —
    // and nothing else in the project compares the two. `feature` is the
    // building's to declare and `CONCEPTS` is the project's, so no type can
    // hold them together.
    const filling = BUILDINGS.dungeon.rooms.room!;
    const original = filling.anchors;
    filling.anchors = original.map((slot, index) =>
      index === 0 && slot !== null ? { ...slot, feature: 'hearth' } : slot,
    );
    try {
      expect(() => profileFor({ building: 'dungeon', room: 'room' }))
        .toThrow("feature 'hearth' does not ask for concept 'bed' in 'dungeon_room'");
    } finally {
      filling.anchors = original;
    }
  });

  it('refuses a word for a concept nothing can ask for', () => {
    // The other direction, and the reason `CONCEPTS` lists the four wordless
    // concepts at all. A featureless anchor is the piece of a room no
    // description can take away — the sarcophagus, the weapon rack — and
    // giving `tomb` a word would make the crypt refusable down to nothing.
    const filling = BUILDINGS.dungeon.rooms.crypt!;
    const original = filling.anchors;
    filling.anchors = original.map((slot, index) =>
      index === 0 && slot !== null ? { ...slot, feature: 'shelving' } : slot,
    );
    try {
      expect(() => profileFor({ building: 'dungeon', room: 'crypt' }))
        .toThrow("feature 'shelving' does not ask for concept 'tomb' in 'dungeon_crypt'");
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
    // are litter on a dungeon floor wherever that floor is, and both rooms ask
    // the library for the same `debris`. What differs is the weighting, below.
    // It is the pieces that carry a label a person reads that have to differ.
    const crypt = resolved({ building: 'dungeon', room: 'crypt' });
    const hall = resolved({ building: 'dungeon', room: 'hall' });

    const idsOf = (profile: typeof crypt): string[] => [
      ...profile.anchors.map((anchor) => anchor.assetId),
      ...profile.groups.flatMap((group) => group.parts.map((part) => part.assetId)),
    ];

    // Four slots, three pieces: the library has one `tomb` anchor at 3x2, so
    // the room's net draws the sarcophagus a second time. That is the price of
    // `tomb` being a word, and it is written out here rather than left to be
    // discovered on a map.
    expect(crypt.anchors.map((anchor) => anchor.assetId)).toEqual([
      'sarcophagus', 'bone_niche', 'votive_brazier', 'sarcophagus',
    ]);
    expect(crypt.groups.map((group) => group.parts.map((part) => part.assetId))).toEqual([
      ['grave_slab', 'slab_lid', 'grave_marker'],
      ['funerary_urn', 'funerary_urn'],
    ]);
    const hallIds = new Set(idsOf(hall));
    expect(idsOf(crypt).filter((id) => hallIds.has(id))).toEqual([]);
    // Scatter is a pool the library answers with now, not a list of ids, so
    // what is held is the *shape* of the pool: bone on the heaviest rung, the
    // broken floor the description that made this room asked for below it, the
    // skull below that — the order the room was written with — and nothing
    // from outside a burial chamber on the floor at all.
    const debris = new Map(crypt.scatter.map((slot) => [slot.assetId, slot.weight]));
    expect(`bone ${String(debris.get('bone'))}, rubble ${String(debris.get('rubble'))}, shard ${String(debris.get('shard'))}, skull ${String(debris.get('skull'))}, dust ${String(debris.get('dust'))}`)
      .toBe('bone 4, rubble 3, shard 2, skull 2, dust 2');
    // The five pieces this room was written with, at the five weights it was
    // written with, and no sixth. The broken chain arrives on any rung broad
    // enough to be answered by `['dungeon', 'debris']`, and nobody is chained
    // up in a crypt.
    expect([...debris.keys()].sort()).toEqual(['bone', 'dust', 'rubble', 'shard', 'skull']);
    // A catacomb has no stable and no archer. Both used to arrive here, and
    // both are pieces the library answers `debris` with — which is why the
    // ladder is rungs of its own and not one tag for every dungeon room.
    for (const elsewhere of ['straw', 'loose_arrow']) {
      expect(`${elsewhere} in the crypt: ${String(debris.has(elsewhere))}`)
        .toBe(`${elsewhere} in the crypt: false`);
    }
    // **One slot carries no feature word, and that is the net rather than a
    // detail of the table.** `anchorOrder` drops an anchor whose feature is in
    // `excluded`, and a featureless one can never be in `excluded`, so this is
    // the single piece that cannot be refused. It is what actually saved the
    // map the crypt front exists for: "catacumba **escura**" scores the
    // `hearth` noul low enough to be read as a refusal, which takes the brazier
    // out of the draw before it starts.
    //
    // Counted rather than looked up by asset id, which is how it used to be
    // written and would now find the *first* sarcophagus — the one that does
    // carry a word. Exactly one of the four has none, and both halves of that
    // are load-bearing: none at all and the crypt is refusable down to bare
    // walls; two and one of them is a word that promises something it cannot
    // take away.
    const wordless = crypt.anchors.filter((anchor) => anchor.feature === undefined);
    expect(wordless.map((anchor) => anchor.assetId)).toEqual(['sarcophagus']);
    for (const guardRoomThing of ['war_table', 'guard_stool', 'weapon_rack', 'stone_stairs']) {
      expect(idsOf(crypt)).not.toContain(guardRoomThing);
    }
  });

  it('furnishes no place with a piece it tells the person does not belong there', () => {
    // **The cell's fire, and the direction nothing checked.**
    // `FEATURE_PLACES` in `interpreter/vocabulary.ts` is the gate the interface
    // speaks through: a word it does not list for a place comes back
    // `FEATURE_NOT_IN_PLACE` (`resolve.ts`), which a person reads as "a fire
    // does not belong in this kind of room". The fill never consults it —
    // `anchorOrder` filters on a slot's `feature`, and a slot carrying none is
    // never filtered at all — so a room could say that and draw one anyway.
    // The dungeon cell did, at every seed, for as long as this table has had a
    // crypt in it.
    //
    // Read off the slot's **concept** and not off its `feature`, because the
    // concept is where the hole was: the cell's hearth slot declared no word,
    // so a sweep over declared words saw nothing to check.
    const wordFor = (concept: Concept): string | undefined =>
      (CONCEPTS[concept] as { feature?: string }).feature;
    for (const place of PLACE_TYPES) {
      const offered = new Set<string>(featuresFor(place));
      const contradicting = profileFor(place)
        .anchors.map((anchor) => wordFor(anchor.concept))
        .filter((word): word is string => word !== undefined && !offered.has(word));
      expect(`${place.building}_${place.room} draws, but says it cannot hold: ${[...new Set(contradicting)].join()}`)
        .toBe(`${place.building}_${place.room} draws, but says it cannot hold: `);
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
    const crypt = resolved(place);
    const answeredByPlan = new Set<string>([
      ...(crypt.allowPillars ? [PILLARS_FEATURE] : []),
      ...(crypt.shapes.includes(ALCOVE_FEATURE as ShapeName) ? [ALCOVE_FEATURE] : []),
    ]);
    const anchored = new Set(
      crypt.anchors.map((anchor) => anchor.feature).filter((feature) => feature !== undefined),
    );

    expect(featuresFor(place)).toEqual(['hearth', 'pillars', 'alcove', 'shelving', 'tomb']);
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
    const hall = resolved({ building: 'dungeon', room: 'hall' });
    const room = resolved({ building: 'dungeon', room: 'room' });
    expect(hall.anchors.find((anchor) => anchor.feature === 'hearth')?.assetId).toBe('stone_hearth');
    expect(room.anchors.find((anchor) => anchor.assetId === 'wall_torch')?.feature).toBeUndefined();
  });
});

/**
 * A catalogue holding one anchor per slot of the tavern hall, all three tagged
 * with a word no palette in the project names.
 *
 * `againstWall` and the footprints are the hall's, because `resolveAssets`
 * answers a slot with the assets carrying its concept **at its footprint** —
 * a catalogue whose sizes did not match would fail for the other reason.
 */
function catalogueTaggedOnly(tag: string): AssetDef[] {
  return [
    { id: 'anchor/counter', kind: 'anchor', footprint: { w: 5, h: 2 }, tags: ['bar', tag], againstWall: true },
    { id: 'anchor/firebox', kind: 'anchor', footprint: { w: 3, h: 2 }, tags: ['hearth', tag], againstWall: true },
    { id: 'anchor/steps', kind: 'anchor', footprint: { w: 2, h: 3 }, tags: ['stairs', tag], againstWall: true },
  ];
}

describe('a concept resolved into a variant', () => {
  const TAVERN_HALL: Place = { building: 'tavern', room: 'hall' };

  it('furnishes one guest-room geometry in wood for a tavern and in iron for a dungeon', () => {
    // **The whole of what an earlier front bought.** The two rooms declare the
    // same concepts in the same slots — the geometry is shared, and `ROOMS`
    // holds it once — and the building's palette is the only thing that
    // separates a guest room from a cell. Before that, each building wrote out
    // five asset ids of its own.
    //
    // **Except the last slot, and that is the cell's fire.** The guest room
    // has a hearth and a cell has nothing there, so the dungeon's list is the
    // tavern's four and stops. Written as "the same concepts" with no
    // exception, this test would go green again the day somebody put a fire
    // back in the cell.
    const tavern = profileFor({ building: 'tavern', room: 'room' });
    const dungeon = profileFor({ building: 'dungeon', room: 'room' });
    expect(tavern.anchors.map((anchor) => anchor.concept)).toEqual([
      'bed', 'bunks', 'storage', 'shelving', 'hearth',
    ]);
    expect(dungeon.anchors.map((anchor) => anchor.concept)).toEqual(
      tavern.anchors.slice(0, -1).map((anchor) => anchor.concept),
    );
    expect(resolved({ building: 'tavern', room: 'room' }).anchors.map((anchor) => anchor.assetId)).toEqual([
      'bed', 'bunk_beds', 'wardrobe', 'shelf_row_short', 'hearth_small',
    ]);
    expect(resolved({ building: 'dungeon', room: 'room' }).anchors.map((anchor) => anchor.assetId)).toEqual([
      'cot', 'iron_bunks', 'lockers', 'wall_rack',
    ]);
  });

  it('reads the palette as a ladder, most particular tag first', () => {
    // A flat set cannot do this, and that is measured rather than argued. A
    // tavern needs `stone` to tell `hearth` from `stone_hearth` at 3x2, where
    // neither is wooden, and needs *not* `stone` to tell `stairs_up` from
    // `stone_stairs` at 2x3, where one of them is. No single set of tags
    // separates both; `['wood', 'stone']` in that order separates both.
    const hall = resolved(TAVERN_HALL);
    // The hall declares no ladder of its own, so this is the building's,
    // reached through the fallback in `profileFor`. It used to carry a third
    // word, `tableware`, which no anchor in the catalogue has ever had: it was
    // there to weigh a taproom's litter, and the debris ladder took that job
    // over two commits ago.
    expect(hall.assetTags).toEqual(['wood', 'stone']);
    expect(hall.anchors.map((anchor) => anchor.assetId)).toEqual([
      'bar_counter', 'hearth', 'stairs_up',
    ]);
    // And the room that needs a ladder of its own. `bone_niche`,
    // `votive_brazier` and `sarcophagus` are each behind a dungeon piece at
    // their footprint, so the building's `dungeon` would furnish the crypt as
    // a guard room.
    expect(resolved({ building: 'dungeon', room: 'crypt' }).assetTags).toEqual(['tomb', 'stone']);
    expect(resolved({ building: 'dungeon', room: 'storeroom' }).assetTags).toEqual([
      'weapons', 'dungeon', 'stone',
    ]);
  });

  it('still hands over a piece no rung of the palette prefers', () => {
    // **Preference, not filter**, and this is the half that is easy to lose.
    // The person asked to be able to ask for what is not typical of the
    // building; if the palette narrowed the candidates instead of ordering
    // them, a concept whose every variant is off-palette would come back with
    // nothing at all and the map would be short a piece with nothing said.
    //
    // It is the same answer `resolve.ts` gives a feature that does not fit —
    // leave it out and record it — and `anchorOrder` gives an excluded one.
    const stranger = createPlaceholderLibrary(catalogueTaggedOnly('brass'));
    const profile = resolveAssets(profileFor(TAVERN_HALL), stranger, createRng(1));
    expect(profile.anchors.map((anchor) => anchor.assetId)).toEqual(['counter', 'firebox', 'steps']);
  });

  it('prefers the rung that does match, when one does', () => {
    // The other side of the same line: with a candidate on the palette and a
    // candidate off it, the palette is what decides — otherwise the test above
    // would pass just as well on a resolver that ignored `assetTags`.
    const both = createPlaceholderLibrary([
      ...catalogueTaggedOnly('brass'),
      { id: 'anchor/oak_firebox', kind: 'anchor', footprint: { w: 3, h: 2 }, tags: ['hearth', 'wood'], againstWall: true },
    ]);
    const profile = resolveAssets(profileFor(TAVERN_HALL), both, createRng(1));
    expect(profile.anchors[1].assetId).toBe('oak_firebox');
  });

  it('refuses a concept the library answers with nothing at that footprint', () => {
    // `rng.pick([])` hands back `undefined`, which `assetIdFor` turns into the
    // id `anchor/undefined`: a prop the renderer cannot draw, on a scene that
    // passes `validateScene` in full, with nothing before it having refused.
    const empty = createPlaceholderLibrary([]);
    expect(() => resolveAssets(profileFor(TAVERN_HALL), empty, createRng(1)))
      .toThrow("no anchor for concept 'bar' at 5x2");
  });
});

/** Every piece of debris the marking library declares, by its own name. */
function cataloguedDebris(): string[] {
  return PLACEHOLDER_CATALOG
    .filter((asset) => asset.kind === 'scatter')
    .map((asset) => asset.id.slice(asset.id.indexOf('/') + 1));
}

/** What `place` strews its floor with, as a share of the weight on it. */
function floorOf(place: Place): Map<string, number> {
  const scatter = resolved(place).scatter;
  const total = scatter.reduce((sum, slot) => sum + slot.weight, 0);
  return new Map(scatter.map((slot) => [slot.assetId, slot.weight / total]));
}

describe('the debris the catalogue offers', () => {
  it('leaves no piece in the catalogue that no room can strew', () => {
    // **Catalogue to room, and the direction is the point.** Every other test
    // of this layer reads a profile and checks that what it names exists — so
    // when `scatter/stool` stopped being named by anything, nothing went red.
    // It carries `['seating', 'wood']`, no room asked for either, and a piece
    // that had been 2 of the 9 weight on a taproom floor went to zero in
    // silence over 400 seeds.
    //
    // A piece nobody strews is not a bug in itself; a piece nobody strews and
    // nobody notices is. This is the noticing.
    const strewn = new Set(PLACE_TYPES.flatMap((place) => [...floorOf(place).keys()]));
    const catalogued = cataloguedDebris();
    expect(catalogued.length).toBeGreaterThan(0);
    expect(catalogued.filter((name) => !strewn.has(name))).toEqual([]);
  });

});

/**
 * What each floor comes out as: the piece, the weight, in order.
 *
 * **The first seven are the weights each room was written with in `main`**, read off
 * `TAVERN_HALL.scatter` and its neighbours at `482a206`, where a room named its
 * debris as a list of asset ids. The claim this front makes is that the
 * mechanism changed and the floors did not, and this is that claim written
 * down once, for all seven. The eight below them are the floors the four new
 * buildings were written with, and they are here for the other half of the
 * reason: a room added to `PLACE_TYPES` with no row here is the first thing the
 * test reports.
 *
 * It is not a restatement of the table it checks. A room declares *tags* and a
 * weight per rung; this is what the library answers with, so a tag misspelled,
 * a tag moved in `placeholder.ts`, a rung reweighted, reordered or dropped,
 * and a piece landing on the wrong rung all change it.
 */
const FLOORS: Readonly<Record<string, string>> = {
  tavern_hall: 'mug 4, stool 2, bottle 2, straw 1',
  tavern_room: 'mug 3, bottle 2, straw 1',
  tavern_storeroom: 'sack 3, straw 3, shard 2',
  dungeon_hall: 'bone 4, broken_chain 2, rubble 2, dust 1',
  dungeon_room: 'bone 3, broken_chain 2, dust 1',
  dungeon_storeroom: 'loose_arrow 3, dust 3, rubble 2',
  dungeon_crypt: 'bone 4, rubble 3, skull 2, shard 2, dust 2',
  forge_smithy: 'broken_chain 3, dust 3, rubble 2',
  forge_room: 'broken_chain 3, dust 2, sack 1',
  temple_hall: 'dust 3, rubble 2, straw 1',
  temple_room: 'mug 3, dust 2, straw 1',
  library_reading: 'dust 3, straw 2, shard 1',
  library_archive: 'dust 3, sack 2, straw 1',
  tower_laboratory: 'bottle 3, dust 2, rubble 1',
  tower_observatory: 'bottle 3, dust 2, straw 1',
  mine_room: 'rubble 3, broken_chain 2, dust 2',
  mine_hoist: 'broken_chain 3, rubble 2, dust 1',
  ship_room: 'sack 3, straw 2, broken_chain 1',
  ship_cabin: 'bottle 3, mug 2, straw 1',
  apothecary_distillery: 'bottle 3, dust 2, mug 1',
  apothecary_hall: 'straw 3, dust 2, mug 1',
  den_fencing: 'sack 3, mug 2, dust 1',
  den_tunnel: 'rubble 3, dust 2, straw 1',
};

describe('every floor, one by one', () => {
  it('strews each room with the pieces and the weights it was written with', () => {
    // **Every one, because two of the original seven had no floor of their own
    // and nobody noticed.** The tests below each name the rooms they are about — the
    // stool's taproom, the mug against the bottle, the bone against the dust,
    // the guest room against the cellar — and when those tests were swapped
    // over two rounds, the tavern cellar and the dungeon store room fell
    // between them. Measured rather than read: dropping the arsenal's
    // `weapons` rung from 3 to 1, which makes the loose arrow the lightest
    // thing on the floor of the room it is named for instead of the heaviest,
    // left the whole suite green at 1166 passed; so did dropping the cellar's
    // `storage` rung from 3 to 1.
    //
    // A test per room would have the same hole the next time the tests move.
    // One table cannot: a room added to `PLACE_TYPES` with no row here is the
    // first thing this reports.
    const unwritten = PLACE_TYPES.filter(
      (place) => !Object.hasOwn(FLOORS, `${place.building}_${place.room}`),
    );
    expect(`rooms with no floor written down: ${unwritten.join(', ')}`)
      .toBe('rooms with no floor written down: ');
    expect(Object.keys(FLOORS)).toHaveLength(PLACE_TYPES.length);

    for (const place of PLACE_TYPES) {
      const key = `${place.building}_${place.room}`;
      const floor = resolved(place).scatter
        .map((slot) => `${slot.assetId} ${String(slot.weight)}`)
        .join(', ');
      expect(`${key}: ${floor}`).toBe(`${key}: ${FLOORS[key]}`);
    }
  });
});

describe('the debris a room is strewn with, piece by piece', () => {
  it('keeps the stool on the taproom floor, at the share it was written with', () => {
    // Named on its own, because the sweep above is satisfied by one room
    // anywhere holding it and this is the room it belongs to. `scatter/stool`
    // carries `['seating', 'wood']` and nothing else, so no `clutter` or
    // `debris` rung reaches it; a taproom with one broad tag drew it zero
    // times in 400 seeds where the room was written for 2 of its 9 weight.
    const floor = floorOf({ building: 'tavern', room: 'hall' });
    const share = floor.get('stool');
    expect(share).toBeDefined();
    expect(`stool on the taproom floor: ${(share! * 100).toFixed(1)}%`)
      .toBe('stool on the taproom floor: 22.2%');
  });

  it('gives the mug the taproom floor, and the bone the dungeon\u2019s', () => {
    // **The two pieces the catalogue could not name, and now can.** A mug and
    // a bottle were both `['tableware', 'clutter']`; a bone, a broken chain
    // and a pinch of dust were all `['dungeon', 'debris']`. Pieces carrying
    // the same words move together at any weight, so the emblem of each of
    // these floors was pulled down to the average of its neighbours: over 400
    // seeds the taproom drew 27% mugs against 27% bottles where it was written
    // for 45% against 21%, and the cell drew 31% bone behind 35% chain and 34%
    // dust where it was written for 46%.
    const only = (place: Place): string[] => {
      const scatter = resolved(place).scatter;
      const top = Math.max(...scatter.map((slot) => slot.weight));
      return scatter.filter((slot) => slot.weight === top).map((slot) => slot.assetId).sort();
    };
    expect(only({ building: 'tavern', room: 'hall' })).toEqual(['mug']);
    expect(only({ building: 'tavern', room: 'room' })).toEqual(['mug']);
    for (const room of ['hall', 'room', 'crypt'] as const) {
      expect(`dungeon ${room}: ${only({ building: 'dungeon', room }).join()}`)
        .toBe(`dungeon ${room}: bone`);
    }
    // And the margin, which a heaviest-piece check on its own would let
    // collapse to a single unit of weight.
    const taproom = floorOf({ building: 'tavern', room: 'hall' });
    expect(taproom.get('mug')).toBe(2 * taproom.get('bottle')!);
    const cell = floorOf({ building: 'dungeon', room: 'room' });
    expect(cell.get('bone')).toBeGreaterThan(cell.get('broken_chain')!);
    expect(cell.get('broken_chain')).toBeGreaterThan(cell.get('dust')!);
  });

  it('never lets the dust be the heaviest thing in a room somebody died in', () => {
    // The symptom the round before this one left behind, and the one a reader
    // notices first: a cell whose floor is mostly dust reads as an empty room,
    // not as a cell. It was the heaviest piece in all three of these.
    for (const room of ['hall', 'room', 'crypt'] as const) {
      const floor = floorOf({ building: 'dungeon', room });
      const dust = floor.get('dust');
      // Still on the floor — a dungeon without dust is not the fix — just not
      // the most of it.
      expect(dust, room).toBeDefined();
      // Compared as numbers and not as rounded percentages, which is a trap
      // this test fell into first: with the cell on one broad rung the dust
      // and the bone are equal by construction, and two equal shares print
      // the same string. A tie is the failure, so a tie has to be visible.
      const heaviest = Math.max(...floor.values());
      expect(`dungeon ${room}: the dust is the heaviest thing on the floor — ${String(dust === heaviest)}`)
        .toBe(`dungeon ${room}: the dust is the heaviest thing on the floor — false`);
    }
  });

  it('keeps a piece on the first rung it stands on, not the last', () => {
    // **Inert as the seven ladders stand, and exercised here on purpose.**
    // Once the catalogue grew a word for what each piece is, every rung of
    // every room came out disjoint from every other in that room, so no room's
    // floor can tell the three readings apart any more. Written against a
    // room's ladder this test would have gone quiet without going red.
    //
    // The rule still decides the next piece added to the catalogue: a jug is
    // crockery and clutter both, and which of the two a taproom weighs it by
    // is the line this covers.
    const overlapping = {
      ...profileFor({ building: 'tavern', room: 'hall' }),
      scatterLadder: [
        { tags: ['crockery'], weight: 4 },
        { tags: ['clutter'], weight: 1 },
      ],
    };
    const floor = new Map(resolveAssets(overlapping, library, createRng(1)).scatter.map(
      (slot) => [slot.assetId, slot.weight],
    ));
    // The mug stands on both rungs; the bottle and the sack stand only on the
    // second. Summing would put the mug at 5, taking the last would put it at
    // 1, and both would say a taproom's crockery weighs what its sweepings do.
    expect(`mug ${String(floor.get('mug'))}, bottle ${String(floor.get('bottle'))}, sack ${String(floor.get('sack'))}`)
      .toBe('mug 4, bottle 1, sack 1');
  });

  it('tells a guest room and a cellar apart, which one tag could not', () => {
    // Both rooms asked for `clutter` and nothing else, so both came back the
    // same five pieces at the same flat weight: two floors a person could not
    // tell apart in a building where one holds beds and the other barrels.
    //
    // Measured as total variation distance between the two weight
    // distributions — half the sum of the absolute differences, 0 for two
    // identical floors and 1 for two that share no piece. The flat pair
    // measured 0.05 over 400 seeds; these share only their straw.
    const room = floorOf({ building: 'tavern', room: 'room' });
    const cellar = floorOf({ building: 'tavern', room: 'storeroom' });
    const apart = [...new Set([...room.keys(), ...cellar.keys()])]
      .reduce((sum, name) => sum + Math.abs((room.get(name) ?? 0) - (cellar.get(name) ?? 0)), 0) / 2;
    expect(`guest room against cellar: ${apart.toFixed(2)}`).toBe('guest room against cellar: 0.83');

    // And the guest room is swept. `straw` and `shard` were the same two words
    // as each other, so asking for the rushes asked for the broken floor tile
    // too, and an inn's let room came back 13% rubbish over 400 seeds. It is
    // the cellar that has broken tiles.
    expect([...room.keys()].sort()).toEqual(['bottle', 'mug', 'straw']);
    expect([...cellar.keys()].sort()).toEqual(['sack', 'shard', 'straw']);
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
 * anything. Above it: **29.53** is what `PILLAR_MATERIAL` manages against the
 * worst floor shade in the vocabulary, `slate_floor` variant 0, and 33.1 is the
 * best *any* name reaches against **a dungeon hall's two floors**, which is the
 * pair the name was chosen against. So there is no more headroom to be had from
 * this side of the project. 28 sits above the **21.4** the old wall material
 * manages against the nearest floor — the map that prompted all this — and
 * leaves **1.53** to the one in use.
 *
 * **Those three figures all moved, and the direction is what a reader needs.**
 * The ruler was set when the vocabulary held four floors; it holds nine. The
 * pillar's margin has gone from 4.7 to 1.53 and the old wall material's from
 * 23.4 to 21.4 — neither because anything about pillars changed, and both
 * because every floor added is another shade `tufa_column` has to stand apart
 * from and another chance for one of them to be the new worst. Two thirds of
 * the headroom is spent. **The next front adds materials against 1.53 of it**,
 * so a name that measures between 28 and 29.53 does not fail this ruler and
 * does narrow it further, and a name under 28 fails outright. Measure before
 * naming, not after.
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
    // that prompted this did, and it measured 23.4 against `dirt_floor` and
    // 25.0 against `flagstone` — under the ruler. It was 42.6 against
    // `stone_floor`, which is why "the pillars are invisible" was the wrong
    // diagnosis and "nobody looked at them" was the right one.
    //
    // **21.4 now, and it moved because the floor vocabulary grew rather than
    // because anything about pillars changed.** The nearest floor to
    // `stone_wall` is `oak_floor` variant 0, the library's; `dirt_floor`'s 23.4
    // is what the number was when four floors existed. The claim the anchor
    // makes is the inequality, and the pinned figure is what makes an edit to
    // this file a decision — so it is updated with the floor that supplies it
    // named, not loosened into `toBeLessThan` alone.
    const worst = Math.min(
      ...everyFloorShade().flatMap((shade) =>
        shadesOf('stone_wall').map((wall) => deltaE2000(wall, shade.color)),
      ),
    );
    expect(worst).toBeLessThan(STANDS_OUT);
    expect(Math.round(worst * 10) / 10).toBe(21.4);
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
      for (const spec of resolved(place).scatter) {
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
   * The places each feature is offered for, read out of `vocabulary.ts` through
   * `featuresFor` rather than copied.
   *
   * **It was a copy, and the copy was stale in the direction that mattered.**
   * Written before the crypt and never updated, it omitted that room from
   * `hearth`, `pillars`, `alcove` and `shelving` — four of the crypt's five
   * entries — so the check below had never once run for the room the copy's own
   * neighbours in `vocabulary.ts` cite it as guarding. It passed anyway, because
   * a list short of an entry is a list with nothing to disagree about.
   *
   * The justification the copy carried was that the two fronts were separate
   * worktrees and the agreement could not be imported. It could: this file has
   * imported `featureSuits` and `featuresFor` from that module since the front
   * that wrote the sentence, and reads them three tests further up.
   */
  const FEATURE_PLACES: Record<string, Place[]> = Object.fromEntries(
    FEATURE_VOCABULARY.map((feature) => [
      feature,
      PLACE_TYPES.filter((place) => featuresFor(place).includes(feature as Feature)),
    ]),
  );

  it('is the same ten words the interpreter writes', () => {
    expect([...FEATURE_VOCABULARY].sort()).toEqual([...FEATURES].sort());
  });

  it('offers every word somewhere, so none of the ten is a word with no place', () => {
    // The check the stale copy could not make: read from the live table, a
    // feature nobody can ask for anywhere shows up as an empty list rather than
    // as a line nobody wrote.
    for (const [feature, places] of Object.entries(FEATURE_PLACES)) {
      expect(`${feature}: ${String(places.length)}`).not.toBe(`${feature}: 0`);
    }
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
      const profile = resolved(place);
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

/**
 * The project root, found from this file rather than from the working
 * directory, which vitest does not promise.
 */
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The line `ROOM_REGISTRY` is closed with, and so where a room is inserted. */
const REGISTRY_END = '} satisfies Record<string, RoomGeometry>;';

/** A room with a legal geometry and nothing else — the cheapest one that compiles. */
const EXTRA_ROOM = `  bunkhouse: {
    minSize: { w: 6, h: 6 }, maxSize: { w: 8, h: 8 },
    doorRange: { min: 1, max: 1 }, shapes: ['rectangle'], allowPillars: false,
    anchorRange: { min: 0, max: 0 }, anchors: [],
    groupsPerHundredCells: { min: 0, max: 0 }, groups: [],
    scatterChance: 0,
  },
`;

/**
 * Every file that stops compiling when `bunkhouse` is added to the registry.
 *
 * Four tables, and the point of naming them one by one rather than counting
 * them is that the list is the guarantee. `PROFILES` is the only one in
 * production code; the other three are tests, and they are no less the net for
 * it — `GENERATOR_BOUNDS` is what holds the resolver's size bands to the
 * geometry the generator will actually build, the two in `interpret.test.ts`
 * are the scores a room choice is stubbed with, and `schema.test.ts` is the
 * mutual assignability that ties `constraintsSchema`'s own room enum, which is
 * written out by hand in `schema.ts`, to `RoomKind`.
 */
const EXACT_ON_ROOM_KIND = [
  'src/interpreter/local/interpret.test.ts',
  'src/interpreter/resolve.test.ts',
  'src/interpreter/resolve.ts',
  'src/interpreter/schema.test.ts',
];

/**
 * `npm run typecheck` over a copy of the project with one more room in the
 * registry, and the files it refuses.
 *
 * The copy is what makes this safe to run beside the rest of the suite: the
 * checkout is never written to, so a crash here cannot leave a broken
 * `profiles.ts` behind for the next test file. `node_modules` is linked rather
 * than copied, because it is the one part that is large and the one part the
 * patch does not touch.
 */
function filesRefusingAnExtraRoom(): string[] {
  const root = mkdtempSync(join(tmpdir(), 'gridsmith-exhaustiveness-'));
  try {
    for (const entry of ['src', 'api']) {
      cpSync(join(ROOT, entry), join(root, entry), { recursive: true });
    }
    for (const entry of ['tsconfig.json', 'vite.config.ts']) {
      cpSync(join(ROOT, entry), join(root, entry));
    }
    symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'));

    const profiles = join(root, 'src', 'generator', 'profiles.ts');
    const source = readFileSync(profiles, 'utf8');
    // The insertion point has to be there and be unique, or the patch would be
    // a no-op and this test would report a compiling project as proof that
    // nothing needs an entry.
    expect(source.split(REGISTRY_END)).toHaveLength(2);
    writeFileSync(profiles, source.replace(REGISTRY_END, EXTRA_ROOM + REGISTRY_END));

    const run = spawnSync(
      process.execPath,
      [join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js'), '--noEmit', '-p', join(root, 'tsconfig.json')],
      { cwd: root, encoding: 'utf8' },
    );
    // Read as blocks rather than as lines: `tsc` puts the detail of a nested
    // mismatch on indented continuation lines, and for `schema.test.ts` the new
    // room is named only down there.
    const reported = new Set<string>();
    let file: string | undefined;
    let block = '';
    const close = (): void => {
      if (file === undefined) {
        return;
      }
      // Every refusal has to be about the new room. One that is not would be a
      // project that does not compile for some other reason, and this test
      // would read it as the net biting.
      expect(block).toContain('bunkhouse');
      reported.add(file);
    };
    for (const line of `${run.stdout}${run.stderr}`.split('\n')) {
      const match = /^(\S+?)\(\d+,\d+\): error/.exec(line);
      if (match !== null) {
        close();
        file = match[1];
        block = line;
        continue;
      }
      block += line;
    }
    close();
    return [...reported].sort();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the exhaustiveness the registry is derived for', () => {
  it('stops every exact table compiling until a new room has an entry', () => {
    // **This is what the collapse was not allowed to cost.** `RoomKind` used to
    // be a union written out in `core/types.ts`; it is now `keyof typeof
    // ROOM_REGISTRY`, and the fear with deriving a type from data is that the
    // data stops being checked. It does not: a room added to the registry
    // widens `RoomKind`, and every `Record<RoomKind, …>` that is exact rather
    // than `Partial` refuses to compile until it has been answered. That is the
    // net that caught the hole in `CODE_PHRASES` and the one that forced the
    // crypt front to touch everything it needed to.
    //
    // It is checked by compiling rather than by reading the types, because the
    // property is the compiler's answer and nothing else can stand in for it.
    // `typescript@7` ships no JS compiler API — `import ts from 'typescript'`
    // hands back `{ version, versionMajorMinor }` — so this runs the same `tsc`
    // `npm run typecheck` runs, over a copy of the project.
    expect(filesRefusingAnExtraRoom()).toEqual(EXACT_ON_ROOM_KIND);
  });

  it('leaves the sparse tables alone, because a tavern has no crypt', () => {
    // The other half, and it is a decision rather than an oversight.
    // `BUILDINGS.rooms` is `Partial`, and so were the three tables of words
    // this front folded into it: the matrix of buildings against rooms has a
    // hole in it, and an exact key would have demanded wording for
    // `tavern_crypt`, a place nothing can produce. So the *room* axis of a
    // building cannot be checked by the compiler and is checked by `profileFor`
    // and by the throws in `roomQuestionFor` and `roomTemplateFor` instead —
    // which is why none of those files is in the list above, and why the words
    // moving onto the filling was worth doing: a room a building declares now
    // carries its wording or is not an object at all.
    for (const file of EXACT_ON_ROOM_KIND) {
      expect(file.startsWith('src/interpreter/')).toBe(true);
    }
    expect(EXACT_ON_ROOM_KIND).not.toContain('src/generator/profiles.ts');
  });
});
