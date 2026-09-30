import { describe, expect, it } from 'vitest';

import { InterpreterError } from '../errors';

import { JevRejectedKeyError, JevUnavailableError, JevUnusableAnswerError } from './errors';
import { JevInterpreter, JEV_KEY_HEADER, JEV_MODEL, JEV_PROXY_ENDPOINT } from './jev';

/**
 * No test here reaches the network. Every interpreter is built with a
 * `fetchImpl`, and the one test that reads the default never calls it.
 *
 * The response below is JSON text in the shape the proxy relays, typed out by
 * hand — not built from `QUESTIONS` or from the reader's schemas. The names on
 * this side of the boundary are what the request is asserted against, and a
 * fake assembled out of the code under test would make both sides move
 * together and assert nothing. Same rule as `read.test.ts`, which says why at
 * more length.
 */
const ANSWER = `{
  "model": "jev-1.13.0",
  "answers": {
    "building": {
      "type": "choice",
      "choice": "tavern",
      "probabilities": { "tavern": 1, "dungeon": 0 },
      "confidence": 0.94
    },
    "out_of_vocabulary": { "type": "noul", "noul": 0.08 },
    "light": { "type": "score", "score": 0.2, "legend": {}, "probabilities": {}, "confidence": 0.81 },
    "condition": { "type": "score", "score": 2, "legend": {}, "probabilities": {}, "confidence": 0.77 },
    "size": { "type": "score", "score": 0.1, "legend": {}, "probabilities": {}, "confidence": 0.72 },
    "furnishing": { "type": "score", "score": 1.5, "legend": {}, "probabilities": {}, "confidence": 0.7 },
    "feature_bar": { "type": "noul", "noul": 0.04 },
    "feature_hearth": { "type": "noul", "noul": 0.03 },
    "feature_stairs": { "type": "noul", "noul": 0.91 },
    "feature_pillars": { "type": "noul", "noul": 0.12 },
    "feature_alcove": { "type": "noul", "noul": 0.07 },
    "feature_shelving": { "type": "noul", "noul": 0.88 },
    "feature_bunks": { "type": "noul", "noul": 0.02 },
    "feature_bed": { "type": "noul", "noul": 0.05 },
    "feature_weapons": { "type": "noul", "noul": 0.03 },
    "feature_tomb": { "type": "noul", "noul": 0.01 }
  },
  "usage": { "input_tokens": 307, "output_tokens": 72 }
}`;
const ROOM_ANSWER = '{"answers":{"room":{"type":"choice","choice":"storeroom","confidence":0.94}}}';

/** The sixteen names the request has to carry, written out rather than derived. */
const QUESTION_NAMES = [
  'condition',
  'furnishing',
  'feature_alcove',
  'feature_bar',
  'feature_bed',
  'feature_bunks',
  'feature_hearth',
  'feature_pillars',
  'feature_shelving',
  'feature_stairs',
  'feature_tomb',
  'feature_weapons',
  'light',
  'out_of_vocabulary',
  'size',
  'building',
];

const KEY = 'ts-key-for-tests';

type Call = { input: RequestInfo | URL; init: RequestInit | undefined };

/** A `fetch` that records what it was handed and answers with `respond`. */
function stubFetch(respond: () => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    const response = await respond();
    return calls.length === 2 && response.ok ? new Response(ROOM_ANSWER) : response;
  };
  return { fetchImpl, calls };
}

/** A `fetch` that rejects, the way a dead connection does. */
function failingFetch(error: unknown): typeof fetch {
  return () => Promise.reject(error);
}

function answering(body: string, status = 200): () => Response {
  return () => new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

/** The parsed body of the one request that was made. */
function sentBody(calls: Call[]): Record<string, unknown> {
  expect(calls).toHaveLength(2);
  return JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
}

describe('refusing before the request', () => {
  it('refuses an empty description without a round trip', async () => {
    const { fetchImpl, calls } = stubFetch(answering(ANSWER));
    const interpreter = new JevInterpreter({ apiKey: KEY, fetchImpl });

    await expect(interpreter.interpret('   ')).rejects.toThrow(RangeError);
    expect(calls).toEqual([]);
  });

  it('refuses a missing key without a round trip, rather than buying a 401', async () => {
    const { fetchImpl, calls } = stubFetch(answering(ANSWER));
    const interpreter = new JevInterpreter({ apiKey: '  ', fetchImpl });

    await expect(interpreter.interpret('uma adega')).rejects.toThrow(JevRejectedKeyError);
    expect(calls).toEqual([]);
  });
});

describe('the request the proxy is handed', () => {
  it('posts the building questions then the room question to the proxy', async () => {
    const { fetchImpl, calls } = stubFetch(answering(ANSWER));

    await new JevInterpreter({ apiKey: KEY, fetchImpl }).interpret('uma adega fria');

    expect(calls[0].input).toBe(JEV_PROXY_ENDPOINT);
    expect(JEV_PROXY_ENDPOINT).toBe('/api/jev');
    expect(calls[0].init?.method).toBe('POST');

    const body = sentBody(calls);
    expect(body.state).toBe('uma adega fria');
    expect(body.model).toBe(JEV_MODEL);
    expect(JEV_MODEL).toBe('jev-latest');
    expect(Object.keys(body.questions as object).sort()).toEqual([...QUESTION_NAMES].sort());
    const second = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown>;
    expect(second.state).toBe(body.state);
    expect(Object.keys(second.questions as object)).toEqual(['room']);
    expect(Object.keys((second.questions as { room: { criteria: object } }).room.criteria)).toEqual([
      'hall', 'room', 'storeroom',
    ]);
    expect(JSON.stringify(second.questions)).not.toContain('Cripta');
  });

  it('uses dungeon criteria for the second request when the first answer chooses dungeon', async () => {
    const dungeonAnswer = ANSWER.replace('"choice": "tavern"', '"choice": "dungeon"');
    const { fetchImpl, calls } = stubFetch(answering(dungeonAnswer));
    const description = 'um arsenal da masmorra, com armas e caixotes';

    const constraints = await new JevInterpreter({ apiKey: KEY, fetchImpl }).interpret(description);

    expect(constraints.place).toEqual({ building: 'dungeon', room: 'storeroom' });
    expect(calls).toHaveLength(2);
    const first = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    const second = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown>;
    expect(first.state).toBe(description);
    expect(second.state).toBe(description);
    expect(second.questions).toEqual({
      room: {
        type: 'choice',
        instructions: 'Qual cômodo desta construção o texto descreve?',
        criteria: {
          hall: 'Sala comum ou da guarda da masmorra',
          room: 'Cela ou quarto da masmorra, com catre',
          storeroom: 'Arsenal ou depósito da masmorra, com armas e caixotes',
          crypt: 'Cripta, catacumba ou tumba: câmara funerária com sarcófagos, ossadas e nichos',
        },
      },
    });
    expect(JSON.stringify(second.questions)).not.toContain('taverna');
  });

  it('asks each question as the primitive it was designed for', async () => {
    // The mapping is the measured part of this front: an ordered scale asked
    // as a choice is exactly the information the zero-shot path had to discard.
    const { fetchImpl, calls } = stubFetch(answering(ANSWER));

    await new JevInterpreter({ apiKey: KEY, fetchImpl }).interpret('uma adega fria');

    const questions = sentBody(calls).questions as Record<string, { type: string }>;
    expect(questions.building.type).toBe('choice');
    expect(questions.out_of_vocabulary.type).toBe('noul');
    expect(questions.light.type).toBe('score');
    expect(questions.condition.type).toBe('score');
    expect(questions.size.type).toBe('score');
    for (const name of QUESTION_NAMES.filter((n) => n.startsWith('feature_'))) {
      expect(questions[name].type).toBe('noul');
    }
  });

  it('puts the key in a header and nowhere else', async () => {
    const { fetchImpl, calls } = stubFetch(answering(ANSWER));

    await new JevInterpreter({ apiKey: KEY, fetchImpl }).interpret('uma adega fria');

    expect(calls).toHaveLength(2);
    expect(JEV_KEY_HEADER).toBe('x-typesafe-key');
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string>;
      expect(headers[JEV_KEY_HEADER]).toBe(KEY);
      expect(headers['content-type']).toBe('application/json');
      // The URL is logged by every server between here and the proxy.
      expect(String(call.input)).not.toContain(KEY);
      expect(String(call.init?.body)).not.toContain(KEY);
    }
  });

  it('goes where it is told to, when it is told', async () => {
    const { fetchImpl, calls } = stubFetch(answering(ANSWER));

    await new JevInterpreter({
      apiKey: KEY,
      endpoint: 'http://localhost:5173/api/jev',
      fetchImpl,
    }).interpret('uma adega fria');

    expect(calls[0].input).toBe('http://localhost:5173/api/jev');
  });
});

describe('what comes back', () => {
  it('reads a whole answer into constraints', async () => {
    const { fetchImpl } = stubFetch(answering(ANSWER));

    const constraints = await new JevInterpreter({ apiKey: KEY, fetchImpl }).interpret(
      'Um depósito escuro nos fundos, com prateleiras e uma escada.',
    );

    expect(constraints).toEqual({
      place: { building: 'tavern', room: 'storeroom' },
      sizeHint: 'small',
      light: 'dark',
      condition: 'disordered',
      clutter: 0.6,
      // The `furnishing` score of 1.5 on a four-level scale, and nothing to do
      // with the `condition` of 2 the same answer carries. Before the two were
      // split, this line read 0.6 as well.
      furnishing: 0.5,
      features: ['stairs', 'shelving'],
      // Every noul at or under 0.05, in vocabulary order rather than in the
      // order they arrived. `pillars` at 0.12 and `alcove` at 0.07 are in
      // neither list, which is the band this answer never mentioned — and
      // `bed` sits exactly on 0.05, which the reading takes, because the
      // comparison is `<=` for the reason `EXCLUSION_THRESHOLD` gives.
      excluded: ['bar', 'hearth', 'bunks', 'bed', 'weapons', 'tomb'],
      unresolved: [],
    });
  });

  it('reports a refused key as a refused key, on both statuses', async () => {
    for (const status of [401, 403]) {
      const { fetchImpl } = stubFetch(answering('{"error":"unauthorized"}', status));
      const interpreter = new JevInterpreter({ apiKey: KEY, fetchImpl });

      await expect(interpreter.interpret('uma adega')).rejects.toThrow(JevRejectedKeyError);
    }
  });

  it('reports every other bad status as a request that did not get through', async () => {
    // 502 is the proxy saying TypeSafe did not answer; 500 and 429 are it
    // saying something else went wrong. One thing to do about all of them.
    for (const status of [500, 502, 429]) {
      const { fetchImpl } = stubFetch(answering('', status));
      const interpreter = new JevInterpreter({ apiKey: KEY, fetchImpl });

      await expect(interpreter.interpret('uma adega')).rejects.toThrow(JevUnavailableError);
    }
  });

  it('reports a dead connection as the same thing, keeping the cause', async () => {
    const cause = new TypeError('fetch failed');
    const interpreter = new JevInterpreter({ apiKey: KEY, fetchImpl: failingFetch(cause) });

    await expect(interpreter.interpret('uma adega')).rejects.toThrow(JevUnavailableError);
    await expect(interpreter.interpret('uma adega')).rejects.toMatchObject({ cause });
  });

  it('reports a success that is not JSON as an answer it cannot read', async () => {
    // What a gateway in front of the proxy answers with when it is the one
    // that is broken: HTTP 200 and a page of HTML.
    const { fetchImpl } = stubFetch(answering('<!doctype html><title>502</title>'));
    const interpreter = new JevInterpreter({ apiKey: KEY, fetchImpl });

    await expect(interpreter.interpret('uma adega')).rejects.toThrow(JevUnusableAnswerError);
  });

  it('reports a JSON body that is not a set of answers as the same', async () => {
    const { fetchImpl } = stubFetch(answering('{"model":"jev-1.13.0"}'));
    const interpreter = new JevInterpreter({ apiKey: KEY, fetchImpl });

    await expect(interpreter.interpret('uma adega')).rejects.toThrow(JevUnusableAnswerError);
  });

  it('does not ask for a room when the first answer is malformed', async () => {
    const { fetchImpl, calls } = stubFetch(answering('{"answers":{"building":{"type":"choice","choice":"forge","confidence":0.9}}}'));
    await expect(new JevInterpreter({ apiKey: KEY, fetchImpl }).interpret('uma ferraria')).rejects.toThrow(JevUnusableAnswerError);
    expect(calls).toHaveLength(1);
  });

  it('rejects a room choice outside the selected building', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(calls === 1 ? ANSWER : '{"answers":{"room":{"type":"choice","choice":"crypt","confidence":0.9}}}');
    };
    await expect(new JevInterpreter({ apiKey: KEY, fetchImpl }).interpret('uma cripta')).rejects.toThrow(JevUnusableAnswerError);
    expect(calls).toBe(2);
  });

  it('raises every failure as an InterpreterError, so the interface can catch one type', async () => {
    const failures = [
      new JevInterpreter({ apiKey: '', fetchImpl: failingFetch(new Error('unused')) }),
      new JevInterpreter({ apiKey: KEY, fetchImpl: failingFetch(new Error('down')) }),
      new JevInterpreter({ apiKey: KEY, fetchImpl: stubFetch(answering('nope')).fetchImpl }),
    ];

    for (const interpreter of failures) {
      await expect(interpreter.interpret('uma adega')).rejects.toBeInstanceOf(InterpreterError);
    }
  });
});

describe('the default seam', () => {
  it('defaults to the proxy on this origin, and is never called here', () => {
    // Built, not used: the point is that constructing one reaches nothing.
    const interpreter = new JevInterpreter({ apiKey: KEY });

    expect(interpreter).toBeInstanceOf(JevInterpreter);
    expect(JEV_PROXY_ENDPOINT.startsWith('/')).toBe(true);
  });
});
