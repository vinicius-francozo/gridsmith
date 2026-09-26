import { describe, expect, it } from 'vitest';

import {
  VARIANT_LADDER_RUNGS,
  hashString,
  hslToHex,
  inkOn,
  markerColor,
  materialColor,
} from './palette';

describe('hashString', () => {
  it('returns the same hash for the same text', () => {
    expect(hashString('oak_plank')).toBe(hashString('oak_plank'));
  });

  it('separates names that differ by a single character', () => {
    // The whole point of the marking library is that zoning is visible. Two
    // materials the generator emits side by side often differ by a suffix, and
    // a hash that did not avalanche would give them neighbouring hues.
    expect(hashString('stone_floor')).not.toBe(hashString('stone_floor2'));
    expect(hashString('ab')).not.toBe(hashString('ba'));
  });

  it('stays inside the unsigned 32-bit range', () => {
    for (const text of ['', 'a', 'oak_plank', 'tile/flagstone/0', 'ÿĀ']) {
      const hash = hashString(text);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('hslToHex', () => {
  it('converts the primaries exactly', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
  });

  it('converts the secondaries exactly', () => {
    // These are the sextant boundaries, and they pin nothing about which
    // sextant was taken: at 60, 180 and 300 two of the three channels are
    // equal, so swapping the two entries that meet there is invisible here.
    expect(hslToHex(60, 100, 50)).toBe('#ffff00');
    expect(hslToHex(180, 100, 50)).toBe('#00ffff');
    expect(hslToHex(300, 100, 50)).toBe('#ff00ff');
  });

  it('pins each of the six sextants, at a hue where no two channels agree', () => {
    // One hue from the middle of each sextant. Every value below is distinct
    // from the other five in channel order, so a sextant table with any two
    // rows swapped, or off by one, fails here rather than passing by symmetry.
    expect(hslToHex(30, 100, 50)).toBe('#ff8000');
    expect(hslToHex(90, 100, 50)).toBe('#80ff00');
    expect(hslToHex(150, 100, 50)).toBe('#00ff80');
    expect(hslToHex(210, 100, 50)).toBe('#0080ff');
    expect(hslToHex(270, 100, 50)).toBe('#8000ff');
    expect(hslToHex(330, 100, 50)).toBe('#ff0080');
  });

  it('converts the greys', () => {
    expect(hslToHex(0, 0, 0)).toBe('#000000');
    expect(hslToHex(210, 0, 100)).toBe('#ffffff');
    expect(hslToHex(35, 0, 50)).toBe('#808080');
  });

  it('wraps hue instead of running off the end of the sextant table', () => {
    expect(hslToHex(360, 100, 50)).toBe(hslToHex(0, 100, 50));
    expect(hslToHex(-120, 100, 50)).toBe(hslToHex(240, 100, 50));
    expect(hslToHex(480, 100, 50)).toBe(hslToHex(120, 100, 50));
  });

  it('clamps saturation and lightness out of range', () => {
    expect(hslToHex(0, 400, 50)).toBe('#ff0000');
    expect(hslToHex(0, 100, 400)).toBe('#ffffff');
    expect(hslToHex(0, 100, -50)).toBe('#000000');
  });

  it('always pads every channel to two digits', () => {
    // A channel of 5 rendered as "5" instead of "05" shifts every digit after
    // it and yields a valid-looking but completely different colour.
    for (let hue = 0; hue < 360; hue += 7) {
      expect(hslToHex(hue, 60, 4)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('materialColor', () => {
  it('gives void a fixed colour rather than a hue', () => {
    // Void is absence, not a material. If it were hashed like the rest, the
    // area outside the plan would read as another kind of floor.
    expect(materialColor('void', 0)).toBe('#0b0d10');
    expect(materialColor('void', 3)).toBe('#0b0d10');
  });

  it('repeats for the same material and variant', () => {
    expect(materialColor('oak_plank', 2)).toBe(materialColor('oak_plank', 2));
  });

  it('separates different materials', () => {
    expect(materialColor('oak_plank', 0)).not.toBe(materialColor('flagstone', 0));
  });

  it('separates the variants of one material', () => {
    const shades = [0, 1, 2, 3].map((variant) => materialColor('oak_plank', variant));
    expect(new Set(shades).size).toBe(4);
  });

  it('folds variant 4 back onto variant 0, which is the known limit', () => {
    // The lightness ladder has four rungs and then repeats. No material in the
    // frozen vocabulary declares a fifth variant — `wood_plank` and
    // `flagstone` are the richest, at four — so nothing reaches this today.
    // Pinned rather than left implicit so that a material gaining a fifth
    // variant is a visible decision about the palette and not two cuts of one
    // floor quietly coming out the same colour.
    expect(materialColor('oak_plank', VARIANT_LADDER_RUNGS)).toBe(materialColor('oak_plank', 0));
    expect(VARIANT_LADDER_RUNGS).toBe(4);
  });

  it('rejects an empty material name', () => {
    expect(() => materialColor('', 0)).toThrow(RangeError);
  });

  it('rejects a variant that is not a non-negative integer', () => {
    // A negative or fractional variant would still fold into the lightness and
    // come out as a perfectly plausible floor colour.
    expect(() => materialColor('oak_plank', -1)).toThrow(RangeError);
    expect(() => materialColor('oak_plank', 1.5)).toThrow(RangeError);
    expect(() => materialColor('oak_plank', Number.NaN)).toThrow(RangeError);
  });
});

describe('markerColor', () => {
  it('repeats for the same id and separates different ids', () => {
    expect(markerColor('anchor/hearth')).toBe(markerColor('anchor/hearth'));
    expect(markerColor('anchor/hearth')).not.toBe(markerColor('anchor/bar_counter'));
  });

  it('rejects an empty id', () => {
    expect(() => markerColor('')).toThrow(RangeError);
  });
});

describe('inkOn', () => {
  it('puts dark ink on a light background and light ink on a dark one', () => {
    expect(inkOn('#ffffff')).toBe('#101215');
    expect(inkOn('#000000')).toBe('#f2f4f7');
  });

  it('picks opposite ink for yellow and blue, which share an HSL lightness', () => {
    // Both are hsl(_, 100%, 50%). A brightness test built on lightness would
    // give them the same ink and make one of the two labels unreadable; only a
    // luminance test separates them.
    expect(inkOn('#ffff00')).toBe('#101215');
    expect(inkOn('#0000ff')).toBe('#f2f4f7');
  });

  it('weighs green far above blue, as the eye does', () => {
    // Pure green and pure magenta have the same channel count lit. Only the
    // per-channel weighting separates them, and an unweighted average gets
    // both backwards.
    expect(inkOn('#00ff00')).toBe('#101215');
    expect(inkOn('#ff00ff')).toBe('#f2f4f7');
  });

  it('reads mid grey as dark, because sRGB is not linear', () => {
    // #808080 is half way up the byte range and about a fifth of the way up in
    // light. Skipping the gamma decode calls it light and puts dark ink on it.
    expect(inkOn('#808080')).toBe('#f2f4f7');
  });

  it('rejects anything that is not an #rrggbb colour', () => {
    expect(() => inkOn('#fff')).toThrow(RangeError);
    expect(() => inkOn('white')).toThrow(RangeError);
    expect(() => inkOn('#0000ff ')).toThrow(RangeError);
  });
});
