// AgentToll edge edition: a Cloudflare Worker that lets humans through free and answers priced
// agent requests with an x402 v2 challenge, then verifies and settles their payments
// (ARCHITECTURE.md §1.1). Same contract as crates/agenttoll-gateway; the detector, pricer,
// path normalizer and MCP inspector are the Rust core compiled to WASM.

import { challenge, gatewayFor, json, text, type Env, type Incoming, type Verdict } from './gateway';
import { handlePaid, readLimited } from './pay';
import { forward } from './proxy';
import { headers as x402Headers, type PriceTag, type QuoteNetwork } from './x402';

/** MCP POST bodies are buffered for tool-name inspection, up to this size. */
const MCP_BODY_LIMIT = 1024 * 1024;

/** Path and query exactly as the request line carried them (no re-serialization). */
function rawPathAndQuery(url: string): string {
  const schemeEnd = url.indexOf('//');
  const slash = url.indexOf('/', schemeEnd < 0 ? 0 : schemeEnd + 2);
  return slash < 0 ? '/' : url.slice(slash);
}

function jsonrpcError(status: number, code: number, message: string): Response {
  return json(status, { jsonrpc: '2.0', id: null, error: { code, message } });
}

const errorMessage = (e: unknown): string => (typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const gw = gatewayFor(env);
    const rawPQ = rawPathAndQuery(request.url);
    const q = rawPQ.indexOf('?');
    const path = q < 0 ? rawPQ : rawPQ.slice(0, q);
    const inc: Incoming = {
      request,
      rawPathAndQuery: rawPQ,
      path,
      peer: request.headers.get('cf-connecting-ip'),
      proto: request.url.startsWith('https:') ? 'https' : 'http',
    };
    const method = request.method;
    const core = gw.core;

    if (env.AGENTTOLL_DEBUG === '1' && method === 'GET' && path === '/.agenttoll/ledger') {
      return json(200, await gw.ledger.all());
    }

    const isMcp = core.is_mcp_endpoint(path);

    // MCP POST bodies are buffered so the tool name can be priced; everything else streams.
    let body: BodyInit | null = request.body;
    let price: PriceTag | undefined;
    if (isMcp && method === 'POST') {
      const bytes = await readLimited(request.body, MCP_BODY_LIMIT);
      if (bytes === undefined) return text(413, 'MCP request body exceeds 1 MiB');
      body = bytes;
      try {
        const priced = core.price_mcp(bytes);
        price = priced === undefined ? undefined : (JSON.parse(priced) as PriceTag);
      } catch (e) {
        return jsonrpcError(400, -32700, errorMessage(e));
      }
    } else if (isMcp) {
      // GET (SSE stream) or DELETE (session end) on the MCP endpoint: nothing to price, and a
      // route catch-all must not charge it (paid-mcp-tools skill).
      price = undefined;
    } else {
      const priced = core.price_route(method, path);
      price = priced === undefined ? undefined : (JSON.parse(priced) as PriceTag);
    }

    const headerPairs = [...request.headers.entries()];
    const verdictJson = core.classify(method, path, JSON.stringify(headerPairs), isMcp);
    const verdict = JSON.parse(verdictJson) as Verdict;
    const charge = price && core.should_charge(verdictJson) ? price : undefined;

    console.log(
      `${method} ${path} verdict=${verdict.reason} agent=${verdict.agent ?? '-'} price=${price?.amount ?? 'free'} charged=${charge !== undefined}`,
    );

    if (charge) {
      let networks: QuoteNetwork[];
      try {
        networks = await gw.quoteNetworks();
      } catch (e) {
        console.error('cannot quote: fee payer lookup failed', String(e));
        return text(502, 'payment facilitator unavailable');
      }
      const payment = request.headers.get(x402Headers.PAYMENT_SIGNATURE);
      if (payment !== null) {
        if (!/^[\x20-\x7e]*$/.test(payment)) return text(400, 'PAYMENT-SIGNATURE is not valid ASCII');
        return handlePaid(gw, {
          inc,
          body,
          tag: charge,
          verdict,
          header: payment,
          networks,
          waitUntil: (p) => ctx.waitUntil(p),
        });
      }
      if (request.headers.has(x402Headers.X_PAYMENT)) {
        return challenge(gw, networks, inc, charge, verdict, 'x402 v1 X-PAYMENT is not supported; pay with x402 v2 PAYMENT-SIGNATURE');
      }
      return challenge(gw, networks, inc, charge, verdict, 'PAYMENT-SIGNATURE header is required');
    }

    return forward(request, rawPQ, body, {
      origin: gw.origin,
      preserveHost: gw.preserveHost,
      peer: inc.peer,
      proto: inc.proto,
    });
  },
} satisfies ExportedHandler<Env>;
