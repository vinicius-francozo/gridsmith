import { describe, expect, it } from 'vitest';

import type { Constraints } from '../core/types';
import { BUILDING_REGISTRY, BUILDINGS, ROOM_REGISTRY } from '../generator/profiles';

import { BUILDING_ANSWER } from './jev/read';
import { BUILDING_ENUM, constraintsSchema, ROOM_ENUM } from './schema';
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

/**
 * The three enums that are written out by hand, and the registries they have to
 * agree with.
 *
 * **All three in one place on purpose.** They are one invariant — *a word in
 * the registry is a word every reader admits* — and splitting it across
 * `schema.test.ts` and `read.test.ts` is how half of it would be maintained and
 * half forgotten. The one that is easiest to forget is the one furthest from
 * this file.
 */
const HAND_WRITTEN = [
  { where: 'schema.ts BUILDING_ENUM', options: BUILDING_ENUM.options, declared: Object.keys(BUILDING_REGISTRY) },
  { where: 'schema.ts ROOM_ENUM', options: ROOM_ENUM.options, declared: Object.keys(ROOM_REGISTRY) },
  { where: 'jev/read.ts BUILDING_ANSWER', options: BUILDING_ANSWER.options, declared: Object.keys(BUILDING_REGISTRY) },
] as const;

describe('the vocabulary the enums are written out in', () => {
  it('admits every building and every room the registry declares', () => {
    // **This is the one check between a new building and a silent failure in
    // production.** `Building` and `RoomKind` are derived from the registries
    // (`core/types.ts`), and every *exact* `Record` keyed on them stops
    // compiling until it is answered — which is what `profiles.test.ts` proves
    // and what carried the crypt front. A `z.enum` written out by hand is not
    // one of those: a list short of a word is a narrower union, every
    // assignment still compiles, and `npm run build` is clean.
    //
    // What the omission costs is invisible from here and different in each
    // engine. On Jev, `read.ts` refuses the answer and the request is lost. On
    // Claude, `zodOutputFormat` sends the enum as a hint in the JSON Schema
    // description, so the model is simply never told the word exists and can
    // never emit it. Neither path throws anything a test of that engine would
    // catch, because neither engine is asked about a building it was not
    // offered.
    //
    // Compared as sets and reported as sorted lists, because the enums are read
    // by people and the registries by `Object.keys` — an order that differs is
    // not a defect and a word that is missing is.
    for (const { where, options, declared } of HAND_WRITTEN) {
      expect(`${where}: ${[...options].sort().join(' ')}`).toBe(
        `${where}: ${[...declared].sort().join(' ')}`,
      );
    }
  });

  it('holds the two copies of the building list to each other', () => {
    // They are two lists of the same thing in two files, and the check above
    // would pass on both being stale in the same way only if the registry were
    // stale too. This one says the cheaper thing directly, so that a diff that
    // updates one and not the other names the file it forgot.
    expect([...BUILDING_ANSWER.options].sort()).toEqual([...BUILDING_ENUM.options].sort());
  });

  it('sweeps something, so an empty registry could not pass it quietly', () => {
    expect(HAND_WRITTEN).toHaveLength(3);
    for (const { where, declared } of HAND_WRITTEN) {
      expect(`${where}: ${String(declared.length > 0)}`).toBe(`${where}: true`);
    }
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
