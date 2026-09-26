/**
 * Reading the seed field, and drawing a seed when it is empty.
 *
 * The seed is what makes a map findable again: the same description and the
 * same number give back the same map, cell for cell, which is the invariant the
 * whole project is built on. So a seed the person did not type is a seed they
 * have to be *shown*, or the map they just liked is gone.
 *
 * `Math.random` is never called here, or anywhere in this project. The seed is
 * drawn from the platform's cryptographic source, which is not about secrecy —
 * it is the one source of randomness available in a browser that is not
 * `Math.random`, and drawing the seed is the single moment in the whole
 * pipeline where anything unseeded happens at all. Everything downstream of the
 * number is deterministic.
 */

/** The smallest seed the field accepts. */
export const MIN_SEED = 0;

/**
 * The largest seed the field accepts.
 *
 * `createRng` reduces any seed to 32 bits, so a seed above this names the same
 * generator as one below it. Refusing it keeps the number on screen and the
 * map on screen in one-to-one correspondence.
 */
export const MAX_SEED = 0xff_ff_ff_ff;

/** What the seed field held. */
export type SeedReading =
  | { kind: 'blank' }
  | { kind: 'seed'; seed: number }
  | { kind: 'not_an_integer' }
  | { kind: 'out_of_range' };

/**
 * What `text` says.
 *
 * The pattern is digits and nothing else, deliberately narrower than `Number`:
 * `Number` reads `0x10` as 16, `1e3` as 1000 and `' '` as 0, so a person who
 * typed one of those would get a map from a number they did not write and could
 * not retype. A sign is allowed through the pattern only so that a negative
 * seed is reported as out of range rather than as gibberish, which is the more
 * useful thing to be told.
 */
export function readSeed(text: string): SeedReading {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { kind: 'blank' };
  }
  if (!/^[+-]?\d+$/.test(trimmed)) {
    return { kind: 'not_an_integer' };
  }

  const seed = Number(trimmed);
  if (!Number.isSafeInteger(seed)) {
    // More digits than a double can hold exactly. The number on screen and the
    // number the generator would use are no longer the same number.
    return { kind: 'out_of_range' };
  }
  if (seed < MIN_SEED || seed > MAX_SEED) {
    return { kind: 'out_of_range' };
  }
  return { kind: 'seed', seed };
}

/**
 * A source of one unsigned 32-bit integer.
 *
 * A parameter rather than a direct call, so that `randomSeed` is testable
 * without a platform and so that the single unseeded step in this whole
 * project has a name and one place to look for it.
 */
export type Entropy = () => number;

/**
 * The platform's own source.
 *
 * @throws {TypeError} where `crypto.getRandomValues` does not exist. There is
 *                     no fallback on purpose: `Math.random` is the one thing
 *                     this project does not do, and a quiet fallback to it
 *                     would be the single line that undoes the invariant.
 */
export const cryptoEntropy: Entropy = () => {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new TypeError('this browser has no crypto.getRandomValues to draw a seed from');
  }
  const out = new Uint32Array(1);
  globalThis.crypto.getRandomValues(out);
  return out[0];
};

/**
 * A seed in `[MIN_SEED, MAX_SEED]`, drawn from `entropy`.
 *
 * The result is checked rather than masked into range. A seed that is drawn,
 * shown in the field and used to build a map has to be the same number in all
 * three places; `>>> 0` over a source that answered `1.5` would put one number
 * on screen and build the map from another, which is the one failure that
 * makes a seed worthless.
 *
 * @throws {TypeError} if `entropy` does not answer with a whole number in
 *                     range.
 */
export function randomSeed(entropy: Entropy = cryptoEntropy): number {
  const seed = entropy();
  if (!Number.isInteger(seed) || seed < MIN_SEED || seed > MAX_SEED) {
    throw new TypeError(
      `the entropy source answered ${String(seed)}, which is not a seed between ` +
        `${String(MIN_SEED)} and ${String(MAX_SEED)}`,
    );
  }
  return seed;
}
