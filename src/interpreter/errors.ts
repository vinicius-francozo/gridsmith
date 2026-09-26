/**
 * The ways interpretation can fail, as distinct types.
 *
 * The interpreter is the only layer of this project that touches the network,
 * so it is the only layer that can fail for reasons that have nothing to do
 * with the map being asked for. Each of those reasons needs a different answer
 * from the person at the table — "paste a key", "that key is wrong", "you are
 * offline", "your browser refused the answer" — and a single `Error` with a
 * message string would force the interface to match on prose to tell them
 * apart. These types carry that decision instead.
 */

import Anthropic from '@anthropic-ai/sdk';

/** Base of every failure this layer reports. Never thrown directly. */
export abstract class InterpreterError extends Error {
  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/** No key was supplied at all. */
export class MissingApiKeyError extends InterpreterError {
  constructor() {
    super('No API key was supplied. Paste an Anthropic API key to interpret a description.');
    this.name = 'MissingApiKeyError';
  }
}

/** A key was supplied and the API rejected it. */
export class InvalidApiKeyError extends InterpreterError {
  constructor(options?: ErrorOptions) {
    super('The API key was rejected. Check that it is an Anthropic key and that it is still active.', options);
    this.name = 'InvalidApiKeyError';
  }
}

/** The request never reached the API. */
export class NetworkError extends InterpreterError {
  constructor(options?: ErrorOptions) {
    super('Could not reach the Anthropic API. Check the connection and try again.', options);
    this.name = 'NetworkError';
  }
}

/**
 * The browser refused to hand the response to the page.
 *
 * Verified against the live API: a request carrying an `Origin` header is
 * answered with `access-control-allow-origin: *` **only** when it also carries
 * `anthropic-dangerous-direct-browser-access: true`, which the SDK sends for
 * us whenever the client is built with `dangerouslyAllowBrowser: true`. So a
 * page built by `createClaudeClient` is not blocked by the API itself, and
 * this error means something between the page and the API removed that
 * header or the response's CORS headers — a corporate proxy, an extension, or
 * a rewritten `baseURL`.
 */
export class CorsError extends InterpreterError {
  constructor(options?: ErrorOptions) {
    super(
      'The browser blocked the response from the Anthropic API. ' +
        'Something between this page and the API is stripping the cross-origin headers — ' +
        'a proxy or a browser extension is the usual cause.',
      options,
    );
    this.name = 'CorsError';
  }
}

/**
 * The API answered, but not with something this layer can use: no text came
 * back, or the JSON it returned does not satisfy the constraints schema.
 *
 * The API does not enforce the schema for us. `zodOutputFormat` sends the
 * enums and the numeric bounds as a *description*, not as grammar, so the
 * model is free to answer `placeType: "throne_room"` and the request still
 * succeeds. Validation on this side is what closes the vocabulary, and this is
 * what it throws when the answer falls outside it.
 */
export class UnusableResponseError extends InterpreterError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`The model's answer could not be read as a set of constraints: ${detail}`, options);
    this.name = 'UnusableResponseError';
  }
}

/** The API refused the request for any other reason: rate limit, outage, bad request. */
export class UpstreamError extends InterpreterError {
  /** The HTTP status the API answered with, when it sent one. */
  readonly status: number | undefined;

  constructor(status: number | undefined, detail: string, options?: ErrorOptions) {
    super(
      `The Anthropic API refused the request${status === undefined ? '' : ` (HTTP ${status})`}: ${detail}`,
      options,
    );
    this.name = 'UpstreamError';
    this.status = status;
  }
}

/**
 * What the code can observe about where it is running.
 *
 * It is a parameter rather than a global read so that the classification below
 * stays a pure function, and so that the tests can describe a browser without
 * running in one.
 */
export type Runtime = {
  /** Whether this is a browser, which is the only place CORS exists. */
  isBrowser: boolean;
  /** Whether the machine reports having a connection. */
  isOnline: boolean;
};

/**
 * What the current environment looks like, read once at the call site.
 *
 * The test for a browser is `window.document`, not `navigator`: Node has
 * defined a global `navigator` since v21, so checking that alone would call
 * every test run a browser and report a dropped connection as a CORS block.
 */
export function detectRuntime(): Runtime {
  const isBrowser =
    typeof window !== 'undefined' &&
    typeof window.document !== 'undefined' &&
    typeof navigator !== 'undefined';
  return {
    isBrowser,
    // `navigator.onLine` is false only when the machine knows it is offline; a
    // captive portal still reports true. That asymmetry is fine here, because
    // it is only used to rule the offline case out.
    isOnline: isBrowser ? navigator.onLine : true,
  };
}

/**
 * The typed failure that `error` stands for.
 *
 * Returns rather than throws, so the caller keeps the `throw` and the stack
 * that goes with it.
 *
 * @param error whatever `messages.parse` rejected with.
 * @param runtime where this is running — see `Runtime`.
 */
export function classifyRequestFailure(error: unknown, runtime: Runtime): InterpreterError {
  // Already classified — a failure raised by this layer, not by the SDK.
  // Without this the checks below would demote it to `UpstreamError`.
  if (error instanceof InterpreterError) {
    return error;
  }

  if (error instanceof Anthropic.AuthenticationError) {
    return new InvalidApiKeyError({ cause: error });
  }

  // A timeout is a connection failure, but the request did leave and no
  // browser was involved in losing it, so it is never CORS.
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new NetworkError({ cause: error });
  }

  if (error instanceof Anthropic.APIConnectionError) {
    // A blocked cross-origin response and a dead connection are the same event
    // to JavaScript: `fetch` rejects with an opaque failure either way, by
    // design, so that a page cannot probe a network it may not read. The one
    // signal left is whether the machine has a connection at all.
    const blockedByBrowser = runtime.isBrowser && runtime.isOnline;
    return blockedByBrowser ? new CorsError({ cause: error }) : new NetworkError({ cause: error });
  }

  if (error instanceof Anthropic.APIError) {
    return new UpstreamError(error.status, error.message, { cause: error });
  }

  // `AnthropicError` that is not an `APIError` is raised after the response
  // arrives — it is how the SDK reports content it could not parse against the
  // output format.
  if (error instanceof Anthropic.AnthropicError) {
    return new UnusableResponseError(error.message, { cause: error });
  }

  return new UpstreamError(undefined, error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}
