import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

import handleJevRequest from './api/jev.ts';

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
 */
function jevProxy(): Plugin {
  return {
    name: 'gridsmith:jev-proxy',
    configureServer(server) {
      // Installed ahead of Vite's own middlewares, so the SPA fallback never
      // gets a chance to answer this route with the page.
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

    const response = await handleJevRequest(
      new Request('http://localhost/api/jev', {
        method,
        headers,
        body: carriesBody ? Buffer.concat(chunks) : undefined,
      }),
    );

    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    // Nothing is logged, here least of all: the request that failed is the one
    // holding the key. The binding is omitted so there is nothing to log.
    res.statusCode = 502;
    res.end();
  }
}

export default defineConfig({
  plugins: [jevProxy()],
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    environment: 'node',
  },
});
