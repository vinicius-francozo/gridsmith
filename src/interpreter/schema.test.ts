import { describe, expect, it } from 'vitest';

import type { Constraints } from '../core/types';
import { BUILDINGS } from '../generator/profiles';

import { constraintsSchema } from './schema';
import type { ParsedConstraints } from './schema';

/** A complete, valid answer, used as the base for the rejection cases. */
const valid: Constraints = {
  place: { building: 'tavern', room: 'hall' },
  light: 'dim',
  condition: 'lived_in',
  clutter: 0.4,
  furnishing: 0.4,
  features: ['bar', 'hearth'],
  excluded: ['stairs'],
  unresolved: [],
};

describe('mirroring the frozen type', () => {
  it('parses to exactly the frozen Constraints type, in both directions', () => {
    // This body is the assertion: each line only compiles while the two types
    // are mutually assignable, so either file growing a field the other lacks
    // fails `npm run typecheck`. A one-way check would miss half of that.
    const fromSchema: ParsedConstraints = valid;
    const fromFrozen: Constraints = fromSchema;
    const roundTrip: ParsedConstraints = fromFrozen;

    expect(roundTrip).toEqual(valid);
  });
});

describe('accepting an answer', () => {
  it('parses a complete answer unchanged', () => {
    expect(constraintsSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a sizeHint when one is given', () => {
    const withHint = { ...valid, sizeHint: 'large' };
    expect(constraintsSchema.parse(withHint).sizeHint).toBe('large');
  });

  it('accepts the absence of a sizeHint, which is the common case', () => {
    expect(constraintsSchema.parse(valid).sizeHint).toBeUndefined();
  });

  it('accepts both ends of the clutter range', () => {
    expect(constraintsSchema.parse({ ...valid, clutter: 0 }).clutter).toBe(0);
    expect(constraintsSchema.parse({ ...valid, clutter: 1 }).clutter).toBe(1);
  });

  it('accepts both ends of the furnishing range, and an empty refusal list', () => {
    expect(constraintsSchema.parse({ ...valid, furnishing: 0 }).furnishing).toBe(0);
    expect(constraintsSchema.parse({ ...valid, furnishing: 1 }).furnishing).toBe(1);
    expect(constraintsSchema.parse({ ...valid, excluded: [] }).excluded).toEqual([]);
  });

  it('drops a field the vocabulary does not have instead of carrying it through', () => {
    const parsed = constraintsSchema.parse({ ...valid, ceilingHeight: 4 });
    expect(parsed).not.toHaveProperty('ceilingHeight');
  });
});

// The API does not enforce any of this. `zodOutputFormat` sends the enums and
// the bounds to the model as a description rather than as grammar, so a model
// answering outside the vocabulary still produces a successful response. These
// are the checks that actually close it.
describe('rejecting an answer', () => {
  it('rejects a place type outside the vocabulary', () => {
    expect(constraintsSchema.safeParse({ ...valid, place: 'throne_room' }).success).toBe(false);
    expect(constraintsSchema.safeParse({ ...valid, place: { building: 'forge', room: 'hall' } }).success).toBe(false);
    expect(constraintsSchema.safeParse({ ...valid, place: { building: 'toString', room: 'hall' } }).success).toBe(false);
  });

  it('takes a crypt in a dungeon and refuses the same word in a tavern', () => {
    // The pair the sparse matrix made reachable. `crypt` is a room the enum
    // admits and `tavern` is a building it admits, so the only thing between
    // `tavern_crypt` and the generator is the `refine` — which, until this
    // room existed, no pair the enums allowed could ever reach.
    expect(constraintsSchema.safeParse({ ...valid, place: { building: 'dungeon', room: 'crypt' } }).success).toBe(true);
    expect(constraintsSchema.safeParse({ ...valid, place: { building: 'tavern', room: 'crypt' } }).success).toBe(false);
  });

  it('rejects a valid room key absent from the chosen building', () => {
    const filling = BUILDINGS.dungeon.rooms.room;
    delete BUILDINGS.dungeon.rooms.room;
    try {
      expect(constraintsSchema.safeParse({ ...valid, place: { building: 'dungeon', room: 'room' } }).success).toBe(false);
    } finally {
      BUILDINGS.dungeon.rooms.room = filling;
    }
  });

  it('rejects a light level outside the vocabulary', () => {
    expect(constraintsSchema.safeParse({ ...valid, light: 'candlelit' }).success).toBe(false);
  });

  it('rejects a condition outside the vocabulary', () => {
    expect(constraintsSchema.safeParse({ ...valid, condition: 'cozy' }).success).toBe(false);
  });

  it('rejects a size hint outside the vocabulary', () => {
    expect(constraintsSchema.safeParse({ ...valid, sizeHint: 'enormous' }).success).toBe(false);
  });

  it('rejects clutter above 1', () => {
    expect(constraintsSchema.safeParse({ ...valid, clutter: 1.4 }).success).toBe(false);
  });

  it('rejects clutter below 0', () => {
    expect(constraintsSchema.safeParse({ ...valid, clutter: -0.2 }).success).toBe(false);
  });

  it('rejects clutter that is not a number at all', () => {
    expect(constraintsSchema.safeParse({ ...valid, clutter: 'a lot' }).success).toBe(false);
  });

  it('holds furnishing to the same range and the same type as clutter', () => {
    // A separate field with the same bounds, screened separately: the two used
    // to be one number and the whole point of the split is that they are not.
    expect(constraintsSchema.safeParse({ ...valid, furnishing: 1.4 }).success).toBe(false);
    expect(constraintsSchema.safeParse({ ...valid, furnishing: -0.2 }).success).toBe(false);
    expect(constraintsSchema.safeParse({ ...valid, furnishing: 'a lot' }).success).toBe(false);
  });

  it('rejects an excluded list that is not a list of strings', () => {
    expect(constraintsSchema.safeParse({ ...valid, excluded: 'stairs' }).success).toBe(false);
    expect(constraintsSchema.safeParse({ ...valid, excluded: [1, 2] }).success).toBe(false);
  });

  it('rejects features that are not a list of strings', () => {
    expect(constraintsSchema.safeParse({ ...valid, features: 'bar' }).success).toBe(false);
    expect(constraintsSchema.safeParse({ ...valid, features: [1, 2] }).success).toBe(false);
  });

  it('rejects an answer missing a required field', () => {
    const { condition: _dropped, ...withoutCondition } = valid;
    expect(constraintsSchema.safeParse(withoutCondition).success).toBe(false);
  });

  it('rejects an answer that is missing unresolved, so an omission cannot read as nothing omitted', () => {
    const { unresolved: _dropped, ...withoutUnresolved } = valid;
    expect(constraintsSchema.safeParse(withoutUnresolved).success).toBe(false);
  });

  it('rejects something that is not an object', () => {
    expect(constraintsSchema.safeParse('a tavern hall').success).toBe(false);
    expect(constraintsSchema.safeParse(null).success).toBe(false);
  });
});
