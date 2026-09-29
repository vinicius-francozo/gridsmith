/**
 * The sixth implementation of `Interpreter`, and the first that needs a server.
 *
 * `ClaudeInterpreter` sends a sentence to a language model and reads JSON back.
 * `LocalInterpreter` runs a classifier in the browser and asks six
 * entailment questions. This one asks TypeSafe's Jev twelve structured
 * questions, then asks for a room in a second call restricted to the chosen
 * building. See `questions.ts` and `read.ts` for the translation.
 *
 * ## Why the proxy
 *
 * It does not call `https://api.typesafe.ai/v1/systemone` directly, and that is
 * measured rather than assumed: against the live API a `POST` carrying an
 * `Origin` comes back 200 **without** `access-control-allow-origin`, and the
 * `OPTIONS` preflight comes back 400, also without it. The API sends the other
 * CORS headers, so the omission looks deliberate; either way a browser discards
 * the response. Anthropic has an opt-in header that turns CORS on and Jev has
 * no equivalent that was found. So the call goes to a proxy of this project's
 * own, which relays the body untouched and answers with CORS open.
 *
 * The key stays the user's. It travels in a header, never in the URL, and the
 * proxy holds nothing — the same property `ClaudeInterpreter` has, kept for the
 * same reason: this project has no backend to hide a credential behind, and it
 * is not about to start storing other people's.
 */

import type { Constraints, Interpreter } from '../../core/types';

import { JevRejectedKeyError, JevUnavailableError, JevUnusableAnswerError } from './errors';
import { QUESTIONS, roomQuestionFor } from './questions';
import { readBuildingAnswers, readRoomAnswers } from './read';

/** The model this engine is written against. */
export const JEV_MODEL = 'jev-latest';

/** Where the proxy lives. Same origin, so the browser asks nothing of CORS. */
export const JEV_PROXY_ENDPOINT = '/api/jev';

/** The header the proxy reads the key out of, and the only place it appears. */
export const JEV_KEY_HEADER = 'x-typesafe-key';

/** How to build one. */
export type JevInterpreterOptions = {
  /** The user's TypeSafe key. Relayed by the proxy, never stored by it. */
  readonly apiKey: string;
  /** Where the proxy lives. Defaults to `JEV_PROXY_ENDPOINT`. Test seam. */
  readonly endpoint?: string;
  /** Test seam: stands in for `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
};

export class JevInterpreter implements Interpreter {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JevInterpreterOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? JEV_PROXY_ENDPOINT;
    // Called through rather than captured. `globalThis.fetch` detached from its
    // global throws `Illegal invocation` in a browser, and reading it at the
    // call instead of at construction is also what lets a page install one
    // after an interpreter has been built.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  /**
   * The constraints `text` describes.
   *
   * @throws {RangeError} if `text` has nothing in it — the same refusal the
   *                      other two engines make, for the same reason: there is
   *                      no map in an empty description, and here it would cost
   *                      a round trip to find that out.
   * @throws {JevRejectedKeyError} if there is no key, or the proxy refused the
   *                               one there is.
   * @throws {JevUnavailableError} if the request never came back with an answer.
   * @throws {JevUnusableAnswerError} if it came back with one this layer cannot
   *                                  read.
   */
  async interpret(text: string): Promise<Constraints> {
    if (text.trim() === '') {
      throw new RangeError('interpret() needs a description to work from');
    }

    // Before the request, and for the same reason `ClaudeInterpreter` checks
    // here: sending an empty key buys a 401 one round trip later, which reads
    // as "that key was rejected" told to somebody who never pasted one.
    if (this.apiKey.trim() === '') {
      throw new JevRejectedKeyError('no key was supplied');
    }

    const first = readBuildingAnswers(await bodyOf(await this.post(text, QUESTIONS)));
    return readRoomAnswers(await bodyOf(await this.post(text, roomQuestionFor(first.building))), first);
  }

  /**
   * The proxy's response, once its status is known to carry an answer.
   *
   * The statuses are the ones the proxy's contract fixes: 401 or 403 when
   * TypeSafe refused the key, 502 when TypeSafe did not answer. Anything else
   * that is not a success is a request that did not get through either, and is
   * reported as one rather than given a type of its own — the person has the
   * same thing to do about all of them.
   */
  private async post(text: string, questions: object): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [JEV_KEY_HEADER]: this.apiKey },
        body: JSON.stringify({ state: text, model: JEV_MODEL, questions }),
      });
    } catch (error) {
      throw new JevUnavailableError(`${this.endpoint} could not be reached: ${messageOf(error)}`, {
        cause: error,
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new JevRejectedKeyError(`the proxy answered HTTP ${String(response.status)}`);
    }
    if (!response.ok) {
      throw new JevUnavailableError(`${this.endpoint} answered HTTP ${String(response.status)}`);
    }
    return response;
  }
}

/**
 * The parsed body of a successful response.
 *
 * A success that is not JSON is the proxy answering with something other than
 * what it relays — an error page from whatever is in front of it is the usual
 * shape — and that is an answer this layer cannot read rather than a request
 * that failed.
 */
async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new JevUnusableAnswerError(`the response was not JSON: ${messageOf(error)}`, { cause: error });
  }
}

/** Whatever `error` has to say for itself, without assuming it is an `Error`. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
