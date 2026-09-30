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
import { BUILDING_ENUM } from './schema';
import { FEATURES } from './vocabulary';

/**
 * No test here reaches the network. Every client is this stub, and the one
 * test that builds a real client never calls it.
 */

const IN_BROWSER: Runtime = { isBrowser: true, isOnline: true };
const IN_NODE: Runtime = { isBrowser: false, isOnline: true };

/** What the model answers with. `unresolved` is whatever it felt like writing. */
const answer: Constraints = {
  place: { building: 'tavern', room: 'hall' },
  light: 'dim',
  condition: 'disordered',
  clutter: 0.6,
  furnishing: 0.4,
  features: ['bar', 'hearth'],
  excluded: [],
  unresolved: [],
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

    expect(() => parse(JSON.stringify({ ...answer, place: 'throne_room' }))).toThrow(/place/);
    expect(() => parse(JSON.stringify({ ...answer, light: 'candlelit' }))).toThrow(/light/);
    expect(() => parse(JSON.stringify({ ...answer, clutter: 4 }))).toThrow(/clutter/);
    expect(() => parse(JSON.stringify({ ...answer, unresolved: undefined }))).toThrow(/unresolved/);
    expect(() => parse('not json at all')).toThrow();
  });

  it('leaves the model room to reason as well as to answer, and stays under the ceiling', async () => {
    // Two sides, because the budget has two ways to be wrong and only one of
    // them is visible from here. Below: reasoning is on by default on this
    // model and is spent out of the same budget as the answer, so a budget
    // sized for a few hundred tokens of JSON buys a truncation rather than a
    // map — 16000 is what the guide suggests defaulting to without streaming.
    // Above: a call that does not stream projects its time limit from this
    // number and the SDK throws outright past ten minutes' worth, at 21333
    // tokens. A budget over that passes a suite of stubs and fails every real
    // request, so the margin is asserted rather than left to be discovered.
    const { client, calls } = stubClient(respondsWith(answer));

    await interpreterWith(client).interpret('a tavern hall');

    expect(calls[0].max_tokens).toBeGreaterThanOrEqual(16000);
    expect(calls[0].max_tokens).toBeLessThanOrEqual(21333);
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

  it('tells the model to fill `excluded` only from what the description denies', async () => {
    // The one field no classifier can fill (see `local/interpret.ts`), so on
    // this engine it rests entirely on the prompt. "Only then" is the load-
    // bearing half: a model that also listed what the description failed to
    // mention would refuse most of the vocabulary on every request.
    const { client, calls } = stubClient(respondsWith(answer));

    await interpreterWith(client).interpret('um salão sem escadaria');

    expect(calls[0].system).toContain('`excluded`');
    expect(calls[0].system).toContain('"sem escadaria" gives ["stairs"]. Only then.');
    expect(calls[0].system).toContain('mentions stairs leaves `excluded` empty');
  });

  it('asks for condition, clutter and furnishing as three separate judgements', async () => {
    // Defect D3 on this engine. The prompt used to name two of the three and
    // let the furniture count follow the dirt.
    const { client, calls } = stubClient(respondsWith(answer));

    await interpreterWith(client).interpret('uma catacumba suja');

    expect(calls[0].system).toContain('three separate questions');
    for (const field of ['condition', 'clutter', 'furnishing']) {
      expect(calls[0].system).toContain(`\`${field}\``);
    }
  });

  it('frames the place vocabulary as both tavern and dungeon', async () => {
    const { client, calls } = stubClient(respondsWith(answer));

    await interpreterWith(client).interpret('uma cela de masmorra');

    // The sentence used to name two buildings and there are more than two. It
    // is built from `BUILDING_ENUM` now, so what is pinned is that every word
    // the schema offers reaches the prompt — a list that lags the enum is a
    // prompt telling the model its vocabulary is smaller than it is.
    for (const building of BUILDING_ENUM.options) {
      expect(calls[0].system).toContain(building);
    }
    expect(calls[0].system).toContain('The buildings it can draw a room of are');
    expect(calls[0].system).not.toContain('description of a tavern space');
  });
});

describe('taking language out of what could not be expressed', () => {
  // `unresolved` is the one field the schema cannot hold to a vocabulary — it
  // exists to carry what the vocabulary has no word for. What comes back is a
  // model's prose, in whatever language it chose; what leaves here is a code,
  // so the interface can put its own words to it.

  it('gives every entry a code, keeping what was asked for as the detail', async () => {
    const { client } = stubClient(respondsWith({ ...answer, unresolved: ['a cellar below', 'chuva lá fora'] }));

    await expect(interpreterWith(client).interpret('a hall')).resolves.toMatchObject({
      unresolved: ['unsupported_request:a cellar below', 'unsupported_request:chuva lá fora'],
    });
  });

  it('leaves an entry that already names a code exactly as it is', async () => {
    const { client } = stubClient(respondsWith({ ...answer, unresolved: ['unsupported_request:a cellar below'] }));

    await expect(interpreterWith(client).interpret('a hall')).resolves.toMatchObject({
      unresolved: ['unsupported_request:a cellar below'],
    });
  });

  it('drops an entry with nothing in it rather than coding an empty request', async () => {
    const { client } = stubClient(respondsWith({ ...answer, unresolved: ['', '   '] }));

    await expect(interpreterWith(client).interpret('a hall')).resolves.toMatchObject({ unresolved: [] });
  });

  it('asks the model for the request in the words of the description, not for an apology', async () => {
    // The detail is the only part of an entry that carries language, and it
    // is the person's own. Asking for English there would hand the interface
    // an English note about a Portuguese request.
    const { client, calls } = stubClient(respondsWith(answer));

    await interpreterWith(client).interpret('a hall');

    expect(calls[0].system).toContain('in the words of the');
    expect(calls[0].system).toContain('never as an apology');
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

  it('reports a missing key as its own failure, without spending a request', async () => {
    // The SDK does not read ANTHROPIC_API_KEY for an empty string — it only
    // does that when `apiKey` is undefined — so the empty key would travel as
    // an empty header and come back a round trip later as a 401, which this
    // layer reads as "that key was rejected". Telling somebody who has not
    // pasted a key that their key is wrong is the failure this guard avoids.
    const { client, calls } = stubClient(respondsWith(answer));
    const interpreter = new ClaudeInterpreter({ apiKey: '', client, runtime: IN_NODE });

    await expect(interpreter.interpret('a tavern hall')).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(calls).toHaveLength(0);
  });

  it('treats a key of only whitespace as no key', async () => {
    const { client, calls } = stubClient(respondsWith(answer));
    const interpreter = new ClaudeInterpreter({ apiKey: '   ', client, runtime: IN_NODE });

    await expect(interpreter.interpret('a tavern hall')).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(calls).toHaveLength(0);
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
    const failure = new Anthropic.AnthropicError('Failed to parse structured output: invalid place');

    await expect(interpreterWith(failingClient(failure)).interpret('a hall')).rejects.toBeInstanceOf(
      UnusableResponseError,
    );
  });
});

describe('telling a blocked response from a dead connection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const connectionFailure = (): Anthropic => failingClient(new Anthropic.APIConnectionError({ message: 'Connection error.' }));

  it('reads the environment when the request fails, not when the interpreter was built', async () => {
    // The page builds this the moment a key is pasted, and may not call it
    // for minutes. Photographed in the constructor, a connection that dropped
    // in between comes back as a CORS block telling the person to look at
    // their proxy or their extensions, which is the one diagnosis this
    // classification exists to keep them from being given.
    vi.stubGlobal('window', { document: {} });
    vi.stubGlobal('navigator', { onLine: true });
    const interpreter = new ClaudeInterpreter({ apiKey: 'sk-ant-test', client: connectionFailure() });

    vi.stubGlobal('navigator', { onLine: false });

    await expect(interpreter.interpret('a hall')).rejects.toBeInstanceOf(NetworkError);
  });

  it('still calls it a blocked response when the browser has a connection at the failure', async () => {
    vi.stubGlobal('window', { document: {} });
    vi.stubGlobal('navigator', { onLine: false });
    const interpreter = new ClaudeInterpreter({ apiKey: 'sk-ant-test', client: connectionFailure() });

    vi.stubGlobal('navigator', { onLine: true });

    await expect(interpreter.interpret('a hall')).rejects.toBeInstanceOf(CorsError);
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
