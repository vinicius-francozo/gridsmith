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

import { classifyRequestFailure, detectRuntime, MissingApiKeyError, UnusableResponseError } from './errors';
import type { Runtime } from './errors';
import { constraintsSchema } from './schema';
import { FEATURES } from './vocabulary';

/** The model this interpreter is written against. */
export const INTERPRETER_MODEL = 'claude-opus-5';

/**
 * Generous for an answer that is a few hundred tokens of JSON. The headroom is
 * for the model's own reasoning, which is on by default on this model; running
 * out mid-answer truncates the JSON and costs a whole round trip.
 */
const MAX_TOKENS = 4096;

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
  'Write each entry in English, in a few words, as the thing that was asked for and not as an',
  'apology. This list is shown to the game master so they know what the map will not contain,',
  'so leaving something out of it silently is worse than listing it.',
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
  /** What the environment looks like, for telling CORS from a dead connection. Test seam. */
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
  private readonly runtime: Runtime;
  private client: Anthropic | undefined;

  constructor(options: ClaudeInterpreterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? INTERPRETER_MODEL;
    this.runtime = options.runtime ?? detectRuntime();
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

    // Before the client is built, not after: an empty key handed to the SDK
    // makes it fall back to the environment, which on this project would mean
    // silently spending somebody else's key.
    if (this.apiKey.trim() === '') {
      throw new MissingApiKeyError();
    }

    try {
      return this.readAnswer(await this.request(text));
    } catch (error) {
      throw classifyRequestFailure(error, this.runtime);
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
   * call ends badly still arrive as a successful HTTP response. A refusal
   * carries no answer at all, and an answer cut off at `max_tokens` is
   * truncated JSON — reading `parsed_output` first would report either as
   * "the model returned nothing", which points at the wrong thing to fix.
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

    return response.parsed_output;
  }
}
