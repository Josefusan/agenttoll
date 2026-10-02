// MCP-native x402 transport (x402-foundation/x402 specs/transports-v2/mcp.md, KB-X402-05):
// challenge = tool result with isError and PaymentRequired in structuredContent (or content[0].text),
// payment = params._meta["x402/payment"], receipt = result._meta["x402/payment-response"].

import type { PaymentRequired, SettleResponse } from "@x402/core/types";

import { isPaymentRequired, QuoteError, validatePaymentRequired } from "./quote.js";

export const PAYMENT_META_KEY = "x402/payment";
export const RECEIPT_META_KEY = "x402/payment-response";

interface ToolResultLike {
  isError?: boolean;
  structuredContent?: unknown;
  content?: unknown;
  _meta?: unknown;
}

function asToolResult(v: unknown): ToolResultLike | null {
  return typeof v === "object" && v !== null ? (v as ToolResultLike) : null;
}

/** The PaymentRequired a paid MCP tool answered with, or null when the result is not an x402 challenge. */
export function paymentRequiredFromToolResult(result: unknown): PaymentRequired | null {
  const r = asToolResult(result);
  if (!r || r.isError !== true) return null;
  if (isPaymentRequired(r.structuredContent)) return validatePaymentRequired(r.structuredContent);
  if (Array.isArray(r.content)) {
    const first = r.content[0] as { type?: unknown; text?: unknown } | undefined;
    if (first && first.type === "text" && typeof first.text === "string") {
      try {
        const parsed: unknown = JSON.parse(first.text);
        if (isPaymentRequired(parsed)) return validatePaymentRequired(parsed);
      } catch (err) {
        if (err instanceof QuoteError) throw err;
        // not JSON: an ordinary tool error
      }
    }
  }
  return null;
}

export function isSettleResponse(v: unknown): v is SettleResponse {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.success === "boolean" && typeof o.transaction === "string" && typeof o.network === "string";
}

/** The settlement receipt the server attached to a paid tool result, if any. */
export function settlementFromToolResult(result: unknown): SettleResponse | undefined {
  const r = asToolResult(result);
  const meta = r?._meta;
  if (typeof meta !== "object" || meta === null) return undefined;
  const receipt = (meta as Record<string, unknown>)[RECEIPT_META_KEY];
  return isSettleResponse(receipt) ? receipt : undefined;
}
