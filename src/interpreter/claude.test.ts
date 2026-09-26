import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Constraints } from '../core/types';

import { ClaudeInterpreter, createClaudeClient, INTERPRETER_MODEL } from './claude';
import {
  CorsError,
  InvalidApiKeyError,
  MissingApiKeyError,
  NetworkError,
  UnusableResponseError,
  UpstreamError,
} from './errors';
import type { Runtime } from './errors';
import { FEATURES } from './vocabulary';

/**
 * No test here reaches the network. Every client is this stub, and the one
 * test that builds a real client never calls it.
 */

const IN_BROWSER: Runtime = { isBrowser: true, isOnline: true };
const IN_NODE: Runtime = { isBrowser: false, isOnline: true };

const answer: Constraints = {
  placeType: 'tavern_hall',
  light: 'dim',
  condition: 'disordered',
  clutter: 0.6,
  features: ['bar', 'hearth'],
  unresolved: ['a cellar below'],
};

type ParseCall = Parameters<Anthropic['messages']['parse']>[0];

/** A client whose `messages.parse` does whatever the test says. */
function stubClient(parse: (params: ParseCall) => unknown): { client: Anthropic; calls: ParseCall[] } {
  const calls: ParseCall[] = [];
  const client = {
    messages: {
      parse: (params: ParseCall) => {
        calls.push(params);
        return Promise.resolve(parse(params));
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

/** A successful response carrying `parsed_output`. */
function respondsWith(parsed: Constraints | null, stopReason = 'end_turn'): () => unknown {
  return () => ({ stop_reason: stopReason, stop_details: null, parsed_output: parsed, content: [] });
}

/**
 * The function the request itself carries for reading the model's answer.
 *
 * Every test here replaces `messages.parse`, which is where the SDK would
 * normally run this. Reaching into the recorded call and running it is what
 * keeps the schema on the wire exercised instead of merely present: without
 * it, the whole output format could be an inert object and no test would
 * notice. Throwing when it is missing is half of the assertion.
 */
function answerParserOf(call: ParseCall): (content: string) => unknown {
  const format: unknown = call.output_config?.format;
  if (
    typeof format !== 'object' ||
    format === null ||
    !('parse' in format) ||
    typeof format.parse !== 'function'
  ) {
    throw new Error('the request carried nothing to validate the answer with');
  }
  return format.parse as (content: string) => unknown;
}

/** A client whose `messages.parse` rejects. */
function failingClient(error: unknown): Anthropic {
  return {
    messages: { parse: () => Promise.reject(error) },
  } as unknown as Anthropic;
}

function interpreterWith(client: Anthropic, runtime: Runtime = IN_NODE): ClaudeInterpreter {
  return new ClaudeInterpreter({ apiKey: 'sk-ant-test', client, runtime });
}

describe('interpreting a description', () => {
  it('returns the constraints the model answered with', async () => {
    const { client } = stubClient(respondsWith(answer));

    await expect(interpreterWith(client).interpret('a tavern hall, dim, furniture knocked over')).resolves.toEqual(
      answer,
    );
  });

  it('sends the description through as the user turn, untranslated', async () => {
    const { client, calls } = stubClient(respondsWith(answer));
    // The map's own example inputs are Portuguese; the description must reach
    // the model as the person typed it.
    const description = 'um salão de taverna, luz baixa, móveis derrubados';

    await interpreterWith(client).interpret(description);

    expect(calls[0].messages).toEqual([{ role: 'user', content: description }]);
  });

  it('asks the model this project is written against', async () => {
    const { client, calls } = stubClient(respondsWith(answer));

    await interpreterWith(client).interpret('a tavern hall');

    expect(calls[0].model).toBe(INTERPRETER_MODEL);
    expect(INTERPRETER_MODEL).toBe('claude-opus-5');
  });

  it('honours a model override without changing the default', async () => {
    const { client, calls } = stubClient(respondsWith(answer));

    await new ClaudeInterpreter({
      apiKey: 'sk-ant-test',
      client,
      runtime: IN_NODE,
      model: 'claude-sonnet-5',
    }).interpret('a tavern hall');

    expect(calls[0].model).toBe('claude-sonnet-5');
  });

  it('constrains the answer to the schema rather than hoping for JSON', async () => {
    const { client, calls } = stubClient(respondsWith(answer));

    await interpreterWith(client).interpret('a tavern hall');

    expect(calls[0].output_config?.format?.type).toBe('json_schema');
  });

  it('carries a format that reads a well-formed answer back as constraints', async () => {
    const { client, calls } = stubClient(respondsWith(answer));

    await interpreterWith(client).interpret('a tavern hall');

    expect(answerParserOf(calls[0])(JSON.stringify(answer))).toEqual(answer);
  });

  it('carries a format that refuses an answer outside the vocabulary, which the API does not', async () => {
    // The API is not holding the model to this schema: `zodOutputFormat`
    // sends the enums and the bounds as a description, so `throne_room` comes
    // back with HTTP 200. The parse the request carries is the only thing
    // that closes the vocabulary — and it is the thing every other test here
    // stubs away, so it is asserted on the object the code actually builds.
    const { client, calls } = stubClient(respondsWith(answer));

    await interpreterWith(client).interpret('a tavern hall');
    const parse = answerParserOf(calls[0]);

    expect(() => parse(JSON.stringify({ ...answer, placeType: 'throne_room' }))).toThrow(/placeType/);
    expect(() => parse(JSON.stringify({ ...answer, light: 'candlelit' }))).toThrow(/light/);
    expect(() => parse(JSON.stringify({ ...answer, clutter: 4 }))).toThrow(/clutter/);
    expect(() => parse(JSON.stringify({ ...answer, unresolved: undefined }))).toThrow(/unresolved/);
    expect(() => parse('not json at all')).toThrow();
  });

  it('names the whole feature vocabulary in the prompt, so the model has the closed list', async () => {
    // A word the prompt never offers is a word the model invents a synonym
    // for, and `resolve` then throws away with a conflict the person cannot act on.
    const { client, calls } = stubClient(respondsWith(answer));

    await interpreterWith(client).interpret('a tavern hall');

    for (const feature of FEATURES) {
      expect(calls[0].system).toContain(feature);
    }
  });
});

describe('refusing to spend a request', () => {
  it('rejects an empty description without calling the API', async () => {
    const { client, calls } = stubClient(respondsWith(answer));

    await expect(interpreterWith(client).interpret('')).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });

  it('rejects a description that is only whitespace', async () => {
    const { client, calls } = stubClient(respondsWith(answer));

    await expect(interpreterWith(client).interpret('   \n  ')).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });

  it('reports a missing key before building a client, never falling back to the environment', async () => {
    // An empty key handed to the SDK makes it read ANTHROPIC_API_KEY instead,
    // which on a project with no backend means spending a key the user never
    // pasted. The guard has to come first.
    const interpreter = new ClaudeInterpreter({ apiKey: '', runtime: IN_NODE });

    await expect(interpreter.interpret('a tavern hall')).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it('treats a key of only whitespace as no key', async () => {
    const interpreter = new ClaudeInterpreter({ apiKey: '   ', runtime: IN_NODE });

    await expect(interpreter.interpret('a tavern hall')).rejects.toBeInstanceOf(MissingApiKeyError);
  });
});

describe('failing in a way the interface can explain', () => {
  it('reports a rejected key', async () => {
    const failure = new Anthropic.AuthenticationError(
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'API key is invalid.' } },
      'API key is invalid.',
      new Headers(),
    );

    await expect(interpreterWith(failingClient(failure)).interpret('a hall')).rejects.toBeInstanceOf(
      InvalidApiKeyError,
    );
  });

  it('reports a blocked response when it runs in an online browser', async () => {
    const failure = new Anthropic.APIConnectionError({ message: 'Connection error.' });

    await expect(
      interpreterWith(failingClient(failure), IN_BROWSER).interpret('a hall'),
    ).rejects.toBeInstanceOf(CorsError);
  });

  it('reports a network failure when there is no browser involved', async () => {
    const failure = new Anthropic.APIConnectionError({ message: 'Connection error.' });

    await expect(interpreterWith(failingClient(failure), IN_NODE).interpret('a hall')).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it('reports an outage as an upstream failure', async () => {
    const failure = new Anthropic.InternalServerError(
      529,
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded.' } },
      'Overloaded.',
      new Headers(),
    );

    await expect(interpreterWith(failingClient(failure)).interpret('a hall')).rejects.toBeInstanceOf(UpstreamError);
  });

  it('reports an answer that failed the schema, which the API does not enforce for us', async () => {
    // `zodOutputFormat` throws this after a perfectly successful HTTP call,
    // because the enums travel to the model as advice, not as grammar.
    const failure = new Anthropic.AnthropicError('Failed to parse structured output: invalid placeType');

    await expect(interpreterWith(failingClient(failure)).interpret('a hall')).rejects.toBeInstanceOf(
      UnusableResponseError,
    );
  });
});

describe('reading a response that arrived but says nothing', () => {
  it('reports a response with no text to read', async () => {
    const { client } = stubClient(respondsWith(null));

    await expect(interpreterWith(client).interpret('a hall')).rejects.toBeInstanceOf(UnusableResponseError);
  });

  it('reports an answer cut off at the token limit rather than blaming the content', async () => {
    // Truncated JSON and an empty response are different problems with
    // different fixes; `parsed_output` is null for both, so `stop_reason` has
    // to be read first.
    const { client } = stubClient(respondsWith(null, 'max_tokens'));

    await expect(interpreterWith(client).interpret('a hall')).rejects.toThrow('cut off');
  });

  it('reports a refusal as a refusal, and names the category', async () => {
    const { client } = stubClient(() => ({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: 'no' },
      parsed_output: null,
      content: [],
    }));

    await expect(interpreterWith(client).interpret('a hall')).rejects.toThrow('cyber');
  });

  it('survives a refusal that carries no category', async () => {
    const { client } = stubClient(() => ({
      stop_reason: 'refusal',
      stop_details: null,
      parsed_output: null,
      content: [],
    }));

    await expect(interpreterWith(client).interpret('a hall')).rejects.toBeInstanceOf(UnusableResponseError);
  });
});

describe('createClaudeClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a client a browser is allowed to use', () => {
    // This is the CORS decision in one line. Without `dangerouslyAllowBrowser`
    // the SDK refuses to construct here at all, and — verified against the
    // live API — it also stops sending the header that makes the API answer a
    // cross-origin request with permissive CORS headers. If this ever throws,
    // the whole no-backend design is gone.
    vi.stubGlobal('window', { document: {} });
    vi.stubGlobal('navigator', { onLine: true });

    expect(() => createClaudeClient('sk-ant-test')).not.toThrow();
  });

  it('uses the key it was handed', () => {
    expect(createClaudeClient('sk-ant-handed-in').apiKey).toBe('sk-ant-handed-in');
  });
});
