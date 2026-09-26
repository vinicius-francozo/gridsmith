import { describe, expect, it } from 'vitest';

import type { PlaceType } from '../core/types';

import { FEATURES, featureSuits, featuresFor, isFeature } from './vocabulary';
import type { Feature } from './vocabulary';

const PLACE_TYPES: PlaceType[] = ['tavern_hall', 'tavern_room', 'tavern_storeroom'];

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
    expect(featureSuits('bar', 'tavern_hall')).toBe(true);
    expect(featureSuits('bar', 'tavern_room')).toBe(false);
    expect(featureSuits('bar', 'tavern_storeroom')).toBe(false);
  });

  it('keeps bunks to the room people sleep in', () => {
    expect(featureSuits('bunks', 'tavern_room')).toBe(true);
    expect(featureSuits('bunks', 'tavern_hall')).toBe(false);
  });

  it('allows a feature to belong to more than one kind of place', () => {
    expect(featureSuits('hearth', 'tavern_hall')).toBe(true);
    expect(featureSuits('hearth', 'tavern_room')).toBe(true);
    expect(featureSuits('hearth', 'tavern_storeroom')).toBe(false);
  });

  it('throws on a word outside the vocabulary rather than answering false', () => {
    // Answering `false` would be indistinguishable from "that feature does not
    // suit this place", and a caller that skipped `isFeature` would silently
    // drop the word with the wrong reason recorded against it.
    expect(() => featureSuits('throne' as Feature, 'tavern_hall')).toThrow(RangeError);
    expect(() => featureSuits('throne' as Feature, 'tavern_hall')).toThrow(
      'throne is not in the feature vocabulary',
    );
  });
});

describe('featuresFor', () => {
  it('gives every place type at least one feature it can hold', () => {
    for (const placeType of PLACE_TYPES) {
      expect(featuresFor(placeType).length).toBeGreaterThan(0);
    }
  });

  it('returns only features that suit the place', () => {
    for (const placeType of PLACE_TYPES) {
      for (const feature of featuresFor(placeType)) {
        expect(featureSuits(feature, placeType)).toBe(true);
      }
    }
  });

  it('accounts for every feature in the vocabulary across the three places', () => {
    // A feature that suits nowhere would be a word the prompt offers the model
    // and `resolve` then always throws away.
    const reachable = new Set(PLACE_TYPES.flatMap((placeType) => featuresFor(placeType)));
    expect([...reachable].sort()).toEqual([...FEATURES].sort());
  });
});
