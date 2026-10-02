import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";

import { VERSION } from "./identity.js";
import { PAYMENT_META_KEY, paymentRequiredFromToolResult, settlementFromToolResult } from "./mcpNative.js";
import type { Atomic } from "./money.js";
import {
  assertHttpUrl,
  type Authorized,
  authorizePayment,
  type Body,
  type PayerDeps,
  type Receipt,
  recordOutcome,
  settlementFromHeaders,
  truncateBody,
} from "./payer.js";
import { challengeFromResponse } from "./quote.js";

export interface CallPaidToolArgs {
  serverUrl: string;
  tool: string;
  arguments: Record<string, unknown>;
  maxUsd?: Atomic;
}

export interface CallPaidToolResult {
  server_url: string;
  tool: string;
  paid: boolean;
  /** Which x402 transport the server used: HTTP 402 on the POST, or the MCP-native tool-result challenge. */
  payment_transport?: "http-402" | "mcp-native";
  is_error: boolean;
  content: Body;
  structured_content?: unknown;
  receipt?: Receipt;
  note?: string;
}

interface HttpPayment {
  authorized: Authorized;
  settlement: SettleResponse | undefined;
  rejectedAgain: boolean;
  rejectionReason?: string;
}

/**
 * Calls one tool on a remote MCP server over Streamable HTTP and pays for it within caps, whichever
 * way the server asks: an HTTP 402 on the JSON-RPC POST (an AgentToll gateway in front of any MCP
 * server), or the MCP-native challenge in the tool result (specs/transports-v2/mcp.md).
 */
export async function callPaidTool(deps: PayerDeps, args: CallPaidToolArgs): Promise<CallPaidToolResult> {
  const url = assertHttpUrl(args.serverUrl);
  let httpPayment: HttpPayment | undefined;

  // The transport's fetch: let free JSON-RPC calls through, pay a 402 once, remember the receipt.
  const payingFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const first = await deps.fetch(input, init);
    if (first.status !== 402) return first;
    if (httpPayment) throw new Error("the server asked for payment twice in one tool call; giving up");
    const text = await first.text();
    const pr = challengeFromResponse((n) => first.headers.get(n), text);
    const authorized = await authorizePayment(deps, pr, args.maxUsd);
    const headers = new Headers(init?.headers);
    headers.set("PAYMENT-SIGNATURE", encodePaymentSignatureHeader(authorized.payload));
    const second = await deps.fetch(input, { ...init, headers });
    const settlement = settlementFromHeaders((n) => second.headers.get(n));
    httpPayment = { authorized, settlement, rejectedAgain: second.status === 402 };
    if (second.status === 402) {
      const copy = second.clone();
      try {
        httpPayment.rejectionReason = challengeFromResponse((n) => copy.headers.get(n), await copy.text()).error;
      } catch {
        // leave the reason undefined
      }
      // Surface the rejection ourselves instead of letting the transport throw a generic error.
      const receipt = await recordOutcome(deps, { url: url.href, tool: args.tool, ...httpPayment });
      throw new Error(`unreachable: recordOutcome returned ${JSON.stringify(receipt)} for a rejected payment`);
    }
    return second;
  };

  const client = new Client({ name: "agenttoll-pay-mcp", version: VERSION });
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: payingFetch,
    requestInit: { headers: { ...deps.headers } },
  });

  try {
    await client.connect(transport);
    const first = await client.callTool({ name: args.tool, arguments: args.arguments });

    if (httpPayment) {
      const receipt = await recordOutcome(deps, { url: url.href, tool: args.tool, ...httpPayment });
      return present(args, url, first, "http-402", receipt, deps.maxBodyBytes);
    }

    const challenge = paymentRequiredFromToolResult(first);
    if (!challenge) return present(args, url, first, undefined, undefined, deps.maxBodyBytes);

    const authorized = await authorizePayment(deps, challenge, args.maxUsd);
    const second = await client.callTool({
      name: args.tool,
      arguments: args.arguments,
      _meta: { [PAYMENT_META_KEY]: authorized.payload },
    });
    const again = paymentRequiredFromToolResult(second);
    const settlement = settlementFromToolResult(second);
    const outcome = { url: url.href, tool: args.tool, authorized, settlement, rejectedAgain: again !== null };
    const receipt = await recordOutcome(deps, again?.error !== undefined ? { ...outcome, rejectionReason: again.error } : outcome);
    return present(args, url, second, "mcp-native", receipt, deps.maxBodyBytes);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function present(
  args: CallPaidToolArgs,
  url: URL,
  result: Awaited<ReturnType<Client["callTool"]>>,
  transport: CallPaidToolResult["payment_transport"],
  receipt: Receipt | undefined,
  maxBodyBytes: number,
): CallPaidToolResult {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((c) => (c.type === "text" ? c.text : `[${c.type} content omitted]`))
    .join("\n");
  const out: CallPaidToolResult = {
    server_url: url.href,
    tool: args.tool,
    paid: receipt !== undefined,
    is_error: result.isError === true,
    content: truncateBody(text, maxBodyBytes),
  };
  if (transport) out.payment_transport = transport;
  if (result.structuredContent !== undefined) out.structured_content = result.structuredContent;
  if (receipt) out.receipt = receipt;
  if (!receipt) out.note = "No payment was required for this call.";
  return out;
}
