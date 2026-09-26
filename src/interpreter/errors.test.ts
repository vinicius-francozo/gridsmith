import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classifyRequestFailure,
  CorsError,
  detectRuntime,
  InterpreterError,
  InvalidApiKeyError,
  MissingApiKeyError,
  NetworkError,
  UnusableResponseError,
  UpstreamError,
} from './errors';
import type { Runtime } from './errors';

const IN_BROWSER: Runtime = { isBrowser: true, isOnline: true };
const OFFLINE_BROWSER: Runtime = { isBrowser: true, isOnline: false };
const IN_NODE: Runtime = { isBrowser: false, isOnline: true };

/** The SDK's own 401, built the way the SDK builds it. */
function authenticationError() {
  return new Anthropic.AuthenticationError(
    401,
    { type: 'error', error: { type: 'authentication_error', message: 'API key is invalid.' } },
    'API key is invalid.',
    new Headers(),
  );
}

describe('classifyRequestFailure', () => {
  it('reads a rejected key as an invalid key, not as an outage', () => {
    expect(classifyRequestFailure(authenticationError(), IN_BROWSER)).toBeInstanceOf(InvalidApiKeyError);
  });

  it('reads a lost connection in a browser that is online as a blocked response', () => {
    const failure = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    expect(classifyRequestFailure(failure, IN_BROWSER)).toBeInstanceOf(CorsError);
  });

  it('reads a lost connection on an offline machine as a network failure', () => {
    // The machine knowing it is offline is the one signal that separates the
    // two: to JavaScript a blocked cross-origin response and a dead connection
    // are the same opaque `fetch` rejection.
    const failure = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    expect(classifyRequestFailure(failure, OFFLINE_BROWSER)).toBeInstanceOf(NetworkError);
  });

  it('never blames CORS outside a browser, where CORS does not exist', () => {
    const failure = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    expect(classifyRequestFailure(failure, IN_NODE)).toBeInstanceOf(NetworkError);
  });

  it('reads a timeout as a network failure even in an online browser', () => {
    // A timeout means the request left and nothing came back in time. The
    // browser never had a response to withhold, so this must not be sorted
    // into the CORS branch along with every other connection error.
    const failure = new Anthropic.APIConnectionTimeoutError({ message: 'Request timed out.' });
    expect(classifyRequestFailure(failure, IN_BROWSER)).toBeInstanceOf(NetworkError);
  });

  it('reads any other API refusal as an upstream failure and keeps the status', () => {
    const failure = new Anthropic.RateLimitError(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'Slow down.' } },
      'Slow down.',
      new Headers(),
    );
    const classified = classifyRequestFailure(failure, IN_BROWSER);

    expect(classified).toBeInstanceOf(UpstreamError);
    expect((classified as UpstreamError).status).toBe(429);
    expect(classified.message).toContain('429');
  });

  it('reads a post-response SDK failure as an unusable answer', () => {
    // This is the shape a failed schema parse arrives in: `zodOutputFormat`
    // throws a bare `AnthropicError` after the HTTP call has already succeeded.
    const failure = new Anthropic.AnthropicError('Failed to parse structured output: ...');
    expect(classifyRequestFailure(failure, IN_BROWSER)).toBeInstanceOf(UnusableResponseError);
  });

  it('passes an already-typed failure through untouched', () => {
    // Without this the checks below it would demote a decision this layer
    // already made into a generic upstream failure.
    const original = new MissingApiKeyError();
    expect(classifyRequestFailure(original, IN_BROWSER)).toBe(original);
  });

  it('wraps something that is not an Error at all', () => {
    const classified = classifyRequestFailure('everything broke', IN_BROWSER);
    expect(classified).toBeInstanceOf(UpstreamError);
    expect(classified.message).toContain('everything broke');
  });

  it('keeps the original failure as the cause, so a stack is not lost', () => {
    const failure = authenticationError();
    expect(classifyRequestFailure(failure, IN_BROWSER).cause).toBe(failure);
  });
});

describe('the error types themselves', () => {
  const each: InterpreterError[] = [
    new MissingApiKeyError(),
    new InvalidApiKeyError(),
    new NetworkError(),
    new CorsError(),
    new UnusableResponseError('no text'),
    new UpstreamError(500, 'overloaded'),
  ];

  it('are all catchable as one kind', () => {
    for (const error of each) {
      expect(error).toBeInstanceOf(InterpreterError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('each carry their own name, so a log says which one happened', () => {
    const names = each.map((error) => error.name);
    expect(new Set(names).size).toBe(each.length);
    expect(names).toContain('CorsError');
  });

  it('each carry their own message, so the interface never matches on prose', () => {
    const messages = each.map((error) => error.message);
    expect(new Set(messages).size).toBe(each.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('tell a missing key apart from a rejected one in words, not just in type', () => {
    expect(new MissingApiKeyError().message).toContain('No API key');
    expect(new InvalidApiKeyError().message).toContain('rejected');
  });

  it('names the status in an upstream message only when there is one', () => {
    expect(new UpstreamError(503, 'overloaded').message).toContain('HTTP 503');
    expect(new UpstreamError(undefined, 'overloaded').message).not.toContain('HTTP');
  });
});

describe('detectRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not call a plain Node process a browser', () => {
    // Node has defined a global `navigator` since v21. Testing for that alone
    // would make every test run look like a browser, and would turn a dropped
    // connection in a script into a CORS report.
    expect(detectRuntime().isBrowser).toBe(false);
  });

  it('assumes a connection when there is no browser to ask', () => {
    expect(detectRuntime().isOnline).toBe(true);
  });

  it('recognises a real browser by its document', () => {
    vi.stubGlobal('window', { document: {} });
    vi.stubGlobal('navigator', { onLine: true });

    expect(detectRuntime()).toEqual({ isBrowser: true, isOnline: true });
  });

  it('reports a browser that says it is offline', () => {
    vi.stubGlobal('window', { document: {} });
    vi.stubGlobal('navigator', { onLine: false });

    expect(detectRuntime()).toEqual({ isBrowser: true, isOnline: false });
  });

  it('does not call a global window without a document a browser', () => {
    vi.stubGlobal('window', {});

    expect(detectRuntime().isBrowser).toBe(false);
  });
});
