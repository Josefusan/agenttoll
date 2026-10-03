// AgentToll edge edition: a Cloudflare Worker that lets humans through free and answers priced
// agent requests with an x402 v2 challenge, then verifies and settles their payments
// (ARCHITECTURE.md §1.1). Same contract as crates/agenttoll-gateway; the detector, pricer,
// path normalizer, MCP inspector, discovery document and price advertising are the Rust core
// compiled to WASM.

import {
  DISCOVERY_PATH,
  challenge,
  discovery,
  gatewayFor,
  jsonrpcError,
  mcpChallenge,
  text,
  type Env,
  type Gateway,
  type Incoming,
  type Verdict,
} from './gateway';
import { extractMcpPayment, isToolsList, singleToolCallId, toolCallIds } from './mcp';
import { handlePaid, readLimited } from './pay';
import { forward } from './proxy';
import { headers as x402Headers, decodeHeader, type PriceTag, type QuoteNetwork } from './x402';

/** MCP POST bodies are buffered for tool-name inspection, up to this size. */
const MCP_BODY_LIMIT = 1024 * 1024;

/** Path and query exactly as the request line carried them (no re-serialization). */
function rawPathAndQuery(url: string): string {
  const schemeEnd = url.indexOf('//');
  const slash = url.indexOf('/', schemeEnd < 0 ? 0 : schemeEnd + 2);
  return slash < 0 ? '/' : url.slice(slash);
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
      return json200(await gw.ledger.all());
    }
    if (method === 'GET' && path === DISCOVERY_PATH) return discovery(gw);

    const isMcp = core.is_mcp_endpoint(path);

    // MCP POST bodies are buffered so the tool name can be priced; everything else streams.
    let body: BodyInit | null = request.body;
    let mcpBody: Uint8Array | undefined;
    let price: PriceTag | undefined;
    if (isMcp && method === 'POST') {
      const bytes = await readLimited(request.body, MCP_BODY_LIMIT);
      if (bytes === undefined) return text(413, 'MCP request body exceeds 1 MiB');
      body = bytes;
      mcpBody = bytes;
      try {
        const priced = core.price_mcp(bytes);
        price = priced === undefined ? undefined : (JSON.parse(priced) as PriceTag);
      } catch (e) {
        return jsonrpcError(400, null, -32700, errorMessage(e));
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
      return chargeRequest(gw, inc, body, charge, verdict, networks, mcpBody, (p) => ctx.waitUntil(p));
    }

    const advertise = mcpBody !== undefined && isToolsList(mcpBody) && gw.mcp?.advertisePrices === true;
    const res = await forward(request, rawPQ, body, {
      origin: gw.origin,
      preserveHost: gw.preserveHost,
      peer: inc.peer,
      proto: inc.proto,
    });
    return advertise ? advertisePrices(gw, res) : res;
  },
} satisfies ExportedHandler<Env>;

function json200(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function chargeRequest(
  gw: Gateway,
  inc: Incoming,
  body: BodyInit | null,
  tag: PriceTag,
  verdict: Verdict,
  networks: QuoteNetwork[],
  mcpBody: Uint8Array | undefined,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  const { request } = inc;
  const mcpCallIds = mcpBody === undefined ? undefined : toolCallIds(mcpBody);
  const bodyPayment = mcpBody === undefined ? undefined : extractMcpPayment(mcpBody);

  // HTTP transport: PAYMENT-SIGNATURE header (KB-X402-01). A second, MCP-native payment in the
  // body is removed so the origin never sees payment material.
  const header = request.headers.get(x402Headers.PAYMENT_SIGNATURE);
  if (header !== null) {
    if (!/^[\x20-\x7e]*$/.test(header)) return text(400, 'PAYMENT-SIGNATURE is not valid ASCII');
    const payload = decodeHeader(header);
    if (payload === undefined) return text(400, 'PAYMENT-SIGNATURE is not base64-encoded JSON');
    return handlePaid(gw, {
      inc,
      body: bodyPayment ? bodyPayment.stripped : body,
      // The body shrank, so the client's Content-Length no longer describes it.
      dropHeaders: bodyPayment ? ['content-length'] : [],
      tag,
      verdict,
      payload,
      transport: { kind: 'http' },
      mcpCallIds,
      networks,
      waitUntil,
    });
  }
  // MCP-native transport: params._meta["x402/payment"] (KB-X402-05). The origin gets the body
  // with the payment removed.
  if (bodyPayment) {
    return handlePaid(gw, {
      inc,
      body: bodyPayment.stripped,
      dropHeaders: ['content-length'],
      tag,
      verdict,
      payload: bodyPayment.payload,
      transport: { kind: 'mcp', id: bodyPayment.id },
      mcpCallIds,
      networks,
      waitUntil,
    });
  }
  if (request.headers.has(x402Headers.X_PAYMENT)) {
    return challenge(gw, networks, inc, tag, verdict, 'x402 v1 X-PAYMENT is not supported; pay with x402 v2 PAYMENT-SIGNATURE');
  }
  if (gw.mcp?.challenge === 'mcp-native' && mcpBody !== undefined) {
    const id = singleToolCallId(mcpBody);
    if (id !== undefined) {
      return mcpChallenge(gw, networks, inc, tag, verdict, 'payment required: retry with params._meta["x402/payment"]', id);
    }
  }
  return challenge(gw, networks, inc, tag, verdict, 'PAYMENT-SIGNATURE header is required');
}

/**
 * Appends each paid tool's price to its `tools/list` description so agents can plan spend
 * (paid-mcp-tools skill, `mcp.advertise_prices`). JSON responses only; anything else passes.
 * The rewrite itself is the core's, so both editions produce the same text.
 */
async function advertisePrices(gw: Gateway, res: Response): Promise<Response> {
  if (!(res.headers.get('content-type') ?? '').startsWith('application/json')) return res;
  const bytes = await readLimited(res.body, MCP_BODY_LIMIT);
  if (bytes === undefined) return text(502, 'MCP response too large');
  const rewritten = gw.core.advertise_prices(bytes);
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(rewritten ?? bytes, { status: res.status, statusText: res.statusText, headers });
}
