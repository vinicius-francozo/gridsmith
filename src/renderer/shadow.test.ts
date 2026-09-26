import { describe, expect, it } from 'vitest';

import type { LightSource, PlacedProp } from '../core/types';
import { propRect } from './geometry';
import { SHADOW_COLOR, lightInfluence, propShadow, sceneShadows } from './shadow';

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

describe('sceneShadows', () => {
  it('keeps one shadow per casting prop, in the order the props were given', () => {
    const props = [
      prop({ assetId: 'anchor/hearth' }),
      prop({ assetId: 'scatter/straw', cell: { x: 6, y: 5 }, layer: 'scatter' }),
      prop({ assetId: 'group/table_long', cell: { x: 7, y: 5 }, layer: 'group' }),
    ];
    expect(sceneShadows(props, [light()]).map((shadow) => shadow.assetId)).toEqual([
      'anchor/hearth',
      'group/table_long',
    ]);
  });

  it('produces nothing in an unlit room', () => {
    expect(sceneShadows([prop()], [])).toEqual([]);
  });
});
