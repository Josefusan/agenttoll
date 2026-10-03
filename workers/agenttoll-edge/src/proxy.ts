// Forward to the origin with header hygiene (RFC 9110 §7.6.1). Mirrors
// crates/agenttoll-gateway/src/proxy.rs. Human and free traffic streams straight through.

import { headers as x402Headers } from './x402';

/** Hop-by-hop headers never cross a proxy. */
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

/** Removes hop-by-hop headers, including any named in `Connection`. */
export function stripHopByHop(h: Headers): void {
  const listed = (h.get('connection') ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  for (const name of listed) {
    try {
      h.delete(name);
    } catch {
      // not a valid header name: nothing to strip
    }
  }
  for (const name of HOP_BY_HOP) h.delete(name);
}

export interface ForwardOptions {
  origin: string;
  /** The gateway option `preserve_host`. A Worker cannot set `Host` on an outbound fetch, so
   * the origin's own host is always sent; the client's goes in `X-Forwarded-Host`. */
  preserveHost: boolean;
  /** Client IP (`cf-connecting-ip`), appended to `X-Forwarded-For`. */
  peer: string | null;
  /** Scheme the client used, for `X-Forwarded-Proto` when the client did not send one. */
  proto: string;
  /** Client headers not to forward, e.g. `content-length` once a body was rewritten, or
   * `accept-encoding` when the response must be readable before settling. */
  dropHeaders?: string[];
}

let warnedPreserveHost = false;

/**
 * Headers sent to the origin: hop-by-hop and payment headers removed, client-supplied
 * `x-agenttoll-*` dropped (only the gateway may assert payment), `X-Forwarded-*` set.
 */
export function originRequestHeaders(incoming: Headers, opts: ForwardOptions): Headers {
  const h = new Headers(incoming);
  stripHopByHop(h);
  h.delete(x402Headers.PAYMENT_SIGNATURE);
  h.delete(x402Headers.X_PAYMENT);
  for (const name of [...h.keys()]) {
    if (name.startsWith('x-agenttoll-')) h.delete(name);
  }
  for (const name of opts.dropHeaders ?? []) h.delete(name);

  const clientHost = incoming.get('host');
  // Workers derive Host from the URL; a client Host cannot be preserved at the edge.
  h.delete('host');
  if (opts.preserveHost && !warnedPreserveHost) {
    warnedPreserveHost = true;
    console.warn('preserve_host is set but a Worker cannot override Host; sending X-Forwarded-Host only');
  }
  if (clientHost !== null) h.set('x-forwarded-host', clientHost);
  if (!h.has('x-forwarded-proto')) h.set('x-forwarded-proto', opts.proto);
  if (opts.peer) {
    const chain = incoming.get('x-forwarded-for');
    h.set('x-forwarded-for', chain ? `${chain}, ${opts.peer}` : opts.peer);
  }
  return h;
}

/**
 * Forwards the request to the origin and streams the response back unchanged (status,
 * cookies, redirects), minus hop-by-hop headers. `gatewayHeaders` (e.g. `x-agenttoll-paid`)
 * are added after hygiene, so only the gateway can set them.
 */
export async function forward(
  request: Request,
  rawPathAndQuery: string,
  body: BodyInit | null,
  opts: ForwardOptions,
  gatewayHeaders: Record<string, string> = {},
): Promise<Response> {
  const url = `${opts.origin.replace(/\/+$/, '')}${rawPathAndQuery}`;
  const outgoing = originRequestHeaders(request.headers, opts);
  for (const [name, value] of Object.entries(gatewayHeaders)) outgoing.set(name, value);

  const method = request.method;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method,
      headers: outgoing,
      body: method === 'GET' || method === 'HEAD' ? null : body,
      redirect: 'manual',
    });
  } catch (e) {
    console.warn('origin unreachable', String(e));
    return new Response('origin unreachable', {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const responseHeaders = new Headers(upstream.headers);
  stripHopByHop(responseHeaders);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
