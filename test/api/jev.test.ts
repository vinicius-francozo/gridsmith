import { afterEach, describe, expect, it, vi } from 'vitest';

import jevEntry, {
  handleJevRequest,
  KEY_HEADER,
  relayUnavailable,
  TYPESAFE_ENDPOINT,
  UPSTREAM_TIMEOUT_MS,
  worker,
} from '../../api/jev';

/**
 * No test here reaches the network. Every call goes through a `fetchImpl` the
 * test wrote, and the one constant that names the real endpoint is asserted
 * against, never called.
 */

/**
 * The key, as distinctive as possible on purpose.
 *
 * It is grepped for across every console argument at the bottom of this file,
 * so it has to be a string that could not plausibly appear for any other
 * reason.
 */
const KEY = 'ts-live-key-7f3a9c-DO-NOT-LEAK';

/** A System One request body. The proxy has no idea what any of it means. */
const BODY = JSON.stringify({
  input: 'uma ferraria com bigorna e fornalha acesa',
  questions: [{ kind: 'choice', id: 'place', options: ['tavern_hall', 'tavern_storeroom'] }],
});

type Call = { url: string; init: RequestInit };

/** A `fetch` that records what it was asked and answers however the test says. */
function stubFetch(answer: (call: Call) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(answer({ url, init }));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** A `fetch` that fails the way a dead host does. */
function deadUpstream(): typeof fetch {
  return (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
}

/** A `fetch` whose answer arrives with a status line and no body behind it. */
function truncatedUpstream(): typeof fetch {
  return stubFetch(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('connection reset'));
          },
        }),
      ),
  ).fetchImpl;
}

/**
 * An answer carrying a status the `Response` constructor refuses.
 *
 * It cannot be built as a real `Response` — the constructor is the thing being
 * guarded against. `fetch` has no such limit and hands these straight through,
 * which is how a `999` from a CDN in front of the API arrives.
 */
function impossibleStatus(status: number, onBodyRead: () => void = () => {}): Response {
  return {
    status,
    headers: new Headers({ 'content-type': 'text/html' }),
    text: () => {
      onBodyRead();
      return Promise.resolve('<html>Attention Required</html>');
    },
  } as unknown as Response;
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The request the page makes, with the key in place unless a test removes it. */
function pageRequest(overrides: { body?: string; headers?: Record<string, string>; method?: string } = {}): Request {
  const headers = overrides.headers ?? { [KEY_HEADER]: KEY, 'content-type': 'application/json' };
  const method = overrides.method ?? 'POST';
  return new Request('https://gridsmith.example/api/jev', {
    method,
    headers,
    body: method === 'POST' ? (overrides.body ?? BODY) : undefined,
  });
}

/** The page's request with a body that dies halfway through arriving. */
function unreadableRequest(): Request {
  return new Request('https://gridsmith.example/api/jev', {
    method: 'POST',
    headers: { [KEY_HEADER]: KEY, 'content-type': 'application/json' },
    body: new ReadableStream({
      start(controller) {
        controller.error(new Error('the upload was cut off'));
      },
    }),
    duplex: 'half',
  } as RequestInit);
}

function headersOf(init: RequestInit): Headers {
  return new Headers(init.headers as HeadersInit);
}

describe('relaying a call to the System One endpoint', () => {
  it('sends the body up exactly as it arrived', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, { answers: [] }));

    await handleJevRequest(pageRequest(), { fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0].init.body).toBe(BODY);
  });

  it('gives the answer back exactly as it was given', async () => {
    const answer = { answers: [{ id: 'place', value: 'tavern_hall', confidence: 0.98 }] };
    const { fetchImpl } = stubFetch(() => jsonResponse(200, answer));

    const response = await handleJevRequest(pageRequest(), { fetchImpl });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify(answer));
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('asks the endpoint the contract names', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    await handleJevRequest(pageRequest(), { fetchImpl });

    expect(calls[0].url).toBe(TYPESAFE_ENDPOINT);
    expect(TYPESAFE_ENDPOINT).toBe('https://api.typesafe.ai/v1/systemone');
    expect(calls[0].init.method).toBe('POST');
  });

  it("turns the page's key header into the bearer token the API wants", async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    await handleJevRequest(pageRequest(), { fetchImpl });

    expect(headersOf(calls[0].init).get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it('survives a key pasted with whitespace around it', async () => {
    // The handler does no trimming of its own, and deliberately: a `Headers`
    // value arrives with leading and trailing whitespace already stripped. This
    // pins that platform guarantee, because the empty-key refusal below leans
    // on it.
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    await handleJevRequest(pageRequest({ headers: { [KEY_HEADER]: `  ${KEY}\n` } }), { fetchImpl });

    expect(headersOf(calls[0].init).get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it('sends nothing up but the bearer token and the content type', async () => {
    // Whatever else the page attached — an origin, a referer, a cookie this
    // deployment set — belongs to this deployment and not to TypeSafe.
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    await handleJevRequest(
      pageRequest({
        headers: {
          [KEY_HEADER]: KEY,
          'content-type': 'application/json',
          cookie: 'session=abc',
          origin: 'https://gridsmith.example',
        },
      }),
      { fetchImpl },
    );

    expect([...headersOf(calls[0].init).keys()].sort()).toEqual(['authorization', 'content-type']);
  });

  it('does not pass the page\'s own key header on to the API', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    await handleJevRequest(pageRequest(), { fetchImpl });

    expect(headersOf(calls[0].init).get(KEY_HEADER)).toBeNull();
  });

  it('carries a deadline, so "did not answer" can include "never answered"', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    await handleJevRequest(pageRequest(), { fetchImpl });

    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(UPSTREAM_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('relays a body it cannot make sense of, because reading it is not its job', async () => {
    // The relay knows nothing about the System One vocabulary. A body that is
    // not even JSON goes up untouched and TypeSafe's verdict on it comes back
    // untouched — rather than this file inventing an opinion it has no basis for.
    const malformed = '{"input": "uma ferraria", "questions": [';
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(400, { error: 'malformed request body' }));

    const response = await handleJevRequest(pageRequest({ body: malformed }), { fetchImpl });

    expect(calls[0].init.body).toBe(malformed);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(JSON.stringify({ error: 'malformed request body' }));
  });

  it('survives an answer defined to have no body', async () => {
    // `new Response(body, { status: 204 })` throws rather than ignoring the
    // body, and a throw here is a 500 from the host — a status this contract
    // never promised anyone.
    const { fetchImpl } = stubFetch(() => new Response(null, { status: 204 }));

    const response = await handleJevRequest(pageRequest(), { fetchImpl });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('reports a status HTTP does not define as a 502, not as a crash', async () => {
    // `fetch` surfaces whatever the wire said, and a CDN or a WAF in front of
    // the API is allowed to say `999` — Cloudflare does. `new Response(body,
    // { status: 999 })` throws, and an unhandled throw here is a 500 from the
    // host with no CORS header on it, which the page can only report as an
    // opaque network error.
    for (const status of [999, 600, 199, 101]) {
      const { fetchImpl } = stubFetch(() => impossibleStatus(status));

      const response = await handleJevRequest(pageRequest(), { fetchImpl });

      expect(response.status).toBe(502);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    }
  });

  it('checks the status before it spends the body', async () => {
    // The refusal is right wherever the check sits, but only one place also
    // declines to pull a body it is about to throw away. Pinned, so that
    // moving the check below the read is a test failure rather than a quiet
    // regression nobody sees.
    let bodyReads = 0;
    const { fetchImpl } = stubFetch(() =>
      impossibleStatus(999, () => {
        bodyReads += 1;
      }),
    );

    const response = await handleJevRequest(pageRequest(), { fetchImpl });

    expect(response.status).toBe(502);
    expect(bodyReads).toBe(0);
  });

  it('survives the other answers defined to have no body', async () => {
    // `204` is the one that turns up in practice and is covered above. `205`
    // and `304` are on the same list in the spec and throw the same way, so
    // they are asserted rather than carried on trust.
    for (const status of [205, 304]) {
      const { fetchImpl } = stubFetch(() => new Response(null, { status }));

      const response = await handleJevRequest(pageRequest(), { fetchImpl });

      expect(response.status).toBe(status);
      expect(await response.text()).toBe('');
    }
  });

  it('still relays the last status HTTP does define', async () => {
    // The other side of the range, so the guard above cannot quietly grow into
    // a refusal of answers the API is entitled to give.
    const { fetchImpl } = stubFetch(() => new Response('{}', { status: 599 }));

    const response = await handleJevRequest(pageRequest(), { fetchImpl });

    expect(response.status).toBe(599);
    expect(await response.text()).toBe('{}');
  });
});

describe('answering the key', () => {
  it('passes a rejected key straight back as a 401, with what the API said', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse(401, { error: 'invalid api key' }));

    const response = await handleJevRequest(pageRequest(), { fetchImpl });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe(JSON.stringify({ error: 'invalid api key' }));
  });

  it('passes a forbidden key straight back as a 403', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse(403, { error: 'quota exhausted' }));

    const response = await handleJevRequest(pageRequest(), { fetchImpl });

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(JSON.stringify({ error: 'quota exhausted' }));
  });

  it('refuses a missing key itself, without spending a call', async () => {
    // An empty key would travel as an empty `Bearer` and come back a round
    // trip later as a 401, which the page reads as "the key you pasted is
    // wrong" — said to somebody who pasted nothing.
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    const response = await handleJevRequest(pageRequest({ headers: { 'content-type': 'application/json' } }), {
      fetchImpl,
    });

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('treats a key of only whitespace as no key', async () => {
    // Same guarantee from the other side: the header normalises to the empty
    // string before the handler ever looks at it.
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    const response = await handleJevRequest(pageRequest({ headers: { [KEY_HEADER]: '   ' } }), { fetchImpl });

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('names the header to use, so the page can be fixed without guesswork', async () => {
    const { fetchImpl } = stubFetch(() => jsonResponse(200, {}));

    const response = await handleJevRequest(pageRequest({ headers: {} }), { fetchImpl });

    expect(await response.text()).toContain(KEY_HEADER);
  });
});

describe('answering silence', () => {
  it('reports an unreachable API as a 502', async () => {
    const response = await handleJevRequest(pageRequest(), { fetchImpl: deadUpstream() });

    expect(response.status).toBe(502);
  });

  it('reports an answer that stops halfway through its body as a 502', async () => {
    // The status line arrived and the bytes did not. Downstream, that is still
    // silence.
    const response = await handleJevRequest(pageRequest(), { fetchImpl: truncatedUpstream() });

    expect(response.status).toBe(502);
  });

  it('reports a deadline that ran out as a 502, not as a crash', async () => {
    // The signal is the only thing that makes "never answered" reachable, so
    // it is exercised through a `fetch` that honours it rather than asserted
    // to be present and left inert.
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'TimeoutError'));
        });
      })) as unknown as typeof fetch;

    const response = await handleJevRequest(pageRequest(), { fetchImpl, timeoutMs: 5 });

    expect(response.status).toBe(502);
  });

  it('reports a request whose own body cannot be read as a 400', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    const response = await handleJevRequest(unreadableRequest(), { fetchImpl });

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('answering a browser', () => {
  it('answers the preflight, which the TypeSafe API does not', async () => {
    // Measured against the live service: `OPTIONS` comes back 400 with no
    // `access-control-allow-origin`. The key travels in a custom header, which
    // makes this route non-simple, so without this answer the page never gets
    // to make the POST at all.
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    const response = await handleJevRequest(pageRequest({ method: 'OPTIONS' }), { fetchImpl });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain(KEY_HEADER);
    expect(calls).toHaveLength(0);
  });

  it('never offers credentials alongside the wildcard origin', async () => {
    // A browser refuses `*` together with credentials anyway, and there is no
    // ambient credential to attach: the key is a header the page sets by hand,
    // never a cookie.
    const { fetchImpl } = stubFetch(() => jsonResponse(200, {}));

    const response = await handleJevRequest(pageRequest(), { fetchImpl });

    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('refuses a method that is not POST, without spending a call', async () => {
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    const response = await handleJevRequest(pageRequest({ method: 'GET' }), { fetchImpl });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST, OPTIONS');
    expect(calls).toHaveLength(0);
  });

  it('opens CORS on every answer it gives, failures included', async () => {
    // A failure a browser will not hand to the page is a failure the page
    // reports as a network error, which sends the person looking in the wrong
    // place entirely.
    const { fetchImpl } = stubFetch(() => jsonResponse(401, { error: 'invalid api key' }));
    const answers = [
      await handleJevRequest(pageRequest(), { fetchImpl }),
      await handleJevRequest(pageRequest({ headers: {} }), { fetchImpl }),
      await handleJevRequest(pageRequest({ method: 'GET' }), { fetchImpl }),
      await handleJevRequest(pageRequest({ method: 'OPTIONS' }), { fetchImpl }),
      await handleJevRequest(pageRequest(), { fetchImpl: deadUpstream() }),
    ];

    for (const answer of answers) {
      expect(answer.headers.get('access-control-allow-origin')).toBe('*');
    }
  });
});

describe('never writing the key down', () => {
  // The key is the user's own secret. The page puts it in a `password` field
  // with no `name` so nothing can serialise it, and blanks it out of anything
  // about to be shown or stored. This file is the one place it leaves the
  // browser, so the same rule has to hold here — and the failure paths are
  // where a credential usually escapes, so they are walked one by one rather
  // than assumed to behave like the happy path.

  const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'] as const;

  function watchConsole(): { calls: unknown[] } {
    const calls: unknown[] = [];
    for (const method of METHODS) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        calls.push(...args, method);
      });
    }
    return { calls };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Every path through the handler, each one carrying the key. */
  async function everyPath(): Promise<Response[]> {
    const ok = stubFetch(() => jsonResponse(200, { answers: [] })).fetchImpl;
    const rejected = stubFetch(() => jsonResponse(401, { error: 'invalid api key' })).fetchImpl;
    const forbidden = stubFetch(() => jsonResponse(403, { error: 'quota exhausted' })).fetchImpl;
    const malformed = stubFetch(() => jsonResponse(400, { error: 'malformed request body' })).fetchImpl;

    return [
      await handleJevRequest(pageRequest(), { fetchImpl: ok }),
      await handleJevRequest(pageRequest(), { fetchImpl: rejected }),
      await handleJevRequest(pageRequest(), { fetchImpl: forbidden }),
      await handleJevRequest(pageRequest({ body: '{"broken": ' }), { fetchImpl: malformed }),
      await handleJevRequest(pageRequest(), { fetchImpl: deadUpstream() }),
      // The upstream body failing to arrive is its own refusal, written with
      // the key in scope, and it is not the same line as the request body
      // failing to arrive below.
      await handleJevRequest(pageRequest(), { fetchImpl: truncatedUpstream() }),
      await handleJevRequest(pageRequest(), { fetchImpl: stubFetch(() => impossibleStatus(999)).fetchImpl }),
      await handleJevRequest(unreadableRequest(), { fetchImpl: ok }),
      await handleJevRequest(pageRequest({ headers: {} }), { fetchImpl: ok }),
      await handleJevRequest(pageRequest({ method: 'GET' }), { fetchImpl: ok }),
      await handleJevRequest(pageRequest({ method: 'OPTIONS' }), { fetchImpl: ok }),
    ];
  }

  it('writes nothing to the console at all, on any path', async () => {
    const watcher = watchConsole();

    await everyPath();

    expect(watcher.calls).toEqual([]);
  });

  it('never puts the key in a console argument, on any path', async () => {
    // Asserted separately from the count above so that the day somebody adds a
    // deliberate, harmless log line, this test still says whether the key went
    // with it.
    const watcher = watchConsole();

    await everyPath();

    const written = watcher.calls.map((argument) => JSON.stringify(argument) ?? String(argument)).join(' ');
    expect(written).not.toContain(KEY);
  });

  it('never puts the key in a message it wrote itself, on any path', async () => {
    // The other half of the same rule: a 401 or a 502 that quotes the request
    // back is the same defect as a log line that does.
    const bodies = await Promise.all((await everyPath()).map((response) => response.text()));

    for (const body of bodies) {
      expect(body).not.toContain(KEY);
      // Not a prefix of it either. A truncated secret is still a secret.
      expect(body).not.toContain(KEY.slice(0, 8));
    }
  });

  it('never puts the key in a response header, on any path', async () => {
    for (const response of await everyPath()) {
      for (const [, value] of response.headers) {
        expect(value).not.toContain(KEY.slice(0, 8));
      }
    }
  });

  it('never puts the key in the URL it calls', async () => {
    // A URL is the one place a secret is guaranteed to be written down by
    // somebody else's access log.
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    await handleJevRequest(pageRequest(), { fetchImpl });

    expect(calls[0].url).not.toContain(KEY.slice(0, 8));
  });
});

describe('the entry a host calls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops everything after the request, so a host cannot redirect the relay', async () => {
    // A Worker is invoked as `fetch(request, env, ctx)`, and the handler's
    // second parameter is the test seam. If a host could reach it, a binding
    // or a var named `upstream` would become the address this relay sends the
    // user's key to as a bearer token — the whole exfiltration in one line of
    // configuration, with no change to any code.
    const hostile = {
      upstream: 'https://attacker.example/collect',
      fetchImpl: deadUpstream(),
      timeoutMs: 1,
    };

    for (const entry of [jevEntry.fetch, worker.fetch]) {
      const asked: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(((url: string) => {
        asked.push(String(url));
        return Promise.resolve(jsonResponse(200, { answers: [] }));
      }) as unknown as typeof fetch);

      const call = entry as unknown as (request: Request, env: unknown, ctx: unknown) => Promise<Response>;
      const response = await call(pageRequest(), hostile, {});

      expect(asked).toEqual([TYPESAFE_ENDPOINT]);
      expect(response.status).toBe(200);
      vi.restoreAllMocks();
    }
  });

  it('keeps the seam itself, because the tests are inside the module', async () => {
    // Said out loud so that closing the hole above is not read as an argument
    // for closing the seam: `handleJevRequest` is still the tested surface,
    // and it is the export no host is given.
    const { fetchImpl, calls } = stubFetch(() => jsonResponse(200, {}));

    await handleJevRequest(pageRequest(), { fetchImpl, upstream: 'https://elsewhere.example/v1' });

    expect(calls[0].url).toBe('https://elsewhere.example/v1');
  });
});

describe('the shape a host calls', () => {
  it('hands Vercel an object with fetch, never a bare function', () => {
    // On Vercel's Node.js runtime a default export that is itself a function
    // is the legacy `(request, response)` handler, called with Node's own
    // objects instead of a `Request`. Every behaviour test above calls the
    // handler with a `Request` directly, so all of them stay green under that
    // export while the deployed relay fails on its first call — which is what
    // shipped here until the first deploy was prepared. This is the one
    // assertion that can fail for the real reason.
    expect(typeof jevEntry).toBe('object');
    expect(typeof jevEntry.fetch).toBe('function');
    expect(jevEntry).toBe(worker);
  });
});

describe('the answer for a request that never reached the handler', () => {
  it('refuses the way every other answer on this route refuses', async () => {
    // `vite.config.ts` is the only caller, so without this the CORS headers
    // and the body could both be dropped and the suite would not notice — and
    // dropping them is the exact defect this was written to fix. A browser
    // reports a bare status code as a network error, never as a 502.
    const response = relayUnavailable();

    expect(response.status).toBe(502);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(await response.text())).toEqual({ error: expect.any(String) });
  });
});
