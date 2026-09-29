/**
 * The closed set of codes this layer reports its shortfalls in.
 *
 * `Constraints.unresolved` and `Params.conflicts` are the two places where the
 * interpreter says what it could not do, and both end up in front of a person.
 * A person's language is not this layer's business: the description arrives in
 * whatever the game master speaks, the project is written in English, and a
 * sentence in either field would put one language's note under another
 * language's request. So there is no language in the data at all. Each entry is
 * a code; the wording lives in a table in the interface, next to everything
 * else the person reads.
 *
 * An entry is `<code>` or `<code>:<detail>`. The code is everything before the
 * first colon; the detail is everything after it, and may contain colons of its
 * own. Every code is declared here, with what its detail holds.
 */

/**
 * A feature word the generator has no anchor for.
 *
 * Detail: the word as the model wrote it, trimmed — so the person recognises
 * what they asked for rather than a normalised version of it.
 */
export const FEATURE_NOT_IN_VOCABULARY = 'feature_not_in_vocabulary';

/**
 * A feature in the vocabulary, but not one that belongs in this kind of place:
 * a bar in a bedroom.
 *
 * Detail: the feature, lowercased. The kind of place is in `Params.place`
 * and is not repeated here.
 */
export const FEATURE_NOT_IN_PLACE = 'feature_not_in_place';

/**
 * A feature dropped because the floor has no room for one more.
 *
 * Detail: the feature, lowercased. How many fit is a function of
 * `Params.size`, so it is not repeated here either.
 */
export const FEATURE_OVER_BUDGET = 'feature_over_budget';

/**
 * A feature the description asked for and, in the same breath, asked there to
 * be none of. The exclusion won and the feature was dropped.
 *
 * Detail: the feature, lowercased.
 *
 * This is the only thing `excluded` reports, and the restraint is measured
 * rather than stylistic. An exclusion the generator simply honoured is not a
 * shortfall and says nothing worth reading — and, on the Jev engine, saying it
 * anyway would put words in the person's mouth: at the exclusion threshold that
 * front measured (`jev/questions.ts`, `EXCLUSION_THRESHOLD`), about one in nine
 * features a description never mentions also lands in `excluded`. A line
 * reading "you asked for no bunks" under a description that never mentioned
 * bunks is worse than silence. A feature that was asked for and then dropped is
 * a real loss, it cannot arrive by accident, and it is what this code is for.
 */
export const FEATURE_ALSO_EXCLUDED = 'feature_also_excluded';

/** `clutter` was not a number and was read as an empty floor. No detail. */
export const CLUTTER_NOT_A_NUMBER = 'clutter_not_a_number';

/**
 * `clutter` was outside 0 to 1 and was brought into it.
 *
 * Detail: the value as it arrived, written as `String` writes it. What it
 * became is in `Params.clutter`.
 */
export const CLUTTER_OUT_OF_RANGE = 'clutter_out_of_range';

/** `furnishing` was not a number and was read as a bare room. No detail. */
export const FURNISHING_NOT_A_NUMBER = 'furnishing_not_a_number';

/**
 * `furnishing` was outside 0 to 1 and was brought into it.
 *
 * Detail: the value as it arrived, written as `String` writes it. What it
 * became is in `Params.furnishing`.
 */
export const FURNISHING_OUT_OF_RANGE = 'furnishing_out_of_range';

/** Every code `resolve` can put in `Params.conflicts`. */
export const CONFLICT_CODES = [
  FEATURE_NOT_IN_VOCABULARY,
  FEATURE_NOT_IN_PLACE,
  FEATURE_OVER_BUDGET,
  FEATURE_ALSO_EXCLUDED,
  CLUTTER_NOT_A_NUMBER,
  CLUTTER_OUT_OF_RANGE,
  FURNISHING_NOT_A_NUMBER,
  FURNISHING_OUT_OF_RANGE,
] as const;

/** A code `resolve` can report. `conflicts` is ours, so it holds only these. */
export type ConflictCode = (typeof CONFLICT_CODES)[number];

/**
 * Something the description asked for that no field of `Constraints` can
 * carry: a second floor, a named innkeeper, a trapdoor, the weather.
 *
 * Detail: what was asked for, in the words of the description.
 */
export const UNSUPPORTED_REQUEST = 'unsupported_request';

/**
 * The description is of a kind of place this vocabulary has no word for — a
 * forge, a crypt, a courtyard — and the nearest supported building/room pair was built.
 *
 * Detail: the stable `building_room` identifier that was built, so the wording can say what the
 * person got and not only what they did not get.
 *
 * Only an interpreter that can be *asked* this ever emits it. A classifier
 * compares the labels it was handed and returns the least unlikely one, so it
 * has nowhere to put "none of these"; `local/interpret.ts` says so in its
 * header and leaves `unresolved` empty for exactly that reason. Building the
 * nearest place rather than refusing follows `resolve.ts:221-237`, where a
 * feature that does not fit the place is left out and recorded instead of
 * rejected.
 */
export const PLACE_NOT_IN_VOCABULARY = 'place_not_in_vocabulary';

/**
 * Every code that may appear in `Constraints.unresolved`.
 *
 * Two, and the line between them is where it is on purpose.
 *
 * `UNSUPPORTED_REQUEST` stays one code over an open set, for two reasons. What
 * a game master can ask for and this vocabulary cannot express has no
 * enumeration — naming a few kinds of it here would invite the model to round a
 * request to the nearest one, which is the same failure the prompt already
 * warns it away from for `features`. And nothing downstream would do anything
 * different with the distinction: the interface displays the list, and a second
 * floor and the weather are shown the same way, so telling them apart buys it
 * nothing it could act on. A taxonomy invented before the consumer that needs
 * it is drawn along the wrong lines, and it has to be redrawn — after it is
 * already in saved maps — the day something actually branches on it. One code
 * with the request kept in the detail says the true thing now: this was asked
 * for, and the map will not have it.
 *
 * `PLACE_NOT_IN_VOCABULARY` is not a slice of that set. It is not something the
 * description asked for *besides* the place; it is the place, answered by a
 * question of its own, and the interface has a different thing to say about it
 * — the map in front of the person is of another kind of place, and the detail
 * names which. That is a branch, and it is the one the second code is for.
 */
export const UNRESOLVED_CODES = [UNSUPPORTED_REQUEST, PLACE_NOT_IN_VOCABULARY] as const;

/** A code the interpreter can report in `Constraints.unresolved`. */
export type UnresolvedCode = (typeof UNRESOLVED_CODES)[number];

/** Any code this layer can emit. */
export type Code = ConflictCode | UnresolvedCode;

/** An entry: the code alone, or the code and a detail. */
export function entry(code: Code, detail?: string): string {
  const trimmed = detail?.trim() ?? '';
  return trimmed === '' ? code : `${code}:${trimmed}`;
}

/** The code an entry carries: everything before the first colon. */
export function codeOf(value: string): string {
  const colon = value.indexOf(':');
  return colon === -1 ? value : value.slice(0, colon);
}

/**
 * `unresolved`, as the model answered it, brought into the contract.
 *
 * Everything else in this file is written by us. This one field is written by
 * a language model, and the API holds it to nothing — it can come back as a
 * sentence, as an apology, or as a code that does not exist. An entry already
 * naming a code is kept, so the contract does not rest on the model failing to
 * follow it — but kept through `entry`, not as it stands. The model writes the
 * spacing and the punctuation too, and an entry it wrote is only interchangeable
 * with one we wrote if it comes out in the same shape: `unsupported_request:`
 * with nothing after the colon is the bare code, and a detail padded with
 * spaces is that detail trimmed. Reading the two apart is work the interface
 * should not be doing twice.
 *
 * Anything else becomes `unsupported_request` with the text kept as the detail:
 * the text is the person's own request, and dropping it would leave the
 * interface with a code and nothing to put after it. An entry with nothing in
 * it carries nothing, and goes.
 */
export function normalizeUnresolved(entries: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const raw of entries) {
    const text = raw.trim();
    if (text === '') {
      continue;
    }
    const code = codeOf(text);
    normalized.push(
      isUnresolvedCode(code) ? entry(code, text.slice(code.length + 1)) : entry(UNSUPPORTED_REQUEST, text),
    );
  }
  return normalized;
}

/** Whether `code` is one of the codes `unresolved` is allowed to carry. */
function isUnresolvedCode(code: string): code is UnresolvedCode {
  return (UNRESOLVED_CODES as readonly string[]).includes(code);
}
