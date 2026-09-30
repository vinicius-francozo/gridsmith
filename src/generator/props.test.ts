import { describe, expect, it } from 'vitest';

import { createPlaceholderLibrary } from '../assets/placeholder';
import { cellAt, cellKey, inBounds, step } from '../core/grid';
import { createRng } from '../core/prng';
import type { Cell, Facing, Floorplan, Place, PlacedProp, Rotation, Size } from '../core/types';
import { buildFloorplan, opposite } from './floorplan';
import { assetIdFor, profileFor, resolveAssets, ROTATIONS } from './profiles';
import type { GroupPart, ResolvedProfile } from './profiles';
import { placeProps, rotateFootprint, rotateTemplate } from './props';
import { paramsFor, planFrom } from './test-fixtures';
import type { Params } from '../core/types';

const PLACE_TYPES: Place[] = [{ building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' }, { building: 'tavern', room: 'storeroom' }];

const library = createPlaceholderLibrary();

/**
 * A profile with its variants drawn, the way `generate` hands one to this
 * stage.
 *
 * The seed is here because the draw is one: a slot names a concept and the
 * library is asked which pieces carry it at that footprint. It settles to one
 * candidate for every slot the seven rooms declare today, so nothing below
 * depends on which seed this is — but the argument is real, and a variant added
 * to the library would make it matter.
 */
function resolved(place: Place, rng = createRng(1)): ResolvedProfile {
  return resolveAssets(profileFor(place), library, rng);
}

/** Which wall a prop has its back to, per rotation. Mirrors `BACK_OF`. */
const BACK: Record<Rotation, Facing> = { 0: 'n', 90: 'e', 180: 's', 270: 'w' };

/**
 * The vocabulary words an anchor answers to, read off the profiles.
 *
 * Written out by hand this list had drifted: it asked for `bed` and
 * `shelves`, neither of which is in `FEATURE_VOCABULARY` — the word is
 * `shelving` — so two of the five requests were silently doing nothing while
 * `profiles.test.ts` guarded the vocabulary a file away. Deriving it means
 * the helper cannot disagree with the profiles it is furnishing from.
 */
const ANCHOR_FEATURES: string[] = [
  ...new Set(
    PLACE_TYPES.flatMap((place) =>
      profileFor(place)
        .anchors.map((spec) => spec.feature)
        .filter((feature): feature is string => feature !== undefined),
    ),
  ),
];

/** A furnished room, for one place type and seed. */
function furnished(
  place: Place,
  seed: number,
  overrides: Partial<Params> = {},
): { profile: ResolvedProfile; floorplan: Floorplan; props: PlacedProp[] } {
  // One `Rng`, drawn from in the order `generate` draws from it: the variants
  // first, then the plan, then the props. A second generator here would let
  // this helper agree with the real pipeline on the assets and disagree on
  // every rotation.
  const rng = createRng(seed);
  const profile = resolved(place, rng);
  const params = paramsFor(place, {
    size: profile.maxSize,
    doorCount: 2,
    features: ANCHOR_FEATURES,
    ...overrides,
  });
  const { floorplan } = buildFloorplan(params, profile, rng);
  return { profile, floorplan, props: placeProps(floorplan, params, profile, rng) };
}

/** Every cell a prop stands on. */
function propCells(prop: PlacedProp): Cell[] {
  const cells: Cell[] = [];
  for (let dy = 0; dy < prop.footprint.h; dy += 1) {
    for (let dx = 0; dx < prop.footprint.w; dx += 1) {
      cells.push({ x: prop.cell.x + dx, y: prop.cell.y + dy });
    }
  }
  return cells;
}

/** The strip of cells just outside a prop on the given side. */
function strip(prop: PlacedProp, facing: Facing): Cell[] {
  const { x, y } = prop.cell;
  const { w, h } = prop.footprint;
  const cells: Cell[] = [];
  if (facing === 'n' || facing === 's') {
    const row = facing === 'n' ? y - 1 : y + h;
    for (let i = 0; i < w; i += 1) {
      cells.push({ x: x + i, y: row });
    }
  } else {
    const column = facing === 'w' ? x - 1 : x + w;
    for (let i = 0; i < h; i += 1) {
      cells.push({ x: column, y: y + i });
    }
  }
  return cells;
}

describe('rotateFootprint', () => {
  it('swaps the sides on a quarter turn and leaves them on a half turn', () => {
    const footprint = { w: 5, h: 2 };
    expect(rotateFootprint(footprint, 0)).toEqual({ w: 5, h: 2 });
    expect(rotateFootprint(footprint, 90)).toEqual({ w: 2, h: 5 });
    expect(rotateFootprint(footprint, 180)).toEqual({ w: 5, h: 2 });
    expect(rotateFootprint(footprint, 270)).toEqual({ w: 2, h: 5 });
  });

  it('gives back a new object rather than the one it was handed', () => {
    const footprint = { w: 3, h: 1 };
    expect(rotateFootprint(footprint, 0)).not.toBe(footprint);
  });
});

describe('rotateTemplate', () => {
  const size = { w: 3, h: 1 };
  const parts: GroupPart[] = [
    { assetId: 'head', offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
    { assetId: 'tail', offset: { x: 2, y: 0 }, footprint: { w: 1, h: 1 } },
  ];

  it('leaves a template alone at rotation zero', () => {
    expect(rotateTemplate(size, parts, 0)).toEqual({ size, parts });
  });

  it('stands a row on end at a quarter turn clockwise', () => {
    expect(rotateTemplate(size, parts, 90)).toEqual({
      size: { w: 1, h: 3 },
      parts: [
        { assetId: 'head', offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
        { assetId: 'tail', offset: { x: 0, y: 2 }, footprint: { w: 1, h: 1 } },
      ],
    });
  });

  it('reverses a row at a half turn', () => {
    expect(rotateTemplate(size, parts, 180).parts.map((part) => part.offset)).toEqual([
      { x: 2, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('stands a row on end the other way at three quarter turns', () => {
    expect(rotateTemplate(size, parts, 270)).toEqual({
      size: { w: 1, h: 3 },
      parts: [
        { assetId: 'head', offset: { x: 0, y: 2 }, footprint: { w: 1, h: 1 } },
        { assetId: 'tail', offset: { x: 0, y: 0 }, footprint: { w: 1, h: 1 } },
      ],
    });
  });

  it('shares no object with the template it was handed, at any rotation', () => {
    // `rotateTemplate` is handed the array held in `PROFILES`. A part given
    // back by identity — which the identity turn and the half turn used to do
    // — puts the profile's own `Size` into a `PlacedProp`, and from there
    // into the renderer's hands. One consumer normalising it in place would
    // rewrite the generator's profile for the rest of the session.
    for (const place of PLACE_TYPES) {
      for (const group of profileFor(place).groups) {
        for (const rotation of ROTATIONS) {
          const turned = rotateTemplate(group.size, group.parts, rotation);
          expect(turned.size).not.toBe(group.size);
          for (const part of turned.parts) {
            expect(group.parts).not.toContain(part);
            for (const original of group.parts) {
              expect(part.footprint).not.toBe(original.footprint);
              expect(part.offset).not.toBe(original.offset);
            }
          }
        }
      }
    }
  });

  it('keeps every part inside the turned box, for every template of every profile', () => {
    // A part that slid outside its own box would be placed against a
    // candidate check that never looked at the cell it actually lands on.
    for (const place of PLACE_TYPES) {
      for (const group of profileFor(place).groups) {
        for (const rotation of ROTATIONS) {
          const turned = rotateTemplate(group.size, group.parts, rotation);
          for (const part of turned.parts) {
            expect(part.offset.x).toBeGreaterThanOrEqual(0);
            expect(part.offset.y).toBeGreaterThanOrEqual(0);
            expect(part.offset.x + part.footprint.w).toBeLessThanOrEqual(turned.size.w);
            expect(part.offset.y + part.footprint.h).toBeLessThanOrEqual(turned.size.h);
          }
        }
      }
    }
  });

  it('comes back to where it started after four quarter turns', () => {
    for (const place of PLACE_TYPES) {
      for (const group of profileFor(place).groups) {
        let turned = { size: group.size, parts: group.parts };
        for (let i = 0; i < 4; i += 1) {
          turned = rotateTemplate(turned.size, turned.parts, 90);
        }
        expect(turned).toEqual({ size: group.size, parts: group.parts });
      }
    }
  });

  it('keeps the parts in the same arrangement relative to one another', () => {
    // A bench that turns while its table does not is no longer a long table.
    const [long] = profileFor({ building: 'tavern', room: 'hall' }).groups.filter((group) => group.id === 'long_table');
    expect(long).toBeDefined();
    const turned = rotateTemplate(long.size, long.parts, 90);
    expect(turned.parts.map((part) => part.assetId)).toEqual(['bench', 'table_long', 'bench']);
    expect(turned.parts.map((part) => part.offset.x)).toEqual([2, 1, 0]);
    for (const part of turned.parts) {
      expect(part.footprint).toEqual({ w: 1, h: 3 });
    }
  });
});

describe('the anchor layer', () => {
  it('puts every anchor with its back flat against a wall', () => {
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { floorplan, props } = furnished(place, seed);
        const anchors = props.filter((prop) => prop.layer === 'anchor');
        expect(anchors.length).toBeGreaterThan(0);
        for (const anchor of anchors) {
          const behind = strip(anchor, BACK[anchor.rotation]).map((cell) =>
            inBounds(cell, floorplan.size) ? cellAt(floorplan.cells, cell) : 'off-grid',
          );
          const label = `${place}/${seed} behind the ${anchor.assetId}`;
          expect(`${label}: ${behind.join()}`).toBe(
            `${label}: ${behind.map(() => 'wall').join()}`,
          );
        }
      }
    }
  });

  it('puts a corner anchor against a second wall at right angles to the first', () => {
    const cornerAnchors = new Set(
      PLACE_TYPES.flatMap((place) =>
        resolved(place)
          .anchors.filter((spec) => spec.placement === 'corner')
          .map((spec) => assetIdFor('anchor', spec.assetId)),
      ),
    );
    expect(cornerAnchors.size).toBeGreaterThan(0);

    let checked = 0;
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { floorplan, props } = furnished(place, seed);
        for (const anchor of props) {
          if (anchor.layer !== 'anchor' || !cornerAnchors.has(anchor.assetId)) {
            continue;
          }
          const back = BACK[anchor.rotation];
          const laterals: Facing[] = back === 'n' || back === 's' ? ['e', 'w'] : ['n', 's'];
          const against = laterals.some((facing) =>
            strip(anchor, facing).every(
              (cell) =>
                inBounds(cell, floorplan.size) && cellAt(floorplan.cells, cell) === 'wall',
            ),
          );
          expect(against).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('stands anchors against every wall of the room, not only the north one', () => {
    // `anchorCandidates` iterating only `ROTATIONS[0]` passes every other
    // test in this file: the anchors still back onto a wall, still record a
    // turned footprint, still fit and still answer the features. They would
    // simply all have their backs to the north wall, and nobody would see it
    // until the map was drawn.
    const seen = new Set<Rotation>();
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        for (const anchor of furnished(place, seed).props) {
          if (anchor.layer === 'anchor') {
            seen.add(anchor.rotation);
          }
        }
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([...ROTATIONS]);
  });

  it('records an anchor footprint already turned, not waiting to be turned', () => {
    // The renderer reads `footprint` as the cells the prop actually covers
    // and applies no transform. An unturned footprint here would draw every
    // quarter-turned prop transposed — a 5x2 counter as 2x5 — and nothing in
    // the frozen types would catch it.
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { profile, props } = furnished(place, seed);
        for (const prop of props.filter((p) => p.layer === 'anchor')) {
          const [spec] = profile.anchors.filter(
            (a) => assetIdFor('anchor', a.assetId) === prop.assetId,
          );
          expect(spec).toBeDefined();
          expect(prop.footprint).toEqual(rotateFootprint(spec.footprint, prop.rotation));
        }
      }
    }
  });

});

describe('the anchor a feature asks for by name', () => {
  /**
   * Every (place, word, anchor) the profiles answer to, read off the profiles
   * rather than listed here: a word that lost its anchor has to make a test
   * go red, not make one quietly stop existing.
   *
   * The mechanism it covers is one line — the requested anchors going to the
   * front of the order — and a room draws two or three of the three anchors a
   * hall offers anyway, so a single word on a single seed is satisfied by
   * chance seventeen times in twenty. Each word is therefore asked for alone,
   * over a run of seeds wide enough that luck cannot carry it.
   */
  const REQUESTS = PLACE_TYPES.flatMap((place) =>
    resolved(place)
      .anchors.filter((spec) => spec.feature !== undefined)
      .map((spec) => ({
        place,
        feature: spec.feature as string,
        assetId: assetIdFor('anchor', spec.assetId),
      })),
  );

  it('is asked for by all six of the words an anchor in a tavern answers to', () => {
    // Without this, deleting `feature` from a spec would delete its test
    // along with it and the suite would stay green at a lower count.
    //
    // `PLACE_TYPES` in this file is the tavern's three, so only the words a
    // tavern room answers to reach here — `weapons` and `tomb` are the dungeon
    // hall's and the crypt's and are covered in `profiles.test.ts`. `bed` is
    // the one this front adds on this side.
    expect([...new Set(REQUESTS.map((request) => request.feature))].sort()).toEqual([
      'bar',
      'bed',
      'bunks',
      'hearth',
      'shelving',
      'stairs',
    ]);
  });

  for (const { place, feature, assetId } of REQUESTS) {
    it(`puts ${assetId} in a ${place} that asks for '${feature}'`, () => {
      const missing: number[] = [];
      for (let seed = 0; seed < 30; seed += 1) {
        const { props } = furnished(place, seed, { features: [feature] });
        if (!props.some((prop) => prop.assetId === assetId)) {
          missing.push(seed);
        }
      }
      expect(`${place} asked for '${feature}', missing on seeds: ${missing.join()}`).toBe(
        `${place} asked for '${feature}', missing on seeds: `,
      );
    });
  }
});

describe('the whole prop set', () => {
  it('never puts two props on the same cell', () => {
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { props } = furnished(place, seed);
        const taken = new Set<string>();
        const doubled: string[] = [];
        for (const prop of props) {
          for (const cell of propCells(prop)) {
            if (taken.has(cellKey(cell))) {
              doubled.push(`${prop.assetId} at ${cellKey(cell)}`);
            }
            taken.add(cellKey(cell));
          }
        }
        expect(`${place}/${seed}: ${doubled.join('; ')}`).toBe(`${place}/${seed}: `);
      }
    }
  });

  it('never puts a prop anywhere but on floor', () => {
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { floorplan, props } = furnished(place, seed);
        for (const prop of props) {
          for (const cell of propCells(prop)) {
            expect(inBounds(cell, floorplan.size)).toBe(true);
            expect(cellAt(floorplan.cells, cell)).toBe('floor');
          }
        }
      }
    }
  });

  it('keeps the ground in front of every door clear, scatter included', () => {
    // A mug in the doorway blocks the door as surely as a crate does.
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { floorplan, props } = furnished(place, seed);
        const taken = new Set(props.flatMap(propCells).map(cellKey));
        for (const door of floorplan.doors) {
          const approach = step(door.cell, opposite(door.facing));
          expect(taken.has(cellKey(door.cell))).toBe(false);
          expect(taken.has(cellKey(approach))).toBe(false);
        }
      }
    }
  });

  it('names every prop with the `<kind>/<name>` id the asset library is indexed by', () => {
    // The library resolves a prop by this exact string and `bitmap()` throws
    // on an id it does not know, so a bare name here is not a cosmetic
    // difference: it is every prop of every scene failing to render.
    for (const place of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { profile, props } = furnished(place, seed, { clutter: 1 });
        const declared = new Set([
          ...profile.anchors.map((spec) => assetIdFor('anchor', spec.assetId)),
          ...profile.groups.flatMap((group) =>
            group.parts.map((part) => assetIdFor('group', part.assetId)),
          ),
          ...profile.scatter.map((spec) => assetIdFor('scatter', spec.assetId)),
        ]);
        expect(props.length).toBeGreaterThan(0);
        for (const prop of props) {
          expect(`${prop.assetId} (${prop.layer} layer)`).toBe(
            `${prop.layer}/${prop.assetId.split('/').slice(1).join('/')} (${prop.layer} layer)`,
          );
          expect([...declared]).toContain(prop.assetId);
        }
      }
    }
  });

  it('hands every prop a footprint object of its own, reaching into no profile', () => {
    // A consumer — the renderer, the interface — that normalises or scales a
    // footprint in place must not be able to write into `PROFILES`. If it
    // could, the generator's own profile would stay corrupt for the rest of
    // the browser session and two calls to `generate` under one seed would
    // hand back different scenes: no exception, no log, no red test. That is
    // the silent loss of the invariant the whole project rests on, and it is
    // exactly what a group part handed back by identity at rotation 0 or 180
    // used to do.
    const profileShape = (place: Place): string => {
      const profile = resolved(place);
      return JSON.stringify([profile.anchors, profile.groups, profile.scatter]);
    };

    for (const place of PLACE_TYPES) {
      for (const seed of [0, 3, 7, 11]) {
        const before = profileShape(place);
        const { props } = furnished(place, seed);
        expect(props.length).toBeGreaterThan(0);
        const scene = JSON.stringify(props);

        const handedOut: Size[] = [];
        for (const prop of props) {
          // Two props sharing one object is the same bug one step removed.
          expect(handedOut).not.toContain(prop.footprint);
          handedOut.push(prop.footprint);
          prop.footprint.w = 99;
          prop.footprint.h = 99;
        }

        expect(`${place}/${seed} profile: ${profileShape(place)}`).toBe(
          `${place}/${seed} profile: ${before}`,
        );
        expect(JSON.stringify(furnished(place, seed).props)).toBe(scene);
      }
    }
  });

  it('records a group prop footprint already turned, exactly as an anchor does', () => {
    // `rotateTemplate` is well covered on its own, but nothing checked its
    // point of use. Dropping the call in `groupCandidates` while still
    // recording the rotation on the `PlacedProp` passes every other test —
    // the parts still fit, still land on floor, still do not overlap — and
    // every group prop at a quarter turn renders transposed. That is word
    // for word what the frozen contract warns about, and the anchors have
    // this test while the groups did not.
    /** Group part ids that name exactly one footprint, and a non-square one. */
    const turnable = (profile: ResolvedProfile): Map<string, Size> => {
      const declared = new Map<string, Size[]>();
      for (const group of profile.groups) {
        for (const part of group.parts) {
          declared.set(part.assetId, [...(declared.get(part.assetId) ?? []), part.footprint]);
        }
      }
      const single = new Map<string, Size>();
      for (const [assetId, found] of declared) {
        const shapes = new Set(found.map((size) => `${size.w}x${size.h}`));
        const [first] = found;
        if (shapes.size === 1 && first.w !== first.h) {
          single.set(assetIdFor('group', assetId), first);
        }
      }
      return single;
    };

    let quarterTurned = 0;
    for (const place of PLACE_TYPES) {
      const known = turnable(resolved(place));
      for (let seed = 0; seed < 20; seed += 1) {
        for (const prop of furnished(place, seed).props) {
          const unturned = prop.layer === 'group' ? known.get(prop.assetId) : undefined;
          if (unturned === undefined) {
            continue;
          }
          const want = rotateFootprint(unturned, prop.rotation);
          expect(
            `${place}/${seed} ${prop.assetId}@${prop.rotation}: ${prop.footprint.w}x${prop.footprint.h}`,
          ).toBe(`${place}/${seed} ${prop.assetId}@${prop.rotation}: ${want.w}x${want.h}`);
          if (prop.rotation === 90 || prop.rotation === 270) {
            quarterTurned += 1;
          }
        }
      }
    }
    // Without a quarter-turned group the assertion above says nothing.
    expect(`quarter-turned group props checked: ${quarterTurned > 0}`).toBe(
      'quarter-turned group props checked: true',
    );
  });

  it('returns the layers in drawing order: anchors, then groups, then scatter', () => {
    const order = { anchor: 0, group: 1, scatter: 2 };
    for (const place of PLACE_TYPES) {
      const { props } = furnished(place, 4);
      const layers = props.map((prop) => order[prop.layer]);
      expect([...layers].sort((a, b) => a - b)).toEqual(layers);
    }
  });
});

describe('the scatter layer', () => {
  it('drops nothing in a room with no clutter', () => {
    for (const place of PLACE_TYPES) {
      const { props } = furnished(place, 1, { clutter: 0 });
      expect(props.filter((prop) => prop.layer === 'scatter')).toEqual([]);
    }
  });

  it('drops more in a ruin than in a room somebody keeps tidy', () => {
    const count = (condition: Params['condition']): number =>
      furnished({ building: 'tavern', room: 'hall' }, 5, { clutter: 1, condition }).props.filter(
        (prop) => prop.layer === 'scatter',
      ).length;
    expect(count('ruined')).toBeGreaterThan(count('tidy'));
  });

  it('only ever names a prop its profile declares', () => {
    for (const place of PLACE_TYPES) {
      const { profile, props } = furnished(place, 7, { clutter: 1 });
      const declared = profile.scatter.map((spec) => assetIdFor('scatter', spec.assetId));
      for (const prop of props.filter((p) => p.layer === 'scatter')) {
        expect(declared).toContain(prop.assetId);
        expect(prop.footprint).toEqual({ w: 1, h: 1 });
      }
    }
  });

  it('draws debris in proportion to the weights its profile declares', () => {
    // `weightedPick` returning the first spec every time passes every other
    // test: every id is still one the profile declares and every footprint
    // is still 1x1. The weights would just be decoration on the page.
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 20; seed += 1) {
      for (const prop of furnished({ building: 'tavern', room: 'hall' }, seed, { clutter: 1, condition: 'ruined' })
        .props) {
        if (prop.layer === 'scatter') {
          counts.set(prop.assetId, (counts.get(prop.assetId) ?? 0) + 1);
        }
      }
    }

    const drawn = (name: string): number => counts.get(assetIdFor('scatter', name)) ?? 0;
    for (const spec of resolved({ building: 'tavern', room: 'hall' }).scatter) {
      expect(`${spec.assetId} at weight ${spec.weight}: ${drawn(spec.assetId)} drawn`).not.toBe(
        `${spec.assetId} at weight ${spec.weight}: 0 drawn`,
      );
    }
    // A mug stands on the taproom's `tableware` rung at 3 and straw on its
    // `clutter` rung at 1; twice as many is the loosest claim that still
    // separates the weights from a flat draw. Straw is still on the floor,
    // which is the half of this that says a lighter rung is not an excluded
    // one.
    expect(`mug ${drawn('mug')} vs straw ${drawn('straw')}`).toBe(
      `mug ${drawn('mug')} vs straw ${drawn('straw') * 2 < drawn('mug') ? drawn('straw') : 'too many'}`,
    );
  });

  it('drops nothing when the profile declares no scatter at all', () => {
    // `weightedPick` has nothing to draw from, and drawing from it anyway
    // would either throw or return undefined into `assetId`.
    const profile = { ...resolved({ building: 'tavern', room: 'hall' }), scatter: [] };
    const params = paramsFor({ building: 'tavern', room: 'hall' }, { size: profile.maxSize, clutter: 1 });
    const rng = createRng(3);
    const { floorplan } = buildFloorplan(params, profile, rng);
    const props = placeProps(floorplan, params, profile, rng);
    expect(props.filter((prop) => prop.layer === 'scatter')).toEqual([]);
  });
});

describe('placeProps on a hand-drawn plan', () => {
  it('leaves a room with no floor to spare empty of furniture', () => {
    const floorplan = planFrom([
      '###',
      'D.#',
      '###',
    ]);
    const profile = resolved({ building: 'tavern', room: 'room' });
    const params = paramsFor({ building: 'tavern', room: 'room' }, { clutter: 1 });
    expect(placeProps(floorplan, params, profile, createRng(1))).toEqual([]);
  });
});

describe('an anchor the description refused', () => {
  /**
   * Every (place, word, anchor) again, read off the profiles for the reason
   * `REQUESTS` gives. The claim on this side is the stronger one — the anchor
   * must be absent on *every* seed, not present on every seed — so it is worth
   * asking over the same run.
   */
  const REFUSALS = PLACE_TYPES.flatMap((place) =>
    resolved(place)
      .anchors.filter((spec) => spec.feature !== undefined)
      .map((spec) => ({
        place,
        feature: spec.feature as string,
        assetId: assetIdFor('anchor', spec.assetId),
      })),
  );

  for (const { place, feature, assetId } of REFUSALS) {
    it(`never puts ${assetId} in a ${place.building}_${place.room} that refuses '${feature}'`, () => {
      // Defect D2. The fill drew from the whole profile, so a description that
      // said "sem escadaria" got a staircase anyway and `conflicts` came back
      // empty — nothing anywhere said no had been ignored. Thirty seeds
      // because the fill is a draw: one seed that happens not to pick the
      // anchor proves nothing.
      const drawn: number[] = [];
      for (let seed = 0; seed < 30; seed += 1) {
        const { props } = furnished(place, seed, { features: [], excluded: [feature] });
        if (props.some((prop) => prop.assetId === assetId)) {
          drawn.push(seed);
        }
      }
      expect(`${place.building}_${place.room} refused '${feature}', drawn on seeds: ${drawn.join()}`).toBe(
        `${place.building}_${place.room} refused '${feature}', drawn on seeds: `,
      );
    });
  }

  it('keeps filling the room from what is left, so a refusal does not empty it', () => {
    // The risk this rule was written against: stopping the fill as soon as the
    // requested anchors ran out would leave a dungeon hall with nothing against
    // any of its walls, which is the reading of "sem escadaria" that looks
    // broken. `weapon_rack` carries no feature, so nothing can refuse it.
    const place: Place = { building: 'dungeon', room: 'hall' };
    const empty: number[] = [];
    for (let seed = 0; seed < 30; seed += 1) {
      const { props } = furnished(place, seed, { features: [], excluded: ['hearth', 'stairs'] });
      if (!props.some((prop) => prop.layer === 'anchor')) {
        empty.push(seed);
      }
    }
    expect(`dungeon_hall with both featured anchors refused, bare on seeds: ${empty.join()}`).toBe(
      'dungeon_hall with both featured anchors refused, bare on seeds: ',
    );
  });

  it('leaves the walls bare when every anchor of the place is in `excluded`', () => {
    // The one case where the refusal outranks the filling. A tavern storeroom
    // offers two anchors and both carry a feature, so refusing both leaves the
    // draw nothing to offer.
    //
    // Not named "refused by name": `excluded` is not only what the person said,
    // and `props.ts` says how often it is not. What is pinned here is the rule,
    // not a claim about why the list looks the way it does — filling from the
    // refused anchors instead would put back the staircase this whole field
    // exists to keep out.
    const place: Place = { building: 'tavern', room: 'storeroom' };
    for (let seed = 0; seed < 12; seed += 1) {
      const { props } = furnished(place, seed, { features: [], excluded: ['shelving', 'stairs'] });
      expect(`seed ${String(seed)}: ${String(props.filter((prop) => prop.layer === 'anchor').length)} anchors`)
        .toBe(`seed ${String(seed)}: 0 anchors`);
    }
  });
});

describe('the two dials over the group layer', () => {
  const groupCount = (props: PlacedProp[]): number =>
    props.filter((prop) => prop.layer === 'group').length;

  it('counts groups off furnishing and not off clutter', () => {
    // Defect D3, at the line that computes the target rather than at a whole
    // scene. `clutter` swept across its range with `furnishing` held still has
    // to leave the count alone; before the split it multiplied it.
    for (const place of PLACE_TYPES) {
      const counts = [0, 0.5, 1].map(
        (clutter) => groupCount(furnished(place, 7, { clutter, furnishing: 0.5 }).props),
      );
      expect(`${place.building}_${place.room} groups at clutter 0 / 0.5 / 1: ${counts.join(' / ')}`).toBe(
        `${place.building}_${place.room} groups at clutter 0 / 0.5 / 1: ${String(counts[0])} / ${String(counts[0])} / ${String(counts[0])}`,
      );
    }
  });

  it('draws more groups as furnishing rises, in every place', () => {
    for (const place of PLACE_TYPES) {
      const sparse = groupCount(furnished(place, 7, { furnishing: 0, clutter: 0.5 }).props);
      const crowded = groupCount(furnished(place, 7, { furnishing: 1, clutter: 0.5 }).props);
      expect(`${place.building}_${place.room}: ${String(sparse)} then ${String(crowded)}`).toBe(
        `${place.building}_${place.room}: ${String(sparse)} then ${String(Math.max(crowded, sparse + 1))}`,
      );
    }
  });

  it('fits the crypt furniture into the smallest crypt there is', () => {
    // `furnished` builds at `profile.maxSize` by default, so nothing else in
    // this file exercises a room anywhere near its floor — `minSize` does not
    // otherwise appear in it. That matters because an anchor with no wall long
    // enough for it does not fail, it silently drops out (`AnchorSpec.feature`
    // says so), and a crypt is the tightest room that carries a 4x1 niche and a
    // 3x2 sarcophagus.
    const place: Place = { building: 'dungeon', room: 'crypt' };
    const profile = profileFor(place);
    for (let seed = 1; seed <= 20; seed += 1) {
      const { props } = furnished(place, seed, {
        size: profile.minSize, features: [], furnishing: 0.5, clutter: 0.3,
      });
      const anchors = props.filter((prop) => prop.layer === 'anchor');
      expect(`seed ${String(seed)}: ${String(anchors.length)} anchors in an ${String(profile.minSize.w)}x${String(profile.minSize.h)} crypt`)
        .not.toBe(`seed ${String(seed)}: 0 anchors in an ${String(profile.minSize.w)}x${String(profile.minSize.h)} crypt`);
    }
  });

  it('leaves the sarcophagus standing however much of the crypt is refused', () => {
    // The net, and it is the featureless anchor rather than `anchorRange.min`.
    // `anchorOrder` drops any anchor whose feature is in `excluded`; the
    // crypt's fourth slot has no feature, so it cannot be named and cannot be
    // refused. This is not hypothetical — it is the map the crypt front exists
    // for. The live model read "catacumba **escura**" as a refusal of `hearth`
    // and returned `excluded: ['bar', 'hearth', 'stairs', 'bunks']`, which
    // takes the brazier out before the draw starts; `shelving` going the same
    // way would take the bone niche too.
    //
    // **The list is the whole vocabulary and has to stay that way**, and the
    // two states it was measured in are worth separating, because they say
    // different things and reading one for the other is how a comment goes
    // wrong (see the count `templates.ts` shipped, "two" beside a sentence
    // naming three, for four rounds).
    //
    // - With the word given to `tomb` and **this slot not yet added**, the list
    //   of seven left this test **green** while it had stopped testing
    //   anything: `tomb` was not in it, so the only wordless slot in the room
    //   had just become a worded one, nothing held the wall up, and the
    //   assertion still passed. That state is what the ten are for.
    // - At **HEAD**, with the net in place, the list of seven turns this test
    //   **red** — `anchor/sarcophagus anchor/sarcophagus` against the one the
    //   assertion asks for, because the slot the word names goes unrefused and
    //   is drawn beside the net.
    //
    // So the update was necessary, and the green belongs to the intermediate
    // state, not to the one in the tree. The ten are written out rather than
    // imported for the reason the file's own fixtures are: both sides moving
    // together assert nothing.
    const everyFeature = [
      'bar', 'hearth', 'stairs', 'pillars', 'alcove', 'shelving', 'bunks',
      'bed', 'weapons', 'tomb',
    ];
    for (let seed = 1; seed <= 20; seed += 1) {
      const { props } = furnished({ building: 'dungeon', room: 'crypt' }, seed, {
        features: [], excluded: everyFeature, furnishing: 0.5, clutter: 0.3,
      });
      const anchors = props.filter((prop) => prop.layer === 'anchor').map((prop) => prop.assetId);
      expect(`seed ${String(seed)}: ${anchors.join(' ')}`)
        .toBe(`seed ${String(seed)}: ${assetIdFor('anchor', 'sarcophagus')}`);
    }
  });

  it('never leaves a crypt with nothing but its brazier', () => {
    // Why `anchorRange.min` is 2 in the crypt's profile. `anchorOrder` draws
    // from the three anchors, so at a floor of one, one crypt in nine comes
    // back holding only the votive brazier — a lit sconce on a wall, which
    // reads as no particular room. At two, any draw takes two of three and so
    // cannot miss both the sarcophagus and the bone niche, which are the pieces
    // that say *crypt* on the map. The map is the only place the person checks.
    //
    // `features: []` is load-bearing and the mutation sweep is how that was
    // found out. `furnished` asks for every featured anchor by default, so both
    // the bone niche and the brazier arrive already requested, the order starts
    // with them whatever `anchorRange.min` says, and the floor is never
    // exercised: written that way this test passed with `min` set back to 1.
    for (let seed = 1; seed <= 40; seed += 1) {
      const { props } = furnished({ building: 'dungeon', room: 'crypt' }, seed, { features: [], furnishing: 0.5, clutter: 0.3 });
      const anchors = props.filter((prop) => prop.layer === 'anchor').map((prop) => prop.assetId);
      const speaking = anchors.filter(
        (id) => id === assetIdFor('anchor', 'sarcophagus') || id === assetIdFor('anchor', 'bone_niche'),
      );
      expect(`seed ${String(seed)}: ${String(speaking.length)} of ${String(anchors.length)} say crypt`)
        .not.toBe(`seed ${String(seed)}: 0 of ${String(anchors.length)} say crypt`);
    }
  });

  it('empties the crypt when asked for no furniture, and never the common room', () => {
    // `groupTarget` scales between the profile's two numbers, so the `min` is a
    // floor the dial cannot get under: at `furnishing: 0` a hall still comes
    // back with groups in it, because a common room with no tables is not a
    // common room. A crypt is different — a burial chamber with nothing
    // standing in it is an ordinary burial chamber — and that difference is a
    // `min: 0` in `profiles.ts`, not a special case here.
    for (const seed of [1, 7, 2985161997]) {
      const crypt = furnished({ building: 'dungeon', room: 'crypt' }, seed, { furnishing: 0, clutter: 0.8 });
      const hall = furnished({ building: 'dungeon', room: 'hall' }, seed, { furnishing: 0, clutter: 0.8 });
      expect(`seed ${String(seed)}: ${String(groupCount(crypt.props))} in the crypt`)
        .toBe(`seed ${String(seed)}: 0 in the crypt`);
      expect(groupCount(hall.props)).toBeGreaterThan(0);
      // And the dirt is still there, which is the whole of what was asked for.
      expect(crypt.props.filter((prop) => prop.layer === 'scatter').length).toBeGreaterThan(0);
    }
  });

  it('leaves the scatter layer to clutter alone', () => {
    // The other half of the separation. A bare floor stays bare however much
    // furniture stands on it.
    for (const furnishing of [0, 1]) {
      const { props } = furnished({ building: 'tavern', room: 'hall' }, 7, { clutter: 0, furnishing });
      expect(`furnishing ${String(furnishing)} at clutter 0: ${String(props.filter((p) => p.layer === 'scatter').length)} scattered`)
        .toBe(`furnishing ${String(furnishing)} at clutter 0: 0 scattered`);
    }
  });
});
