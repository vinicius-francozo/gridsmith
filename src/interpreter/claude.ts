/**
 * The language-model implementation of `Interpreter`.
 *
 * This is the only part of the project that leaves the machine. Everything
 * downstream of it — resolve, generate, render — is a pure function of what
 * comes back from here, which is why this file's whole job is to turn an
 * unbounded sentence into a value that satisfies `Constraints`, or to fail in
 * a way the interface can explain.
 *
 * It runs in the browser against the user's own key. That is a deliberate
 * choice recorded in the map: no backend exists to hide a key behind, so the
 * key is the user's and it is passed in, never read from the environment and
 * never compiled in.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import type { Constraints, Interpreter } from '../core/types';

import { normalizeUnresolved } from './codes';
import { classifyRequestFailure, detectRuntime, MissingApiKeyError, UnusableResponseError } from './errors';
import type { Runtime } from './errors';
import { constraintsSchema } from './schema';
import { FEATURES } from './vocabulary';

/** The model this interpreter is written against. */
export const INTERPRETER_MODEL = 'claude-opus-5';

/**
 * The ceiling on the whole answer, reasoning included.
 *
 * The JSON itself is a few hundred tokens. The rest is headroom for the
 * model's own reasoning, which is on by default on this model and is spent
 * out of this same budget — so a figure sized for the JSON alone is a figure
 * that runs out before the answer is written, which is the round trip this
 * headroom exists to avoid. 16000 is what the guide suggests defaulting to
 * for a request that does not stream: enough that running out is not the
 * ordinary case, and clear of the ceiling above it. Tokens left unspent cost
 * nothing.
 *
 * The ceiling is the SDK's, and it is a throw rather than a slow request: a
 * call that does not stream projects its time limit from this number and
 * refuses anything that could run past ten minutes, which lands at 21333
 * tokens (`calculateNonstreamingTimeout`, 0.128.0). A figure above that
 * passes every test in this file and fails every real call, so
 * `claude.test.ts` asserts both sides of the margin, not just the floor.
 */
const MAX_TOKENS = 16000;

/**
 * Sorting one sentence into seven fields is not hard work, and the map's
 * standard for this tool is that a place appears *during* the session, in
 * seconds. Low effort is the setting that respects that.
 */
const EFFORT = 'low';

const SYSTEM_PROMPT = [
  'You turn a spoken description of a tavern space into the closed set of constraints a',
  'battlemap generator understands. The description is what a game master said at the table,',
  'so it is short, it may be in any language, and it is often incomplete.',
  '',
  'Fill every required field. When the description does not say, choose what the place itself',
  'implies rather than refusing: a cellar is dark unless told otherwise, a common room in use',
  'is lived_in. Judge `clutter` on how much loose stuff is underfoot, separately from',
  '`condition`, which is how well kept the place is — a swept room can be crowded, and a',
  'ruined one can be bare.',
  '',
  `Use \`features\` only for these words: ${FEATURES.join(', ')}. Nothing else belongs there.`,
  'Do not translate a request into the nearest word on that list: a request for a well is not',
  'a hearth.',
  '',
  'Put in `unresolved` everything the description asked for that no field above can carry —',
  'a second floor, a specific NPC, a trapdoor, weather, anything outside this vocabulary.',
  'Write each entry as the thing that was asked for, in a few words, in the words of the',
  'description rather than translated, and never as an apology. This list reaches the game',
  'master so they know what the map will not contain, so leaving something out of it silently',
  'is worse than listing it.',
].join('\n');

/**
 * How to reach the model.
 *
 * `client` and `runtime` exist so the tests can drive every path without a
 * network or a browser. Neither is meant to be passed in production.
 */
export type ClaudeInterpreterOptions = {
  /** The user's own API key. Never read from the environment. */
  apiKey: string;
  /** Overrides the model. Defaults to `INTERPRETER_MODEL`. */
  model?: string;
  /** A client to use instead of building one. Test seam. */
  client?: Anthropic;
  /**
   * What the environment looks like, instead of reading it when a request
   * fails, for telling CORS from a dead connection. Test seam.
   */
  runtime?: Runtime;
};

/**
 * A browser-ready client for `apiKey`.
 *
 * `dangerouslyAllowBrowser` is what makes the SDK send
 * `anthropic-dangerous-direct-browser-access: true`, and that header is what
 * makes the API answer a cross-origin request with permissive CORS headers —
 * verified against the live API. Without it the browser discards the response
 * and the page sees only an opaque failure.
 */
export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export class ClaudeInterpreter implements Interpreter {
  private readonly apiKey: string;
  private readonly model: string;
  /** Set only when a caller supplied one; otherwise the environment is read at the failure. */
  private readonly fixedRuntime: Runtime | undefined;
  private client: Anthropic | undefined;

  constructor(options: ClaudeInterpreterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? INTERPRETER_MODEL;
    this.fixedRuntime = options.runtime;
    this.client = options.client;
  }

  /**
   * The constraints `text` describes.
   *
   * @throws {RangeError} if `text` has nothing in it. There is no map in an
   *                      empty description, and a round trip to find that out
   *                      costs the user a second they do not have.
   * @throws {InterpreterError} for every other failure — see `errors.ts`. Each
   *                            kind is a different type, because each one asks
   *                            something different of the person at the table.
   */
  async interpret(text: string): Promise<Constraints> {
    if (text.trim() === '') {
      throw new RangeError('interpret() needs a description to work from');
    }

    // Before the request, and before a client is built for it. The SDK does
    // not read the environment here — it falls back to `ANTHROPIC_API_KEY`
    // only when `apiKey` is `undefined` (`client.ts`, verified in 0.128.0),
    // so an empty string is kept and sent as an empty header. What that buys
    // is a 401 one round trip later, which this layer classifies as
    // `InvalidApiKeyError`: "that key was rejected", told to somebody who
    // never pasted a key. The guard costs nothing and names the real problem.
    if (this.apiKey.trim() === '') {
      throw new MissingApiKeyError();
    }

    try {
      return this.readAnswer(await this.request(text));
    } catch (error) {
      // The environment is read here rather than in the constructor. The page
      // builds an interpreter the moment a key is pasted and may not call it
      // for minutes, and what is being told apart — a blocked cross-origin
      // response from a dead connection — is a fact about the moment the
      // request died. A reading taken earlier would report a connection that
      // dropped in between as a `CorsError`, blaming a proxy or an extension
      // for an ordinary loss of signal: exactly the wrong diagnosis this
      // classification exists to avoid.
      throw classifyRequestFailure(error, this.fixedRuntime ?? detectRuntime());
    }
  }

  private async request(text: string) {
    this.client ??= createClaudeClient(this.apiKey);
    return this.client.messages.parse({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      output_config: { effort: EFFORT, format: zodOutputFormat(constraintsSchema) },
      messages: [{ role: 'user', content: text }],
    });
  }

  /**
   * The constraints in a parsed response.
   *
   * `stop_reason` is read before the content, because both of the ways this
   * call ends badly still arrive as a successful HTTP response, and both
   * leave `parsed_output` null. A refusal carries no answer at all. Running
   * out of tokens reaches here only when the cut came before any text block
   * was written — the budget went on reasoning — because an answer cut off
   * part-way through its JSON never gets this far: `messages.parse` raises on
   * the incomplete JSON, and that arrives as an `UnusableResponseError`
   * through `classifyRequestFailure`. Reading `parsed_output` first would
   * report both of the cases that do land here as "the model returned
   * nothing", which points at the wrong thing to fix.
   */
  private readAnswer(response: Awaited<ReturnType<ClaudeInterpreter['request']>>): Constraints {
    if (response.stop_reason === 'refusal') {
      throw new UnusableResponseError(
        `the model declined to answer (${response.stop_details?.category ?? 'no category given'})`,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new UnusableResponseError(`the answer was cut off at ${String(MAX_TOKENS)} tokens`);
    }

    // Null here does not mean the answer failed validation — a failed schema
    // parse is raised by the SDK and reaches `classifyRequestFailure` as an
    // `AnthropicError`. It means no text block came back to parse at all.
    if (response.parsed_output === null) {
      throw new UnusableResponseError('the response carried no text to read');
    }

    // The schema holds every other field to the vocabulary. `unresolved` is
    // free text by construction — it exists to carry what the vocabulary has
    // no word for — so it is the one field the model can answer anything in,
    // and `codes.ts` is what turns anything into an entry the interface can
    // read without knowing what language it was written in.
    return {
      ...response.parsed_output,
      unresolved: normalizeUnresolved(response.parsed_output.unresolved),
    };
  }
}
