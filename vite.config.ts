import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import { fetchJev, relayUnavailable } from './api/jev.ts';

/**
 * `/api/jev` during `npm run dev`.
 *
 * The route is a serverless function in production and nothing at all here, so
 * without this the page's Jev engine gets Vite's HTML fallback instead of an
 * answer. `server.proxy` was the obvious reach and is the wrong tool: it can
 * forward bytes to `api.typesafe.ai`, but it cannot turn the page's key header
 * into a bearer token, cannot refuse a missing key before spending a call, and
 * cannot report an unreachable API as the 502 the contract promises. Wiring it
 * that way would mean development exercises a second implementation of the
 * contract and production exercises the first, which is precisely the
 * arrangement that lets one of them be wrong unnoticed. So this runs the
 * handler that ships.
 *
 * Running it is not enough on its own: Vite answers `OPTIONS` with its own
 * `cors` middleware before this one is consulted, so the preflight — the one
 * clause of the contract this route exists to provide, since the live API
 * answers `OPTIONS` with a 400 and no `allow-origin` — was the single clause
 * development never exercised. `corsHeaders()` could have been wrong and
 * `npm run dev` would have gone on working. `server.cors` is off below for
 * that reason, and the handler answers every method on this route.
 */
function jevProxy(): Plugin {
  return {
    name: 'gridsmith:jev-proxy',
    configureServer(server) {
      // A `configureServer` hook runs after Vite has already installed the
      // middlewares it builds the server with — `cors` among them, which is
      // why it is turned off above — and before the ones it installs last.
      // The SPA fallback is one of those, so it never gets a chance to answer
      // this route with the page.
      server.middlewares.use('/api/jev', (req: IncomingMessage, res: ServerResponse) => {
        void relay(req, res);
      });
    },
  };
}

/** Node's request and response objects on the outside, the Web standard handler on the inside. */
async function relay(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const method = req.method ?? 'POST';
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const carriesBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

    const response = await fetchJev(
      new Request('http://localhost/api/jev', {
        method,
        headers,
        body: carriesBody ? Buffer.concat(chunks) : undefined,
      }),
    );

    await write(res, response);
  } catch {
    // Nothing is logged, here least of all: the request that failed is the one
    // holding the key. The binding is omitted so there is nothing to log.
    //
    // Reachable without anything going wrong upstream: `new Request()` throws
    // on a `TRACE`, and a `TRACE` arrives here intact. Measured, because the
    // obvious neighbours turn out not to arrive at all — Node's HTTP parser
    // answers `TRACK` with a 400 of its own before any middleware runs, and
    // treats `CONNECT` as a tunnel, so it never becomes a request.
    //
    // The answer comes from the handler's own module so that it carries the
    // CORS headers and the body every other answer on this route carries — a
    // bare status code reaches the page as a network error, not as a 502.
    if (res.headersSent) {
      res.end();
      return;
    }
    await write(res, relayUnavailable());
  }
}

/** One `Response` out through Node's response object. */
async function write(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export default defineConfig({
  plugins: [jevProxy()],
  server: {
    // Off so that `/api/jev` gets its preflight from the handler that ships
    // rather than from Vite's `cors` middleware, which answers `OPTIONS` with
    // `GET,HEAD,PUT,PATCH,POST,DELETE` and the request's own origin — neither
    // of which is what this contract promises. The page is served from this
    // same server, so nothing here needs CORS of Vite's own.
    cors: false,
  },
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
  },
});
