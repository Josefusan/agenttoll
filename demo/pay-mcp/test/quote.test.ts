import { encodePaymentRequiredHeader } from "@x402/core/http";
import { describe, expect, it } from "vitest";

import { challengeFromResponse, decodeChallenge, describeQuote, explorerUrl, isSimulated, QuoteError, selectRequirement } from "../src/quote.js";
import { baseReq, paymentRequired, solanaReq } from "./fixtures.js";

describe("decodeChallenge", () => {
  it("round-trips a v2 PaymentRequired header and prices it at $0.002 per network", () => {
    const header = encodePaymentRequiredHeader(paymentRequired());
    const pr = decodeChallenge(header);
    const q = describeQuote(pr);
    expect(q.resource).toEqual({ url: "http://localhost:8402/api/quote", description: "Live price quote", mimeType: "application/json" });
    expect(q.options.map((o) => [o.network_name, o.usd, o.payTo])).toEqual([
      ["Solana devnet", "0.002", solanaReq.payTo],
      ["Base Sepolia", "0.002", baseReq.payTo],
    ]);
    expect(q.options[0]?.feePayer).toBe("2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4");
    expect(q.options[1]?.feePayer).toBeUndefined();
  });
  it("rejects garbage, v1 and non-integer amounts", () => {
    expect(() => decodeChallenge("!!!")).toThrow(QuoteError);
    const v1 = Buffer.from(JSON.stringify({ x402Version: 1, accepts: [] })).toString("base64");
    expect(() => decodeChallenge(v1)).toThrow(QuoteError);
    const bad = Buffer.from(JSON.stringify(paymentRequired([{ ...solanaReq, amount: "0.002" }]))).toString("base64");
    expect(() => decodeChallenge(bad)).toThrow(/atomic integer/);
  });
  it("falls back to a JSON body when the header is missing", () => {
    const pr = challengeFromResponse(() => null, JSON.stringify(paymentRequired([solanaReq], "Payment required")));
    expect(pr.error).toBe("Payment required");
    expect(() => challengeFromResponse(() => null, "nope")).toThrow(QuoteError);
  });
});

describe("selectRequirement", () => {
  const both = new Set(["solana", "eip155"]);
  it("prefers the configured rail", () => {
    expect(selectRequirement(paymentRequired(), "solana", both)?.requirement.network).toBe(solanaReq.network);
    expect(selectRequirement(paymentRequired(), "eip155", both)?.requirement.network).toBe(baseReq.network);
  });
  it("falls back to any rail the wallet has, and refuses the rest", () => {
    expect(selectRequirement(paymentRequired([baseReq]), "solana", both)?.requirement.network).toBe(baseReq.network);
    expect(selectRequirement(paymentRequired([baseReq]), "solana", new Set(["solana"]))).toBeUndefined();
    expect(selectRequirement(paymentRequired([{ ...solanaReq, scheme: "upto" }]), "solana", both)).toBeUndefined();
  });
  it("returns the amount as atomic bigint", () => {
    expect(selectRequirement(paymentRequired(), "solana", both)?.amount).toBe(2000n);
  });
});

describe("explorer links", () => {
  it("knows devnet, mainnet, sepolia and base", () => {
    expect(explorerUrl(solanaReq.network, "sig")).toBe("https://explorer.solana.com/tx/sig?cluster=devnet");
    expect(explorerUrl("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "sig")).toBe("https://explorer.solana.com/tx/sig");
    expect(explorerUrl(baseReq.network, "0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
    expect(explorerUrl("eip155:8453", "0xabc")).toBe("https://basescan.org/tx/0xabc");
  });
  it("gives no link for simulated, empty or unknown networks", () => {
    expect(isSimulated("SIMULATED-abc")).toBe(true);
    expect(explorerUrl(solanaReq.network, "SIMULATED-abc")).toBeUndefined();
    expect(explorerUrl(solanaReq.network, "")).toBeUndefined();
    expect(explorerUrl("eip155:1", "0x1")).toBeUndefined();
  });
});
