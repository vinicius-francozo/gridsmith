/**
 * The runtime shape of `Constraints`.
 *
 * `src/core/types.ts` declares what `Constraints` is; TypeScript erases that
 * at build time, and what comes back from a language model is whatever it felt
 * like writing. This schema is the same declaration in a form that still
 * exists at run time, and it is the only thing standing between the model's
 * answer and the generator.
 *
 * It is load-bearing in a way that is easy to underestimate. `zodOutputFormat`
 * does not turn these enums into grammar the API enforces — it sends them as a
 * hint inside the JSON Schema `description` (verified against the SDK's
 * `transformJSONSchema`). A model that answers `place.room: "throne_room"`
 * produces a perfectly successful HTTP response. This parse is what rejects
 * it.
 *
 * The `satisfies` below is the guard against the two files drifting apart: the
 * schema stops compiling the moment it stops describing the frozen type.
 */

import { z } from 'zod';

import type { Constraints } from '../core/types';
import { roomsFor } from '../generator/profiles';

import { FEATURES } from './vocabulary';

export const constraintsSchema = z
  .object({
    place: z.object({
      building: z.enum(['tavern', 'dungeon']),
      room: z.enum(['hall', 'room', 'storeroom']),
    }).refine((place) => roomsFor(place.building).includes(place.room), {
      message: 'The room is unavailable in this building.',
    }).describe('The building and its room. Choose a supported combination.'),
    sizeHint: z
      .enum(['small', 'medium', 'large'])
      .optional()
      .describe(
        'Relative to other places of the same kind, and only when the description says so. ' +
          'A large room is still smaller than a small hall. Leave it out when no size was mentioned.',
      ),
    light: z.enum(['dark', 'dim', 'bright']).describe('How lit the place is.'),
    condition: z
      .enum(['tidy', 'lived_in', 'disordered', 'ruined'])
      .describe(
        'How well kept the place is: swept and ordered, ordinarily used, ' +
          'actively in disarray, or falling apart.',
      ),
    clutter: z
      .number()
      .min(0)
      .max(1)
      .describe('How much loose stuff covers the floor. 0 is a bare floor, 1 is barely walkable.'),
    features: z
      .array(z.string())
      .describe(
        `Named things the place contains, drawn only from: ${FEATURES.join(', ')}. ` +
          'Anything the description asks for that is not on that list goes in `unresolved` instead.',
      ),
    unresolved: z
      .array(z.string())
      .describe(
        'Everything the description asked for that none of the fields above can carry, ' +
          'each in a few words. This is shown to the person, so it is what they asked for, ' +
          'not an apology.',
      ),
  })
  .describe('An enclosed room, described in the closed vocabulary the map generator understands.') satisfies z.ZodType<Constraints>;

/**
 * What parsing a model's answer yields.
 *
 * Exported so the tests can assert, at compile time, that it and `Constraints`
 * are the same type in both directions. A one-way check would let either file
 * quietly grow a field the other does not have.
 */
export type ParsedConstraints = z.infer<typeof constraintsSchema>;
