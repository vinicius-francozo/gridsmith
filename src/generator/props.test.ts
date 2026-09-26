import { describe, expect, it } from 'vitest';

import { cellAt, cellKey, inBounds, step } from '../core/grid';
import { createRng } from '../core/prng';
import type { Cell, Facing, Floorplan, PlaceType, PlacedProp, Rotation, Size } from '../core/types';
import { buildFloorplan, opposite } from './floorplan';
import { assetIdFor, profileFor, ROTATIONS } from './profiles';
import type { GroupPart, PlaceProfile } from './profiles';
import { placeProps, rotateFootprint, rotateTemplate } from './props';
import { paramsFor, planFrom } from './testing';
import type { Params } from '../core/types';

const PLACE_TYPES: PlaceType[] = ['tavern_hall', 'tavern_room', 'tavern_storeroom'];

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
    PLACE_TYPES.flatMap((placeType) =>
      profileFor(placeType)
        .anchors.map((spec) => spec.feature)
        .filter((feature): feature is string => feature !== undefined),
    ),
  ),
];

/** A furnished room, for one place type and seed. */
function furnished(
  placeType: PlaceType,
  seed: number,
  overrides: Partial<Params> = {},
): { profile: PlaceProfile; floorplan: Floorplan; props: PlacedProp[] } {
  const profile = profileFor(placeType);
  const params = paramsFor(placeType, {
    size: profile.maxSize,
    doorCount: 2,
    features: ANCHOR_FEATURES,
    ...overrides,
  });
  const rng = createRng(seed);
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
    for (const placeType of PLACE_TYPES) {
      for (const group of profileFor(placeType).groups) {
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
    for (const placeType of PLACE_TYPES) {
      for (const group of profileFor(placeType).groups) {
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
    for (const placeType of PLACE_TYPES) {
      for (const group of profileFor(placeType).groups) {
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
    const [long] = profileFor('tavern_hall').groups.filter((group) => group.id === 'long_table');
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
    for (const placeType of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { floorplan, props } = furnished(placeType, seed);
        const anchors = props.filter((prop) => prop.layer === 'anchor');
        expect(anchors.length).toBeGreaterThan(0);
        for (const anchor of anchors) {
          const behind = strip(anchor, BACK[anchor.rotation]).map((cell) =>
            inBounds(cell, floorplan.size) ? cellAt(floorplan.cells, cell) : 'off-grid',
          );
          const label = `${placeType}/${seed} behind the ${anchor.assetId}`;
          expect(`${label}: ${behind.join()}`).toBe(
            `${label}: ${behind.map(() => 'wall').join()}`,
          );
        }
      }
    }
  });

  it('puts a corner anchor against a second wall at right angles to the first', () => {
    const cornerAnchors = new Set(
      PLACE_TYPES.flatMap((placeType) =>
        profileFor(placeType)
          .anchors.filter((spec) => spec.placement === 'corner')
          .map((spec) => assetIdFor('anchor', spec.assetId)),
      ),
    );
    expect(cornerAnchors.size).toBeGreaterThan(0);

    let checked = 0;
    for (const placeType of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { floorplan, props } = furnished(placeType, seed);
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
    for (const placeType of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        for (const anchor of furnished(placeType, seed).props) {
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
    for (const placeType of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { profile, props } = furnished(placeType, seed);
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
  const REQUESTS = PLACE_TYPES.flatMap((placeType) =>
    profileFor(placeType)
      .anchors.filter((spec) => spec.feature !== undefined)
      .map((spec) => ({
        placeType,
        feature: spec.feature as string,
        assetId: assetIdFor('anchor', spec.assetId),
      })),
  );

  it('is asked for by all five of the words an anchor answers to', () => {
    // Without this, deleting `feature` from a spec would delete its test
    // along with it and the suite would stay green at a lower count.
    expect([...new Set(REQUESTS.map((request) => request.feature))].sort()).toEqual([
      'bar',
      'bunks',
      'hearth',
      'shelving',
      'stairs',
    ]);
  });

  for (const { placeType, feature, assetId } of REQUESTS) {
    it(`puts ${assetId} in a ${placeType} that asks for '${feature}'`, () => {
      const missing: number[] = [];
      for (let seed = 0; seed < 30; seed += 1) {
        const { props } = furnished(placeType, seed, { features: [feature] });
        if (!props.some((prop) => prop.assetId === assetId)) {
          missing.push(seed);
        }
      }
      expect(`${placeType} asked for '${feature}', missing on seeds: ${missing.join()}`).toBe(
        `${placeType} asked for '${feature}', missing on seeds: `,
      );
    });
  }
});

describe('the whole prop set', () => {
  it('never puts two props on the same cell', () => {
    for (const placeType of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { props } = furnished(placeType, seed);
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
        expect(`${placeType}/${seed}: ${doubled.join('; ')}`).toBe(`${placeType}/${seed}: `);
      }
    }
  });

  it('never puts a prop anywhere but on floor', () => {
    for (const placeType of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { floorplan, props } = furnished(placeType, seed);
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
    for (const placeType of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { floorplan, props } = furnished(placeType, seed);
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
    for (const placeType of PLACE_TYPES) {
      for (let seed = 0; seed < 15; seed += 1) {
        const { profile, props } = furnished(placeType, seed, { clutter: 1 });
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
    const profileShape = (placeType: PlaceType): string => {
      const profile = profileFor(placeType);
      return JSON.stringify([profile.anchors, profile.groups, profile.scatter]);
    };

    for (const placeType of PLACE_TYPES) {
      for (const seed of [0, 3, 7, 11]) {
        const before = profileShape(placeType);
        const { props } = furnished(placeType, seed);
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

        expect(`${placeType}/${seed} profile: ${profileShape(placeType)}`).toBe(
          `${placeType}/${seed} profile: ${before}`,
        );
        expect(JSON.stringify(furnished(placeType, seed).props)).toBe(scene);
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
    const turnable = (profile: PlaceProfile): Map<string, Size> => {
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
    for (const placeType of PLACE_TYPES) {
      const known = turnable(profileFor(placeType));
      for (let seed = 0; seed < 20; seed += 1) {
        for (const prop of furnished(placeType, seed).props) {
          const unturned = prop.layer === 'group' ? known.get(prop.assetId) : undefined;
          if (unturned === undefined) {
            continue;
          }
          const want = rotateFootprint(unturned, prop.rotation);
          expect(
            `${placeType}/${seed} ${prop.assetId}@${prop.rotation}: ${prop.footprint.w}x${prop.footprint.h}`,
          ).toBe(`${placeType}/${seed} ${prop.assetId}@${prop.rotation}: ${want.w}x${want.h}`);
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
    for (const placeType of PLACE_TYPES) {
      const { props } = furnished(placeType, 4);
      const layers = props.map((prop) => order[prop.layer]);
      expect([...layers].sort((a, b) => a - b)).toEqual(layers);
    }
  });
});

describe('the scatter layer', () => {
  it('drops nothing in a room with no clutter', () => {
    for (const placeType of PLACE_TYPES) {
      const { props } = furnished(placeType, 1, { clutter: 0 });
      expect(props.filter((prop) => prop.layer === 'scatter')).toEqual([]);
    }
  });

  it('drops more in a ruin than in a room somebody keeps tidy', () => {
    const count = (condition: Params['condition']): number =>
      furnished('tavern_hall', 5, { clutter: 1, condition }).props.filter(
        (prop) => prop.layer === 'scatter',
      ).length;
    expect(count('ruined')).toBeGreaterThan(count('tidy'));
  });

  it('only ever names a prop its profile declares', () => {
    for (const placeType of PLACE_TYPES) {
      const { profile, props } = furnished(placeType, 7, { clutter: 1 });
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
      for (const prop of furnished('tavern_hall', seed, { clutter: 1, condition: 'ruined' })
        .props) {
        if (prop.layer === 'scatter') {
          counts.set(prop.assetId, (counts.get(prop.assetId) ?? 0) + 1);
        }
      }
    }

    const drawn = (name: string): number => counts.get(assetIdFor('scatter', name)) ?? 0;
    for (const spec of profileFor('tavern_hall').scatter) {
      expect(`${spec.assetId} at weight ${spec.weight}: ${drawn(spec.assetId)} drawn`).not.toBe(
        `${spec.assetId} at weight ${spec.weight}: 0 drawn`,
      );
    }
    // A mug carries four times the weight of straw; twice as many is the
    // loosest claim that still separates the weights from a flat draw.
    expect(`mug ${drawn('mug')} vs straw ${drawn('straw')}`).toBe(
      `mug ${drawn('mug')} vs straw ${drawn('straw') * 2 < drawn('mug') ? drawn('straw') : 'too many'}`,
    );
  });

  it('drops nothing when the profile declares no scatter at all', () => {
    // `weightedPick` has nothing to draw from, and drawing from it anyway
    // would either throw or return undefined into `assetId`.
    const profile = { ...profileFor('tavern_hall'), scatter: [] };
    const params = paramsFor('tavern_hall', { size: profile.maxSize, clutter: 1 });
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
    const profile = profileFor('tavern_room');
    const params = paramsFor('tavern_room', { clutter: 1 });
    expect(placeProps(floorplan, params, profile, createRng(1))).toEqual([]);
  });
});
