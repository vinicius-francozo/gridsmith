/**
 * Seeded pseudo-random number generation.
 *
 * Algorithm: **SplitMix32** — the 32-bit variant of Steele, Lea and Flood's
 * SplitMix. It is a counter plus an avalanche mix, so it needs no warm-up and
 * has no weak seeds: every 32-bit seed is as good as any other.
 *
 * It is written here rather than pulled from a package because determinism is
 * an invariant of this project: the whole state is one 32-bit integer and
 * every step is an exact 32-bit operation (`Math.imul`, `>>>`, `|0`), which
 * JavaScript specifies exactly. The same seed therefore yields the same
 * sequence on any engine, today and in a year.
 *
 * Nothing in this project may call `Math.random`. Randomness is injected as an
 * `Rng`, so the same description and the same seed produce the same map.
 */

import type { Rng } from './types';

const GOLDEN_GAMMA = 0x9e3779b9;
const MIX_A = 0x21f0aaad;
const MIX_B = 0x735a2d97;
const UINT32_RANGE = 0x1_0000_0000;

/**
 * A deterministic `Rng` over the given seed.
 *
 * @param seed any safe integer; it is reduced to 32 bits, so `seed` and
 *             `seed + 2**32` are the same generator.
 * @throws {TypeError} if `seed` is not an integer (`NaN` and `Infinity`
 *                     included): a non-integer seed would silently truncate
 *                     and quietly change the map it stands for.
 */
export function createRng(seed: number): Rng {
  if (!Number.isInteger(seed)) {
    throw new TypeError(`seed must be an integer, got ${seed}`);
  }

  let state = seed | 0;

  /** The raw generator: one unsigned 32-bit integer per call. */
  const nextUint32 = (): number => {
    state = (state + GOLDEN_GAMMA) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), MIX_A);
    z = Math.imul(z ^ (z >>> 15), MIX_B);
    return (z ^ (z >>> 15)) >>> 0;
  };

  const rng: Rng = {
    /** A number in `[0, 1)`, with 32 bits of resolution. */
    float(): number {
      return nextUint32() / UINT32_RANGE;
    },

    /**
     * An integer in `[min, max]` — both ends included.
     *
     * @throws {TypeError} if either bound is not an integer.
     * @throws {RangeError} if `max < min`, which describes an empty range.
     */
    int(min: number, max: number): number {
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new TypeError(`int() bounds must be integers, got [${min}, ${max}]`);
      }
      if (max < min) {
        throw new RangeError(`int() range is empty: [${min}, ${max}]`);
      }
      return min + Math.floor(rng.float() * (max - min + 1));
    },

    /**
     * One element of `xs`, uniformly.
     *
     * @throws {RangeError} if `xs` is empty — there is nothing to return, and
     *                      `undefined` would travel far before it crashed.
     */
    pick<T>(xs: T[]): T {
      if (xs.length === 0) {
        throw new RangeError('pick() needs a non-empty array');
      }
      return xs[rng.int(0, xs.length - 1)];
    },
  };

  return rng;
}
