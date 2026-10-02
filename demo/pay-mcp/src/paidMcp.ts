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
  type PayerDeps,
  type Receipt,
  recordOutcome,
  recordSentUnconfirmed,
  settlementFromHeaders,
  untrusted,
  type UntrustedContent,
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
  /** The remote tool's text content; `structured` carries its structuredContent when present. */
  untrusted_content: UntrustedContent & { structured?: unknown };
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

  // The transport's fetch: let free JSON-RPC calls through, pay a 402 once, remember the outcome.
  const payingFetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const first = await deps.fetch(input, init);
    if (first.status !== 402) return first;
    if (httpPayment) throw new Error("the server asked for payment twice in one tool call; giving up");
    const text = await first.text();
    const pr = challengeFromResponse((n) => first.headers.get(n), text);
    const authorized = await authorizePayment(deps, pr, args.maxUsd, { url: url.href, tool: args.tool });
    const headers = new Headers(init?.headers);
    headers.set("PAYMENT-SIGNATURE", encodePaymentSignatureHeader(authorized.payload));
    let second: Response;
    try {
      second = await deps.fetch(first.url || input, { ...init, headers, redirect: "manual" });
    } catch (err) {
      return recordSentUnconfirmed(deps, authorized, `request failed after the payment was sent (${(err as Error).message})`);
    }
    if (second.status >= 300 && second.status < 400) {
      return recordSentUnconfirmed(deps, authorized, `the server answered the paid request with a ${second.status} redirect; the payment was not re-sent`);
    }
    const settlement = settlementFromHeaders((n) => second.headers.get(n));
    httpPayment = { authorized, settlement, rejectedAgain: second.status === 402 };
    if (second.status === 402) {
      try {
        const reason = challengeFromResponse((n) => second.headers.get(n), await second.clone().text()).error;
        if (reason !== undefined) httpPayment.rejectionReason = reason;
      } catch {
        // leave the reason undefined
      }
      // recordOutcome counts the rejected-after-send payment and throws PaymentRejected.
      await recordOutcome(deps, httpPayment);
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
      const receipt = await recordOutcome(deps, httpPayment);
      return present(args, url, first, "http-402", receipt, deps.maxBodyBytes);
    }

    const challenge = paymentRequiredFromToolResult(first);
    if (!challenge) return present(args, url, first, undefined, undefined, deps.maxBodyBytes);

    const authorized = await authorizePayment(deps, challenge, args.maxUsd, { url: url.href, tool: args.tool });
    let second: Awaited<ReturnType<Client["callTool"]>>;
    try {
      second = await client.callTool({
        name: args.tool,
        arguments: args.arguments,
        _meta: { [PAYMENT_META_KEY]: authorized.payload },
      });
    } catch (err) {
      return recordSentUnconfirmed(deps, authorized, `the paid tool call failed after the payment was sent (${(err as Error).message})`);
    }
    const again = paymentRequiredFromToolResult(second);
    const settlement = settlementFromToolResult(second);
    const outcome: HttpPayment = { authorized, settlement, rejectedAgain: again !== null };
    if (again?.error !== undefined) outcome.rejectionReason = again.error;
    const receipt = await recordOutcome(deps, outcome);
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
  const text = content.map((c) => (c.type === "text" ? c.text : `[${c.type} content omitted]`)).join("\n");
  const out: CallPaidToolResult = {
    server_url: url.href,
    tool: args.tool,
    paid: receipt !== undefined,
    is_error: result.isError === true,
    untrusted_content: untrusted(text, maxBodyBytes),
  };
  if (transport) out.payment_transport = transport;
  if (result.structuredContent !== undefined) out.untrusted_content.structured = result.structuredContent;
  if (receipt) out.receipt = receipt;
  if (!receipt) out.note = "No payment was required for this call.";
  return out;
}
