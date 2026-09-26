import { describe, expect, it } from 'vitest';

import { createRng } from './prng';

/** The first `count` floats of a fresh generator seeded with `seed`. */
function sequence(seed: number, count: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.float());
}

describe('createRng', () => {
  it('rejects a non-integer seed', () => {
    expect(() => createRng(1.5)).toThrow(TypeError);
    expect(() => createRng(Number.NaN)).toThrow(TypeError);
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('accepts zero and negative seeds', () => {
    expect(() => createRng(0)).not.toThrow();
    expect(() => createRng(-1)).not.toThrow();
  });
});

describe('determinism', () => {
  it('replays the same sequence for the same seed', () => {
    expect(sequence(1234, 50)).toEqual(sequence(1234, 50));
  });

  it('produces different sequences for different seeds', () => {
    expect(sequence(1, 20)).not.toEqual(sequence(2, 20));
  });

  it('pins the sequence for seed 1234, so the algorithm cannot drift', () => {
    // These values are SplitMix32's output, not an arbitrary snapshot: if this
    // test ever fails, a map that was generated once can no longer be
    // reproduced. Changing the numbers is never the right fix.
    expect(sequence(1234, 4).map((n) => n.toFixed(10))).toEqual([
      '0.7246124053',
      '0.6165533429',
      '0.0998019706',
      '0.1573775948',
    ]);
  });

  it('is unaffected by how the numbers are drawn', () => {
    const viaFloat = createRng(7);
    const viaMixedCalls = createRng(7);

    viaFloat.float();
    viaMixedCalls.int(0, 9);

    expect(viaFloat.float()).toBe(viaMixedCalls.float());
  });
});

describe('float', () => {
  it('stays inside [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.float();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('int', () => {
  it('includes both bounds', () => {
    const rng = createRng(3);
    const drawn = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      drawn.add(rng.int(1, 3));
    }
    expect([...drawn].sort()).toEqual([1, 2, 3]);
  });

  it('returns the bound itself when the range holds one value', () => {
    expect(createRng(3).int(5, 5)).toBe(5);
  });

  it('handles a range that spans zero', () => {
    const rng = createRng(11);
    for (let i = 0; i < 200; i += 1) {
      const value = rng.int(-2, 2);
      expect(value).toBeGreaterThanOrEqual(-2);
      expect(value).toBeLessThanOrEqual(2);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('rejects non-integer bounds', () => {
    expect(() => createRng(1).int(0, 2.5)).toThrow(TypeError);
    expect(() => createRng(1).int(0.5, 2)).toThrow(TypeError);
  });

  it('rejects an empty range', () => {
    expect(() => createRng(1).int(3, 2)).toThrow(RangeError);
  });
});

describe('pick', () => {
  it('only ever returns an element of the array', () => {
    const rng = createRng(42);
    const options = ['hearth', 'bar', 'stairs'];
    for (let i = 0; i < 200; i += 1) {
      expect(options).toContain(rng.pick(options));
    }
  });

  it('returns the only element of a single-element array', () => {
    expect(createRng(42).pick(['bar'])).toBe('bar');
  });

  it('rejects an empty array instead of returning undefined', () => {
    // The message, not just the type: without `pick`'s own guard the call
    // still throws a RangeError, but from `int(0, -1)` and blaming bounds the
    // caller never wrote. Asserting the type alone leaves the guard untested.
    expect(() => createRng(42).pick([])).toThrow(RangeError);
    expect(() => createRng(42).pick([])).toThrow('pick() needs a non-empty array');
    expect(() => createRng(42).int(0, -1)).toThrow('int() range is empty: [0, -1]');
  });
});
