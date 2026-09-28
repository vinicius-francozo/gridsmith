/**
 * The three ways the Jev engine fails, as siblings of the other two sets.
 *
 * `../errors.ts` is not reusable here and that is a fact about it rather than a
 * preference: its messages name the Anthropic API in so many words, and
 * `classifyRequestFailure` imports the SDK and matches against
 * `Anthropic.AuthenticationError` and its relatives. Only `InterpreterError`,
 * the abstract base, is general — and that is what these extend, so everything
 * already written against it keeps working.
 *
 * Three, because each asks something different of the person at the table:
 * the proxy or the network is down and there is nothing to do but retry; the
 * key was refused and a different one is needed; or the answer arrived and this
 * layer cannot use it, which is nobody's fault at the table and is worth
 * saying plainly rather than blaming the description.
 *
 * As in `local/errors.ts`, these reach the screen through the catch-all
 * `instanceof InterpreterError` arm of `describeFailure` in `src/ui/messages.ts`
 * until that file gains a phrase for each. `messages.ts` belongs to another
 * front and cannot be given one from here; it is reported rather than papered
 * over.
 */

import { InterpreterError } from '../errors';

/**
 * The request never came back with an answer.
 *
 * Every transport failure lands here: `fetch` rejecting, the proxy answering
 * 502 because TypeSafe did not respond, and any other status that is not a
 * refused key. They are one type because the answer to all of them is the same
 * — wait and try again — and telling them apart would mean the interface
 * carrying three sentences that ask for one thing.
 */
export class JevUnavailableError extends InterpreterError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`The Jev request did not get through: ${detail}`, options);
    this.name = 'JevUnavailableError';
  }
}

/** The key is missing, or the proxy answered 401 or 403 with it. */
export class JevRejectedKeyError extends InterpreterError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`The TypeSafe key was not accepted: ${detail}`, options);
    this.name = 'JevRejectedKeyError';
  }
}

/**
 * Jev answered, and the answer is not something this layer can use.
 *
 * Jev does not invent a value outside the schema it was given — a choice comes
 * back as one of its own keys, a noul as a number. That closes one hole and not
 * the other: the answer can still be about a question nobody asked, a score can
 * land outside the levels it was asked about, and the body can be something
 * other than a response at all. `constraintsSchema` is the last gate before the
 * generator, exactly as it is on the other two paths, and this is what it
 * throws.
 */
export class JevUnusableAnswerError extends InterpreterError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`Jev's answer could not be read as a set of constraints: ${detail}`, options);
    this.name = 'JevUnusableAnswerError';
  }
}
