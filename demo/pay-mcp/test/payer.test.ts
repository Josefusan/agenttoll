import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usdToAtomic } from "../src/money.js";
import { getQuote, payAndFetch, type PayerDeps, PayRefused, PaymentRejected } from "../src/payer.js";
import { SpendLedger } from "../src/spend.js";
import type { Wallet } from "../src/wallet.js";
import { baseReq, paymentRequired, solanaReq } from "./fixtures.js";

let dir: string;
let ledger: SpendLedger;
const createPaymentPayload = vi.fn<(pr: PaymentRequired) => Promise<PaymentPayload>>();
const wallet: Wallet = {
  signer: { createPaymentPayload },
  namespaces: new Set(["solana"]),
  preferred: "solana",
  addresses: { solana: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
};

function deps(fetch: PayerDeps["fetch"], overrides: Partial<PayerDeps> = {}): PayerDeps {
  return {
    fetch,
    wallet: async () => wallet,
    ledger,
    caps: { perCall: usdToAtomic("0.01"), perDay: usdToAtomic("0.25") },
    headers: { "User-Agent": "AgentToll-Buyer/pay-mcp test", "X-Agent-Name": "pay-mcp" },
    maxBodyBytes: 32,
    ...overrides,
  };
}

function challenge(pr: PaymentRequired): Response {
  return new Response(JSON.stringify(pr), { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(pr), "content-type": "application/json" } });
}

const payload: PaymentPayload = { x402Version: 2, accepted: solanaReq, payload: { transaction: "AQID" }, resource: paymentRequired().resource };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pay-mcp-payer-"));
  ledger = new SpendLedger(join(dir, "spend.json"));
  createPaymentPayload.mockReset();
  createPaymentPayload.mockResolvedValue(payload);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("getQuote", () => {
  it("decodes a 402 without paying and sends the agent identity", async () => {
    const fetch = vi.fn(async (_u: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-agent-name")).toBe("pay-mcp");
      expect(new Headers(init?.headers).get("user-agent")).toContain("AgentToll-Buyer");
      return challenge(paymentRequired());
    });
    const q = await getQuote(deps(fetch), "http://localhost:8402/api/quote");
    expect(q.payment_required).toBe(true);
    expect(q.quote?.options.map((o) => o.usd)).toEqual(["0.002", "0.002"]);
    expect(createPaymentPayload).not.toHaveBeenCalled();
    expect(await ledger.load()).toEqual([]);
  });
  it("reports a free resource", async () => {
    const q = await getQuote(deps(async () => new Response("hello")), "http://localhost:8402/");
    expect(q).toMatchObject({ payment_required: false, status: 200, body: { text: "hello", truncated: false } });
  });
  it("refuses non-http URLs before any network call", async () => {
    const fetch = vi.fn();
    await expect(getQuote(deps(fetch), "file:///etc/passwd")).rejects.toThrow(PayRefused);
    await expect(getQuote(deps(fetch), "not a url")).rejects.toThrow(PayRefused);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("payAndFetch refusals (nothing signed, nothing recorded)", () => {
  it("refuses a quote above BUYER_MAX_USD_PER_CALL", async () => {
    const pr = paymentRequired([{ ...solanaReq, amount: "50000" }]);
    await expect(payAndFetch(deps(async () => challenge(pr)), { url: "http://x/api/report" })).rejects.toMatchObject({ code: "per_call" });
    expect(createPaymentPayload).not.toHaveBeenCalled();
    expect(await ledger.load()).toEqual([]);
  });
  it("refuses when the caller's max_usd is lower than the price", async () => {
    await expect(payAndFetch(deps(async () => challenge(paymentRequired())), { url: "http://x/api/quote", maxUsd: usdToAtomic("0.001") })).rejects.toMatchObject({ code: "max_usd" });
    expect(createPaymentPayload).not.toHaveBeenCalled();
  });
  it("refuses when the daily cap would be exceeded", async () => {
    await ledger.record({ url: "http://x", network: solanaReq.network, asset: solanaReq.asset, amount_atomic: "249000", tx: "t", status: "settled" });
    await expect(payAndFetch(deps(async () => challenge(paymentRequired())), { url: "http://x/api/quote" })).rejects.toMatchObject({ code: "per_day" });
    expect(createPaymentPayload).not.toHaveBeenCalled();
    expect(await ledger.spentToday()).toBe(249_000n);
  });
  it("refuses when the seller only accepts a rail this wallet lacks", async () => {
    await expect(payAndFetch(deps(async () => challenge(paymentRequired([baseReq]))), { url: "http://x/api/quote" })).rejects.toMatchObject({ code: "unsupported_network" });
    expect(createPaymentPayload).not.toHaveBeenCalled();
  });
  it("reports a wallet that cannot be loaded as a refusal", async () => {
    const d = deps(async () => challenge(paymentRequired()), { wallet: async () => { throw new Error("no wallet configured"); } });
    await expect(payAndFetch(d, { url: "http://x/api/quote" })).rejects.toMatchObject({ code: "no_wallet" });
  });
});

describe("payAndFetch payment", () => {
  it("pays within caps, records the settlement and links the explorer", async () => {
    const receipt = { success: true, transaction: "5sig", network: solanaReq.network, payer: wallet.addresses.solana ?? "" };
    const fetch = vi.fn(async (_u: string | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      if (!h.has("PAYMENT-SIGNATURE")) return challenge(paymentRequired());
      expect(h.get("x-agent-name")).toBe("pay-mcp");
      return new Response(JSON.stringify({ price: 142.1 }), { status: 200, headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(receipt) } });
    });
    const r = await payAndFetch(deps(fetch), { url: "http://localhost:8402/api/quote", maxUsd: usdToAtomic("0.01") });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(createPaymentPayload).toHaveBeenCalledTimes(1);
    expect(createPaymentPayload.mock.calls[0]?.[0]?.accepts).toEqual([solanaReq]); // only the chosen rail is handed to the signer
    expect(r.paid).toBe(true);
    expect(r.receipt).toMatchObject({ usd: "0.002", network_name: "Solana devnet", tx: "5sig", status: "settled", simulated: false, explorer_url: "https://explorer.solana.com/tx/5sig?cluster=devnet" });
    expect(r.body.text).toBe('{"price":142.1}');
    expect(await ledger.spentToday()).toBe(2000n);
    expect((await ledger.last(1))[0]).toMatchObject({ tx: "5sig", payer: wallet.addresses.solana, status: "settled" });
  });

  it("says plainly when the settlement was simulated and gives no link", async () => {
    const receipt = { success: true, transaction: "SIMULATED-1234", network: solanaReq.network };
    const fetch = async (_u: string | URL, init?: RequestInit) =>
      new Headers(init?.headers).has("PAYMENT-SIGNATURE")
        ? new Response("ok", { status: 200, headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(receipt) } })
        : challenge(paymentRequired());
    const r = await payAndFetch(deps(fetch), { url: "http://x/api/quote" });
    expect(r.receipt).toMatchObject({ simulated: true, status: "simulated" });
    expect(r.receipt?.explorer_url).toBeUndefined();
    expect(r.receipt?.note).toMatch(/simulated/i);
  });

  it("surfaces a facilitator rejection with no spend recorded", async () => {
    const fetch = async (_u: string | URL, init?: RequestInit) =>
      new Headers(init?.headers).has("PAYMENT-SIGNATURE")
        ? challenge(paymentRequired([solanaReq], "invalid_exact_svm_transaction_simulation_failed"))
        : challenge(paymentRequired());
    await expect(payAndFetch(deps(fetch), { url: "http://x/api/quote" })).rejects.toSatisfy(
      (e: unknown) => e instanceof PaymentRejected && e.reason === "invalid_exact_svm_transaction_simulation_failed",
    );
    expect(await ledger.load()).toEqual([]);
  });

  it("counts a payment whose receipt never arrived", async () => {
    const fetch = async (_u: string | URL, init?: RequestInit) =>
      new Headers(init?.headers).has("PAYMENT-SIGNATURE") ? new Response("ok") : challenge(paymentRequired());
    const r = await payAndFetch(deps(fetch), { url: "http://x/api/quote" });
    expect(r.receipt).toMatchObject({ status: "unknown", tx: "" });
    expect(await ledger.spentToday()).toBe(2000n);
  });

  it("truncates long bodies and reports it", async () => {
    const fetch = async (_u: string | URL, init?: RequestInit) =>
      new Headers(init?.headers).has("PAYMENT-SIGNATURE")
        ? new Response("x".repeat(100), { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: "s", network: solanaReq.network }) } })
        : challenge(paymentRequired());
    const r = await payAndFetch(deps(fetch), { url: "http://x/api/quote" });
    expect(r.body).toMatchObject({ truncated: true, bytes: 100 });
    expect(r.body.text.length).toBe(32);
  });
});
