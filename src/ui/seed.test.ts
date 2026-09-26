import { describe, expect, it } from 'vitest';

import { createRng } from '../core/prng';

import { MAX_SEED, MIN_SEED, cryptoEntropy, randomSeed, readSeed } from './seed';

describe('reading the seed field', () => {
  it('reads a plain number', () => {
    expect(readSeed('4242')).toEqual({ kind: 'seed', seed: 4242 });
  });

  it('ignores the spaces around it', () => {
    expect(readSeed('  7 ')).toEqual({ kind: 'seed', seed: 7 });
  });

  it('calls an empty field blank, so one can be drawn', () => {
    expect(readSeed('')).toEqual({ kind: 'blank' });
    expect(readSeed('   ')).toEqual({ kind: 'blank' });
  });

  it('accepts both ends of the range', () => {
    expect(readSeed(String(MIN_SEED))).toEqual({ kind: 'seed', seed: MIN_SEED });
    expect(readSeed(String(MAX_SEED))).toEqual({ kind: 'seed', seed: MAX_SEED });
  });

  it('refuses a number just past the top of the range', () => {
    // Above this a seed names the same generator as one below it — `createRng`
    // reduces to 32 bits — so the number on screen would stop being a name for
    // the map.
    expect(readSeed(String(MAX_SEED + 1))).toEqual({ kind: 'out_of_range' });
  });

  it('refuses a negative seed as out of range rather than as gibberish', () => {
    expect(readSeed('-1')).toEqual({ kind: 'out_of_range' });
  });

  it('refuses more digits than a double holds exactly', () => {
    // `Number('99999999999999999999')` answers 1e20 without complaint. The
    // field would show one number and the map would come from another.
    expect(readSeed('99999999999999999999')).toEqual({ kind: 'out_of_range' });
  });

  it('refuses the shapes Number would silently accept', () => {
    // Every one of these is read by `Number` as some number or other: 16, 1000,
    // 1, 0, 0. A person who typed one and got a map could not retype it.
    for (const text of ['0x10', '1e3', '1.0', 'Infinity', 'meia-noite', '1_000', '4,2']) {
      expect(readSeed(text)).toEqual({ kind: 'not_an_integer' });
    }
  });

  it('answers with a seed the generator will actually accept', () => {
    const reading = readSeed('12345');
    if (reading.kind !== 'seed') {
      throw new Error('expected a seed');
    }

    expect(() => createRng(reading.seed)).not.toThrow();
  });
});

describe('drawing a seed when the field is empty', () => {
  it('hands back what the source answered', () => {
    expect(randomSeed(() => 99)).toBe(99);
  });

  it('refuses a source that answers outside the range', () => {
    // Masking with `>>> 0` would put one number in the field and build the map
    // from another, which is the one way a seed stops being worth writing down.
    expect(() => randomSeed(() => -1)).toThrow(TypeError);
    expect(() => randomSeed(() => MAX_SEED + 1)).toThrow(TypeError);
  });

  it('refuses a source that answers with a fraction', () => {
    expect(() => randomSeed(() => 1.5)).toThrow(TypeError);
  });

  it('draws from the platform, and never from Math.random', () => {
    // The platform source is the only unseeded step in the project. Everything
    // downstream of the number it returns is a pure function of it.
    const seed = randomSeed(cryptoEntropy);

    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(MIN_SEED);
    expect(seed).toBeLessThanOrEqual(MAX_SEED);
  });

  it('draws different seeds, so two runs are two maps', () => {
    const drawn = new Set(Array.from({ length: 16 }, () => randomSeed(cryptoEntropy)));

    expect(drawn.size).toBeGreaterThan(1);
  });
});
