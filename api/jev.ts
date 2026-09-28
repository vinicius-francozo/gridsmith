/**
 * The one piece of server this project has, and the only reason it exists.
 *
 * Everything else here runs in the browser with no backend at all, which is a
 * decision, not an accident. The TypeSafe API takes that option away: measured
 * against the live service, a `POST` carrying an `Origin` comes back 200
 * **without** `access-control-allow-origin`, and the `OPTIONS` preflight comes
 * back 400 equally without it. The API does send `allow-methods`,
 * `allow-headers` and `allow-credentials`, but a browser blocks on the missing
 * `allow-origin` regardless. Anthropic publishes an opt-in header for exactly
 * this (`anthropic-dangerous-direct-browser-access`, which is how the Claude
 * engine reaches the network from the page today); TypeSafe has no documented
 * equivalent. So the page cannot call it, and this relay stands in the middle.
 *
 * It is deliberately stupid. It does not build the question, does not read the
 * answer, and does not know a single word of this project's vocabulary — the
 * interpreter does all of that. The body goes up exactly as it arrived and the
 * answer comes back exactly as it was given. The moment this file starts
 * looking inside either one, it has stopped being a relay.
 *
 * **The key passes through and is never kept.** It is the user's own secret,
 * pasted into a field that is `password` and carries no `name` so that nothing
 * can serialise it (`src/ui/mount.ts`), and blanked out of anything the page is
 * about to show or store (`redactKeys` in `src/ui/messages.ts`). This file
 * inherits that whole posture: it never stores, caches or counts the key, and
 * there is not one `console.*` call in it — not on the happy path and, more to
 * the point, not on any failure path, which is where a credential usually
 * escapes. Every message it writes itself is a fixed string; nothing from the
 * request is ever interpolated into one.
 *
 * The signature is the Web standard `Request` in, `Response` out, because that
 * is the shape both candidate hosts speak: Vercel invokes the default export
 * with a `Request`, and a Cloudflare Worker entry is `export default { fetch:
 * handleJevRequest }` over the same function. Nothing here touches a
 * platform-specific request or response object, and nothing here is imported
 * from a dependency: the runtime's own `fetch` does the work.
 */

/** Where the question actually goes. */
export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

/**
 * The header the page hands its key over in.
 *
 * Not `Authorization`, so that a key can never be mistaken for one this
 * deployment owns, and not a query parameter, because a URL is the one place a
 * secret is guaranteed to be written down by somebody else's access log.
 */
export const KEY_HEADER = 'x-typesafe-key';

/**
 * How long to wait before calling it silence.
 *
 * "Did not answer" has to include "never answered". Without a deadline a hung
 * upstream becomes whatever timeout the host happens to enforce — a 504 from
 * the platform rather than the 502 this contract promises.
 */
export const UPSTREAM_TIMEOUT_MS = 30_000;

export type JevProxyOptions = {
  /** Test seam: stands in for `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Test seam: stands in for `TYPESAFE_ENDPOINT`. */
  readonly upstream?: string;
  /** Test seam: stands in for `UPSTREAM_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
};

/**
 * Open CORS, on every answer this file gives.
 *
 * `*` rather than a named origin, and no `allow-credentials`: the key travels
 * as a header the page sets explicitly, never as a cookie, so there is no
 * ambient credential for a browser to attach and nothing for a wildcard to
 * widen. A custom request header makes this route non-simple, so the preflight
 * below is not optional.
 */
function corsHeaders(): Headers {
  return new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': `content-type, ${KEY_HEADER}`,
    'access-control-max-age': '86400',
  });
}

/**
 * The statuses HTTP defines as carrying no body.
 *
 * `new Response(body, { status: 204 })` throws rather than ignoring the body,
 * so rebuilding an upstream answer without checking this would turn an
 * ordinary status into a crash — and a crash is a 500 from the host, which is
 * a status this contract never promised anybody.
 */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

/**
 * A refusal this file wrote itself.
 *
 * `message` is always a literal from this module. Nothing read off the request
 * — no header, no body, no caught error — is ever passed in here, because a
 * message that echoes the request is the shape a leaked key arrives in.
 */
function refuse(status: number, message: string): Response {
  const headers = corsHeaders();
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

/**
 * Relay one call to the System One endpoint.
 *
 * `401`/`403` are TypeSafe's own verdict on the key, passed straight back;
 * `502` means TypeSafe never gave a verdict at all.
 */
export async function handleJevRequest(request: Request, options: JevProxyOptions = {}): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return refuse(405, 'This route only answers POST.');
  }

  // No trimming: a `Headers` value arrives with leading and trailing whitespace
  // already stripped, so a key pasted with a stray newline is clean by here and
  // a header of nothing but spaces reads back as the empty string. A `.trim()`
  // on this line looks prudent and is unreachable — no test can kill it, which
  // is the tell.
  const key = request.headers.get(KEY_HEADER) ?? '';
  if (key === '') {
    // Refused here rather than upstream: an empty key travels as an empty
    // `Bearer` and comes back a round trip later as a 401, which the page
    // reads as "the key you pasted is wrong" — told to somebody who pasted
    // nothing.
    return refuse(401, `No key was supplied. Send it as the ${KEY_HEADER} header.`);
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    // The binding is omitted on every `catch` in this file. A caught error is
    // the easiest thing in the world to put in a message or a log, and the
    // request it came from is holding the key.
    return refuse(400, 'The request body could not be read.');
  }

  const send = options.fetchImpl ?? globalThis.fetch;
  let upstream: Response;
  try {
    upstream = await send(options.upstream ?? TYPESAFE_ENDPOINT, {
      method: 'POST',
      // Exactly two headers go up. Whatever else the page sent — cookies, an
      // origin, a referer — is this deployment's business and not TypeSafe's.
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return refuse(502, 'The TypeSafe API did not answer.');
  }

  let answer: string;
  try {
    answer = await upstream.text();
  } catch {
    // The status line arrived and the body did not. Still silence, as far as
    // anything downstream is concerned.
    return refuse(502, 'The TypeSafe API did not answer.');
  }

  // The answer is rebuilt rather than forwarded whole, so that only the status,
  // the bytes and the content type cross over. An upstream `set-cookie`, or its
  // own CORS headers, would otherwise ride along into a response this file is
  // supposed to be the sole author of.
  const headers = corsHeaders();
  const contentType = upstream.headers.get('content-type');
  if (contentType !== null) {
    headers.set('content-type', contentType);
  }
  const relayed = NULL_BODY_STATUSES.has(upstream.status) ? null : answer;
  return new Response(relayed, { status: upstream.status, headers });
}

export default handleJevRequest;
