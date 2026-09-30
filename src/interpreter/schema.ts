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

/**
 * The two halves of a place, as the vocabulary a model's answer is held to.
 *
 * **Written out by hand, and exported so that a test can hold them to the
 * registry.** They cannot be derived from `BUILDING_REGISTRY` and
 * `ROOM_REGISTRY` the way `Building` and `RoomKind` are: `zodOutputFormat`
 * sends an enum to the model inside the JSON Schema `description` rather than
 * as grammar, so these strings are also the only place the model is *told* what
 * the words are, and a list assembled at import time is a list nobody can read
 * in the file it is sent from.
 *
 * The cost of writing them out is that nothing stops them going stale, and the
 * three copies are not equally exposed — measured by removing a word from each
 * and running `tsc`:
 *
 * - **`ROOM_ENUM` is caught by the compiler**, through `schema.test.ts`'s
 *   mutual assignability check: a room added to the registry widens
 *   `Constraints` and `ParsedConstraints` stops accepting it.
 * - **`BUILDING_ENUM` is caught the same way**, by the same two lines. A
 *   building the enum omits makes `Constraints` unassignable to
 *   `ParsedConstraints` on `place.building`, and `npm run typecheck` fails.
 * - **`read.ts`'s copy is caught by nothing.** Its parsed value is *narrower*
 *   than `Building`, so every assignment there compiles with a word missing,
 *   `npm run typecheck` is clean and so is `npm run build`.
 *
 * So it is the third that the run-time check below exists for, and the first
 * two are held by it as well rather than being trusted to a compiler error in a
 * test file. `npm run build` is clean for all three, which is the property that
 * makes any of them shippable while wrong. What happens instead is that the Jev
 * engine refuses the answer at `read.ts` and the Claude engine is never told the
 * word exists.
 *
 * `schema.test.ts` is the net, and it holds all three copies — these two and
 * `read.ts`'s — against the registries at run time.
 */
export const BUILDING_ENUM = z.enum([
  'tavern', 'dungeon', 'forge', 'temple', 'library', 'tower', 'mine', 'ship',
]);
export const ROOM_ENUM = z.enum([
  'hall', 'room', 'storeroom', 'crypt', 'smithy', 'reading', 'archive', 'laboratory', 'observatory',
  'hoist', 'cabin',
]);

export const constraintsSchema = z
  .object({
    place: z.object({
      building: BUILDING_ENUM,
      room: ROOM_ENUM,
    }).refine((place) => roomsFor(place.building).includes(place.room), {
      message: 'The room is unavailable in this building.',
    }).describe(
      // The `refine` above has always been here and, until `crypt`, it could
      // never fire: every building had every room, so no pair the enums admit
      // was unsupported. The matrix is sparse now, `tavern` + `crypt` is a
      // combination the enums admit and the refusal rejects, and a rejection
      // here costs the whole request. So the description stops saying "choose a
      // supported combination" and says which they are — this is the only place
      // the model is told, since `zodOutputFormat` sends these as a hint in the
      // JSON Schema description rather than as grammar the API enforces.
      'The building and the room inside it. The matrix is sparse: each building has only the rooms ' +
        'listed for it, and a pair that is not listed is refused outright. ' +
        'tavern: hall, room, storeroom. ' +
        'dungeon: hall, room, storeroom, crypt — the burial chamber, a catacomb or ossuary with ' +
        'sarcophagi and bone niches. ' +
        'forge: smithy, the fire and the anvil, and room, the shop front where the blades are shown. ' +
        'temple: hall, the nave with its altar and pews, and room, the sacristy the vestments are kept in. ' +
        'library: reading, the reading room with its shelves and lecterns, and archive, the stacks. ' +
        'tower: laboratory, a mage\'s working floor with a summoning circle on it, and observatory, ' +
        'the chamber at the top of the stair. ' +
        'mine: room, the digging gallery with its ore cart, and hoist, the winding house over the shaft. ' +
        'ship: room, the cargo hold with its guns, and cabin, the captain\'s great cabin aft.',
    ),
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
      .describe(
        'How much loose stuff is strewn over the floor — dust, rubble, shards, straw. ' +
          '0 is a bare floor, 1 is barely walkable. Not about furniture: that is `furnishing`.',
      ),
    furnishing: z
      .number()
      .min(0)
      .max(1)
      .describe(
        'How furnished the place is: how many tables, benches, crates and the like stand in it. ' +
          '0 is an empty room, 1 is packed. Judge it separately from `clutter` — a filthy ruin ' +
          'is usually high clutter and low furnishing.',
      ),
    features: z
      .array(z.string())
      .describe(
        `Named things the place contains, drawn only from: ${FEATURES.join(', ')}. ` +
          'Anything the description asks for that is not on that list goes in `unresolved` instead.',
      ),
    excluded: z
      .array(z.string())
      .describe(
        `Things from that same list the description says are NOT there, e.g. "sem escadaria" gives ["stairs"]. ` +
          'Only when the description says so. Leave it empty for anything it merely does not mention.',
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
