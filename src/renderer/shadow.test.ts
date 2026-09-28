import { describe, expect, it } from 'vitest';

import { FACINGS, inBounds, step } from '../core/grid';
import { PIXELS_PER_CELL } from '../core/types';
import type { Cell, CellKind, Floorplan, LightSource, PlacedProp, Size } from '../core/types';
import type { PixelRect } from '../assets/contract';
import { cellRect, propRect } from './geometry';
import { SHADOW_COLOR, clipToFloor, lightInfluence, propShadow, sceneShadows } from './shadow';
import type { Shadow } from './shadow';

/** A one-cell anchor at (5, 5), with the field under test overridden. */
function prop(overrides: Partial<PlacedProp> = {}): PlacedProp {
  return {
    assetId: 'anchor/hearth',
    cell: { x: 5, y: 5 },
    footprint: { w: 1, h: 1 },
    rotation: 0,
    layer: 'anchor',
    ...overrides,
  };
}

function light(overrides: Partial<LightSource> = {}): LightSource {
  return { cell: { x: 2, y: 5 }, radiusCells: 6, colorHex: '#ffd9a0', ...overrides };
}

/**
 * A plan drawn as art, one character per cell: `#` wall, `.` floor, a space
 * void. Doors and wall segments are left empty — the cut reads cells alone.
 *
 * @throws {Error} if a row is a different length from the first. A short row
 *                 reads past its end as `undefined`, which is neither floor
 *                 nor wall, and the cut under test would be judged against a
 *                 plan nobody drew.
 */
function planFrom(rows: string[]): Floorplan {
  const size: Size = { w: rows[0].length, h: rows.length };
  const cells: CellKind[][] = rows.map((row, y) => {
    if (row.length !== size.w) {
      throw new Error(`planFrom(): row ${y} is ${row.length} characters, expected ${size.w}`);
    }
    return [...row].map((glyph) => (glyph === '.' ? 'floor' : glyph === ' ' ? 'void' : 'wall'));
  });
  return { size, cells, doors: [], walls: [] };
}

/** A plan that is floor from edge to edge, for tests that are not about walls. */
function openFloor(side: number): Floorplan {
  return planFrom(new Array<string>(side).fill('.'.repeat(side)));
}

function isFloorCell(plan: Floorplan, cell: Cell): boolean {
  return inBounds(cell, plan.size) && plan.cells[cell.y][cell.x] === 'floor';
}

function sameRect(a: PixelRect, b: PixelRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Whether two rectangles share any area at all; touching edges do not count. */
function overlaps(a: PixelRect, b: PixelRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function everyCell(plan: Floorplan): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < plan.size.h; y += 1) {
    for (let x = 0; x < plan.size.w; x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * Every cell a prop of `footprint` could be anchored at: standing wholly on
 * floor, with at least one of its own cells backing onto something that is
 * not floor.
 *
 * That second condition is the whole point of the corpus. Anchors are placed
 * against a wall by rule (`generator/props.ts` `anchorCandidates`), so a
 * sweep over props in the middle of a room would be green with the cut taken
 * out again: it is precisely the prop with its back to the wall whose shadow
 * lands where there is no floor.
 */
function anchorages(plan: Floorplan, footprint: Size): Cell[] {
  const found: Cell[] = [];
  for (const cell of everyCell(plan)) {
    const covered: Cell[] = [];
    for (let dy = 0; dy < footprint.h; dy += 1) {
      for (let dx = 0; dx < footprint.w; dx += 1) {
        covered.push({ x: cell.x + dx, y: cell.y + dy });
      }
    }
    if (!covered.every((under) => isFloorCell(plan, under))) {
      continue;
    }
    if (covered.some((under) => FACINGS.some((f) => !isFloorCell(plan, step(under, f))))) {
      found.push(cell);
    }
  }
  return found;
}

describe('lightInfluence', () => {
  it('is full strength at the light itself', () => {
    expect(lightInfluence(light(), { x: 2.5, y: 5.5 })).toBe(1);
  });

  it('falls off linearly across the radius', () => {
    expect(lightInfluence(light({ cell: { x: 0, y: 0 }, radiusCells: 4 }), { x: 2.5, y: 0.5 })).
      toBeCloseTo(0.5, 10);
  });

  it('is nothing at the edge of the radius and beyond it', () => {
    const source = light({ cell: { x: 0, y: 0 }, radiusCells: 4 });
    expect(lightInfluence(source, { x: 4.5, y: 0.5 })).toBe(0);
    expect(lightInfluence(source, { x: 40.5, y: 0.5 })).toBe(0);
  });

  it('measures from the middle of the light’s cell, not its corner', () => {
    // Measuring corner to corner would make a light and the prop standing on
    // it read as half a cell apart, and the cue would be thrown the wrong way
    // for everything immediately around it.
    const source = light({ cell: { x: 3, y: 3 }, radiusCells: 5 });
    expect(lightInfluence(source, { x: 3.5, y: 3.5 })).toBe(1);
    expect(lightInfluence(source, { x: 3, y: 3 })).toBeLessThan(1);
  });

  it('lights nothing at a radius of zero', () => {
    expect(lightInfluence(light({ radiusCells: 0 }), { x: 2.5, y: 5.5 })).toBe(0);
  });

  it('rejects a radius that is negative or not finite', () => {
    expect(() => lightInfluence(light({ radiusCells: -1 }), { x: 0, y: 0 })).toThrow(RangeError);
    expect(() =>
      lightInfluence(light({ radiusCells: Number.POSITIVE_INFINITY }), { x: 0, y: 0 }),
    ).toThrow(RangeError);
    expect(() => lightInfluence(light({ radiusCells: Number.NaN }), { x: 0, y: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('propShadow', () => {
  it('throws the shadow away from the light', () => {
    // The light is due west, so the shadow moves east and stays on its row.
    const shadow = propShadow(prop(), [light()]);
    const body = propRect(prop());
    expect(shadow).toBeDefined();
    expect(shadow?.rect.x).toBeGreaterThan(body.x);
    expect(shadow?.rect.y).toBe(body.y);
  });

  it('throws it the other way when the light moves to the other side', () => {
    const shadow = propShadow(prop(), [light({ cell: { x: 9, y: 5 } })]);
    expect(shadow?.rect.x).toBeLessThan(propRect(prop()).x);
  });

  it('keeps the shadow the same shape as the prop that casts it', () => {
    const wide = prop({ footprint: { w: 4, h: 1 } });
    const shadow = propShadow(wide, [light()]);
    expect(shadow?.rect.w).toBe(propRect(wide).w);
    expect(shadow?.rect.h).toBe(propRect(wide).h);
  });

  it('darkens without tinting, whatever colour the light is', () => {
    const shadow = propShadow(prop(), [light({ colorHex: '#ff0000' })]);
    expect(shadow?.color).toBe(SHADOW_COLOR);
  });

  it('casts nothing when there is no light at all', () => {
    expect(propShadow(prop(), [])).toBeUndefined();
  });

  it('casts nothing when every light is out of reach', () => {
    expect(propShadow(prop(), [light({ radiusCells: 2 })])).toBeUndefined();
    expect(propShadow(prop(), [light({ cell: { x: 19, y: 19 } })])).toBeUndefined();
  });

  it('casts nothing from scatter, which lies flat on the floor', () => {
    // A shadow says "this has height". Saying it of every shard would turn a
    // lit room into gravel.
    expect(propShadow(prop({ layer: 'scatter' }), [light()])).toBeUndefined();
  });

  it('casts from anchors and groups', () => {
    expect(propShadow(prop({ layer: 'anchor' }), [light()])).toBeDefined();
    expect(propShadow(prop({ layer: 'group' }), [light()])).toBeDefined();
  });

  it('casts nothing when the light is exactly under the prop', () => {
    // There is no direction to throw towards, and any choice would be made up.
    expect(propShadow(prop(), [light({ cell: { x: 5, y: 5 } })])).toBeUndefined();
  });

  it('measures from the middle of the footprint, not from the anchor cell', () => {
    // A 5x2 counter anchored at (0, 0) has its middle at x=2.5. A hearth in
    // cell (1, 0) sits at x=1.5, west of that middle, so the counter throws
    // its shadow east. Measured from the anchor cell instead, the middle would
    // be x=0.5, the sign of dx flips, and the counter throws its shadow *west,
    // towards the fire that lit it* — on every prop wider than one cell, which
    // is every anchor the generator places.
    const counter = prop({
      assetId: 'anchor/bar_counter',
      cell: { x: 0, y: 0 },
      footprint: { w: 5, h: 2 },
    });
    const hearth = light({ cell: { x: 1, y: 0 }, radiusCells: 6 });
    const shadow = propShadow(counter, [hearth]);
    expect(shadow).toBeDefined();
    expect(shadow?.rect.x).toBeGreaterThan(propRect(counter).x);
  });

  it('throws a short dark shadow near the light and a long faint one far off', () => {
    // The documented rule, and the direction real shadows run. Reversed, props
    // by the fire trail long shadows and props in the gloom barely cast one;
    // flattened, the throw says nothing about where the light is.
    const body = propRect(prop());
    const thrown = (x: number): number => {
      const shadow = propShadow(prop(), [light({ cell: { x, y: 5 }, radiusCells: 6 })]);
      if (shadow === undefined) {
        throw new Error(`no shadow with the light at x=${x}`);
      }
      return shadow.rect.x - body.x;
    };
    const alphaAt = (x: number): number =>
      propShadow(prop(), [light({ cell: { x, y: 5 }, radiusCells: 6 })])?.alpha ?? 0;

    // The light walks west, away from the prop at x=5: each step is farther.
    expect(thrown(4)).toBeGreaterThan(0);
    expect(thrown(3)).toBeGreaterThan(thrown(4));
    expect(thrown(2)).toBeGreaterThan(thrown(3));
    expect(thrown(1)).toBeGreaterThan(thrown(2));

    expect(alphaAt(3)).toBeLessThan(alphaAt(4));
    expect(alphaAt(1)).toBeLessThan(alphaAt(3));
  });

  it('darkens more the closer the light is', () => {
    const near = propShadow(prop(), [light({ cell: { x: 4, y: 5 } })]);
    const far = propShadow(prop(), [light({ cell: { x: 1, y: 5 } })]);
    expect(near?.alpha).toBeGreaterThan(far?.alpha ?? 0);
  });

  it('stays translucent, so a shadow never becomes a hole in the floor', () => {
    const shadow = propShadow(prop(), [light({ cell: { x: 4, y: 5 } })]);
    expect(shadow?.alpha).toBeGreaterThan(0);
    expect(shadow?.alpha).toBeLessThan(1);
  });

  it('takes its direction from the strongest light, not the first one listed', () => {
    // A weak light to the east is listed first; a strong one to the west must
    // still be the one that decides where the shadow falls.
    const weakEast = light({ cell: { x: 8, y: 5 }, radiusCells: 3.2 });
    const strongWest = light({ cell: { x: 4, y: 5 }, radiusCells: 12 });
    const shadow = propShadow(prop(), [weakEast, strongWest]);
    expect(lightInfluence(weakEast, { x: 5.5, y: 5.5 })).toBeGreaterThan(0);
    expect(shadow?.rect.x).toBeGreaterThan(propRect(prop()).x);
  });

  it('names the prop it came from', () => {
    expect(propShadow(prop(), [light()])?.assetId).toBe('anchor/hearth');
  });

  it('never detaches the shadow from the prop it belongs to', () => {
    const body = propRect(prop());
    for (let x = 0; x < 11; x += 1) {
      for (let y = 0; y < 11; y += 1) {
        const shadow = propShadow(prop(), [light({ cell: { x, y }, radiusCells: 9 })]);
        if (shadow !== undefined) {
          expect(Math.abs(shadow.rect.x - body.x)).toBeLessThan(body.w);
          expect(Math.abs(shadow.rect.y - body.y)).toBeLessThan(body.h);
        }
      }
    }
  });

  it('rejects a light whose radius is not a finite, non-negative number', () => {
    expect(() => propShadow(prop(), [light({ radiusCells: -3 })])).toThrow(RangeError);
  });
});

describe('clipToFloor', () => {
  /** A room with a wall band around it and a pillar in the middle of it. */
  const room = planFrom([
    '#######',
    '#.....#',
    '#..#..#',
    '#.....#',
    '#######',
  ]);

  /** The shadow a prop of the test casts, before anything is cut off it. */
  const cast = (target: PlacedProp, source: LightSource): Shadow => {
    const shadow = propShadow(target, [source]);
    if (shadow === undefined) {
      throw new Error(`no shadow for ${target.assetId} lit from ${source.cell.x},${source.cell.y}`);
    }
    return shadow;
  };

  it('leaves a shadow that already lies on floor exactly as it was cast', () => {
    // The undisturbed case has to stay byte for byte what it was, or the cut
    // would quietly redraw every shadow on every map to fix the few that fall
    // off the room.
    const shadow = cast(prop({ cell: { x: 3, y: 3 } }), light({ cell: { x: 3, y: 8 } }));
    expect(clipToFloor(shadow, openFloor(12))).toEqual([shadow]);
  });

  it('cuts off the part that falls on the wall band', () => {
    // The bug this exists for: a hearth with its back to the north wall, lit
    // from inside the room, throws its shadow straight onto the wall.
    const hearth = prop({ cell: { x: 3, y: 1 } });
    const shadow = cast(hearth, light({ cell: { x: 3, y: 3 } }));
    expect(shadow.rect.y).toBeLessThan(cellRect({ x: 3, y: 1 }).y);

    const parts = clipToFloor(shadow, room);
    expect(parts).toHaveLength(1);
    expect(parts[0].rect.y).toBe(cellRect({ x: 3, y: 1 }).y);
    expect(parts[0].rect.h).toBeLessThan(shadow.rect.h);
  });

  it('cuts off the part that falls past the edge of the map', () => {
    // Nothing on the far side of the last row is drawn at all, so a shadow
    // reaching over it is ink outside the image.
    const plan = openFloor(6);
    const shadow = cast(prop({ cell: { x: 2, y: 0 } }), light({ cell: { x: 2, y: 4 } }));
    expect(shadow.rect.y).toBeLessThan(0);

    const parts = clipToFloor(shadow, plan);
    expect(parts).toHaveLength(1);
    expect(parts[0].rect.y).toBe(0);
  });

  it('cuts off the part that falls on the void', () => {
    const plan = planFrom(['....', '..  ', '....']);
    const shadow = cast(prop({ cell: { x: 1, y: 1 } }), light({ cell: { x: 0, y: 1 } }));
    expect(shadow.rect.x + shadow.rect.w).toBeGreaterThan(cellRect({ x: 2, y: 1 }).x);

    const parts = clipToFloor(shadow, plan);
    expect(parts).toHaveLength(1);
    expect(parts[0].rect.x + parts[0].rect.w).toBe(cellRect({ x: 2, y: 1 }).x);
  });

  it('breaks into several rectangles when the floor under it is not one', () => {
    // A counter along the north wall, lit from the north, throws its shadow
    // south across the row the pillar stands in. Floor is not a rectangle
    // there, and no single rectangle can be the answer.
    const counter = prop({
      assetId: 'anchor/bar_counter',
      cell: { x: 1, y: 1 },
      footprint: { w: 5, h: 1 },
    });
    const parts = clipToFloor(cast(counter, light({ cell: { x: 3, y: 0 } })), room);
    const pillar = cellRect({ x: 3, y: 2 });
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => !overlaps(part.rect, pillar))).toBe(true);
  });

  it('keeps a run of floor cells as one rectangle instead of one per cell', () => {
    // Per-cell pieces would darken the same floor with the same alpha in four
    // commands instead of one, and every map would carry the cost of a cut
    // that changed nothing there.
    const counter = prop({
      assetId: 'anchor/bar_counter',
      cell: { x: 1, y: 1 },
      footprint: { w: 5, h: 1 },
    });
    const parts = clipToFloor(cast(counter, light({ cell: { x: 3, y: 0 } })), room);
    const widest = Math.max(...parts.map((part) => part.rect.w));
    expect(widest).toBeGreaterThan(PIXELS_PER_CELL);
  });

  it('carries the prop, the colour and the alpha into every piece it makes', () => {
    const counter = prop({
      assetId: 'anchor/bar_counter',
      cell: { x: 1, y: 1 },
      footprint: { w: 5, h: 1 },
    });
    const shadow = cast(counter, light({ cell: { x: 3, y: 0 } }));
    for (const part of clipToFloor(shadow, room)) {
      expect(part.assetId).toBe('anchor/bar_counter');
      expect(part.color).toBe(shadow.color);
      expect(part.alpha).toBe(shadow.alpha);
    }
  });

  it('cuts a shadow away entirely when there is no floor under it', () => {
    // A prop standing on wall is a generator bug, not a shadow to draw. The
    // cut says nothing rather than grounding a prop on masonry.
    const onWall = prop({ cell: { x: 0, y: 0 } });
    expect(clipToFloor(cast(onWall, light({ cell: { x: 3, y: 3 } })), room)).toEqual([]);
  });

  it('refuses a plan whose cells do not cover its own size', () => {
    // A `Floorplan` that declares 7x5 and carries no rows is not an empty
    // room: it is a plan the caller failed to build. Answering "no floor
    // anywhere" would drop every shadow on the map and look like a shadow
    // bug for as long as it took to find.
    const hollow: Floorplan = { size: room.size, cells: [], doors: [], walls: [] };
    expect(() => clipToFloor(cast(prop({ cell: { x: 3, y: 3 } }), light()), hollow)).toThrow(
      RangeError,
    );
  });
});

describe('sceneShadows', () => {
  it('names the casting prop on every piece, in the order the props were given', () => {
    // One piece each only because `openFloor(12)` cuts nothing: the contract
    // is the order and the attribution, not a count. A prop over a floor with
    // holes in it yields several pieces, or none.
    const props = [
      prop({ assetId: 'anchor/hearth' }),
      prop({ assetId: 'scatter/straw', cell: { x: 6, y: 5 }, layer: 'scatter' }),
      prop({ assetId: 'group/table_long', cell: { x: 7, y: 5 }, layer: 'group' }),
    ];
    expect(sceneShadows(props, [light()], openFloor(12)).map((shadow) => shadow.assetId)).toEqual([
      'anchor/hearth',
      'group/table_long',
    ]);
  });

  it('produces nothing in an unlit room', () => {
    expect(sceneShadows([prop()], [], openFloor(12))).toEqual([]);
  });

  it('darkens nothing but floor, over every plan, every anchorage and every light', () => {
    // The sweep the whole front is for. It is written over anchorages rather
    // than over arbitrary cells because a prop in the middle of a room passes
    // this with the cut taken out, and the props that cast are the ones
    // against a wall.
    const plans = [
      // A walled room with a pillar, which is the shape the generator makes.
      planFrom([
        '#########',
        '#.......#',
        '#.......#',
        '#...#...#',
        '#.......#',
        '#########',
      ]),
      // An L, so a wall runs into the room instead of only around it.
      planFrom([
        '########   ',
        '#......#   ',
        '#......####',
        '#.........#',
        '#.........#',
        '###########',
      ]),
      // Floor to the edge of the grid, with no wall band to stop a shadow
      // first. It is the only way to exercise the half of the cut that is
      // about the map's own border, and it is what the reported bug looked
      // like: a shadow above the top edge of the image.
      openFloor(6),
    ];

    let cut = 0;
    let kept = 0;
    const violations: string[] = [];

    for (const plan of plans) {
      const map: PixelRect = {
        x: 0,
        y: 0,
        w: plan.size.w * PIXELS_PER_CELL,
        h: plan.size.h * PIXELS_PER_CELL,
      };
      const offFloor = everyCell(plan).filter((cell) => !isFloorCell(plan, cell));
      const props = [
        ...anchorages(plan, { w: 1, h: 1 }).map((cell) => prop({ cell })),
        ...anchorages(plan, { w: 2, h: 2 }).map((cell) =>
          prop({ assetId: 'group/table_long', layer: 'group', cell, footprint: { w: 2, h: 2 } }),
        ),
      ];
      expect(props.length).toBeGreaterThan(0);

      for (const target of props) {
        for (const at of everyCell(plan)) {
          const lights = [light({ cell: at, radiusCells: 9 })];
          const raw = propShadow(target, lights);
          const shadows = sceneShadows([target], lights, plan);
          if (raw !== undefined) {
            if (shadows.length === 1 && sameRect(shadows[0].rect, raw.rect)) {
              kept += 1;
            } else {
              cut += 1;
            }
          }
          for (const shadow of shadows) {
            const where =
              `${target.assetId} at ${target.cell.x},${target.cell.y} ` +
              `lit from ${at.x},${at.y}`;
            if (shadow.rect.w <= 0 || shadow.rect.h <= 0) {
              // A piece with no area is a draw command that paints nothing,
              // and it is what an off-by-one in the cell span leaves behind.
              violations.push(`${where} left a ${shadow.rect.w}x${shadow.rect.h} piece`);
            }
            if (
              shadow.rect.x < map.x ||
              shadow.rect.y < map.y ||
              shadow.rect.x + shadow.rect.w > map.x + map.w ||
              shadow.rect.y + shadow.rect.h > map.y + map.h
            ) {
              violations.push(`${where} reaches outside the ${plan.size.w}x${plan.size.h} map`);
            }
            for (const cell of offFloor) {
              if (overlaps(shadow.rect, cellRect(cell))) {
                const kind = plan.cells[cell.y][cell.x];
                violations.push(`${where} darkens the ${kind} cell ${cell.x},${cell.y}`);
              }
            }
          }
        }
      }
    }

    // Sliced so that a regression reads as a report rather than as a wall of
    // every prop on every plan.
    expect(violations.slice(0, 5)).toEqual([]);
    // The sweep is only worth its runtime if it is exercising both halves: a
    // corpus that never needed cutting would be just as green with the cut
    // deleted.
    expect(kept).toBeGreaterThan(0);
    expect(cut).toBeGreaterThan(0);
  });
});
