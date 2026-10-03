import { describe, expect, it } from "vitest";

import { paymentRequiredFromToolResult, settlementFromToolResult } from "../src/mcpNative.js";
import { paymentRequired } from "./fixtures.js";

describe("MCP-native challenge parsing (specs/transports-v2/mcp.md)", () => {
  const pr = paymentRequired(undefined, "Payment required to access this resource");

  it("prefers structuredContent", () => {
    const result = { isError: true, structuredContent: pr, content: [{ type: "text", text: "ignored" }] };
    expect(paymentRequiredFromToolResult(result)).toEqual(pr);
  });
  it("falls back to content[0].text as JSON", () => {
    const result = { isError: true, content: [{ type: "text", text: JSON.stringify(pr) }] };
    expect(paymentRequiredFromToolResult(result)).toEqual(pr);
  });
  it("ignores ordinary errors and successes", () => {
    expect(paymentRequiredFromToolResult({ isError: true, content: [{ type: "text", text: "boom" }] })).toBeNull();
    expect(paymentRequiredFromToolResult({ isError: false, structuredContent: pr })).toBeNull();
    expect(paymentRequiredFromToolResult({ content: [{ type: "text", text: "pong" }] })).toBeNull();
    expect(paymentRequiredFromToolResult(null)).toBeNull();
    expect(paymentRequiredFromToolResult("x")).toBeNull();
  });
  it("reads the settlement receipt from _meta", () => {
    const receipt = { success: true, transaction: "5abc", network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", payer: "7xK" };
    expect(settlementFromToolResult({ content: [], _meta: { "x402/payment-response": receipt } })).toEqual(receipt);
    expect(settlementFromToolResult({ content: [], _meta: { other: 1 } })).toBeUndefined();
    expect(settlementFromToolResult({ content: [] })).toBeUndefined();
  });
});
