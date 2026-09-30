import { describe, expect, it } from 'vitest';

import type { Place } from '../core/types';

import { FEATURES, featureSuits, featuresFor, isFeature } from './vocabulary';
import type { Feature } from './vocabulary';

/**
 * Every pair the project builds.
 *
 * It was the tavern's three, which covered the vocabulary only because every
 * word happened to suit a tavern room as well. `weapons` and `tomb` do not —
 * one is the dungeon hall's and the other the crypt's — so the sweep below
 * would have reported them as words no place can hold, when the truth was that
 * this list had not kept up with `BUILDINGS`.
 */
const PLACE_TYPES: Place[] = [
  { building: 'tavern', room: 'hall' }, { building: 'tavern', room: 'room' },
  { building: 'tavern', room: 'storeroom' }, { building: 'dungeon', room: 'hall' },
  { building: 'dungeon', room: 'room' }, { building: 'dungeon', room: 'storeroom' },
  { building: 'dungeon', room: 'crypt' },
];

describe('isFeature', () => {
  it('recognises every word in the vocabulary', () => {
    for (const feature of FEATURES) {
      expect(isFeature(feature)).toBe(true);
    }
  });

  it('rejects a word the generator has no anchor for', () => {
    expect(isFeature('throne')).toBe(false);
    expect(isFeature('')).toBe(false);
  });

  it('is case sensitive, so callers normalise rather than guess', () => {
    expect(isFeature('Bar')).toBe(false);
  });
});

describe('featureSuits', () => {
  it('puts the bar in the common room and nowhere else', () => {
    expect(featureSuits('bar', { building: 'tavern', room: 'hall' })).toBe(true);
    expect(featureSuits('bar', { building: 'tavern', room: 'room' })).toBe(false);
    expect(featureSuits('bar', { building: 'tavern', room: 'storeroom' })).toBe(false);
  });

  it('keeps bunks to the room people sleep in', () => {
    expect(featureSuits('bunks', { building: 'tavern', room: 'room' })).toBe(true);
    expect(featureSuits('bunks', { building: 'tavern', room: 'hall' })).toBe(false);
  });

  it('allows a feature to belong to more than one kind of place', () => {
    expect(featureSuits('hearth', { building: 'tavern', room: 'hall' })).toBe(true);
    expect(featureSuits('hearth', { building: 'tavern', room: 'room' })).toBe(true);
    expect(featureSuits('hearth', { building: 'tavern', room: 'storeroom' })).toBe(false);
  });

  it('throws on a word outside the vocabulary rather than answering false', () => {
    // Answering `false` would be indistinguishable from "that feature does not
    // suit this place", and a caller that skipped `isFeature` would silently
    // drop the word with the wrong reason recorded against it.
    expect(() => featureSuits('throne' as Feature, { building: 'tavern', room: 'hall' })).toThrow(RangeError);
    expect(() => featureSuits('throne' as Feature, { building: 'tavern', room: 'hall' })).toThrow(
      'throne is not in the feature vocabulary',
    );
  });
});

describe('featuresFor', () => {
  it('gives every place type at least one feature it can hold', () => {
    for (const place of PLACE_TYPES) {
      expect(featuresFor(place).length).toBeGreaterThan(0);
    }
  });

  it('returns only features that suit the place', () => {
    for (const place of PLACE_TYPES) {
      for (const feature of featuresFor(place)) {
        expect(featureSuits(feature, place)).toBe(true);
      }
    }
  });

  it('accounts for every feature in the vocabulary across every place there is', () => {
    // A feature that suits nowhere would be a word the prompt offers the model
    // and `resolve` then always throws away.
    const reachable = new Set(PLACE_TYPES.flatMap((place) => featuresFor(place)));
    expect([...reachable].sort()).toEqual([...FEATURES].sort());
  });
});
