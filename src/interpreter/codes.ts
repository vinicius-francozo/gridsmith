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
 * Detail: the feature, lowercased. The kind of place is in `Params.placeType`
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

/** `clutter` was not a number and was read as an empty floor. No detail. */
export const CLUTTER_NOT_A_NUMBER = 'clutter_not_a_number';

/**
 * `clutter` was outside 0 to 1 and was brought into it.
 *
 * Detail: the value as it arrived, written as `String` writes it. What it
 * became is in `Params.clutter`.
 */
export const CLUTTER_OUT_OF_RANGE = 'clutter_out_of_range';

/** Every code `resolve` can put in `Params.conflicts`. */
export const CONFLICT_CODES = [
  FEATURE_NOT_IN_VOCABULARY,
  FEATURE_NOT_IN_PLACE,
  FEATURE_OVER_BUDGET,
  CLUTTER_NOT_A_NUMBER,
  CLUTTER_OUT_OF_RANGE,
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
 * Every code that may appear in `Constraints.unresolved`.
 *
 * There is exactly one, and that is a decision rather than an omission. What a
 * game master can ask for and this vocabulary cannot express is an open set —
 * naming a few kinds of it here would invite the model to round a request to
 * the nearest one, which is the same failure the prompt already warns it away
 * from for `features`. One code with the request kept in the detail says the
 * true thing: this was asked for, and the map will not have it.
 */
export const UNRESOLVED_CODES = [UNSUPPORTED_REQUEST] as const;

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
 * naming a code is kept as it stands, so the contract does not rest on the
 * model failing to follow it. Anything else becomes `unsupported_request` with
 * the text kept as the detail: the text is the person's own request, and
 * dropping it would leave the interface with a code and nothing to put after
 * it. An entry with nothing in it carries nothing, and goes.
 */
export function normalizeUnresolved(entries: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const raw of entries) {
    const text = raw.trim();
    if (text === '') {
      continue;
    }
    normalized.push(isUnresolvedCode(codeOf(text)) ? text : entry(UNSUPPORTED_REQUEST, text));
  }
  return normalized;
}

/** Whether `code` is one of the codes `unresolved` is allowed to carry. */
function isUnresolvedCode(code: string): code is UnresolvedCode {
  return (UNRESOLVED_CODES as readonly string[]).includes(code);
}
