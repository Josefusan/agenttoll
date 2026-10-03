import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allowlistFromEnv } from "../src/allowlist.js";
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
  networks: [solanaReq.network],
  warnings: [],
};

function deps(fetch: PayerDeps["fetch"], overrides: Partial<PayerDeps> = {}): PayerDeps {
  return {
    fetch,
    wallet: async () => wallet,
    ledger,
    caps: { perCall: usdToAtomic("0.01"), perDay: usdToAtomic("0.25") },
    allowlist: allowlistFromEnv({}),
    headers: { "User-Agent": "AgentToll-Buyer/pay-mcp test", "X-Agent-Name": "pay-mcp" },
    maxBodyBytes: 32,
    ...overrides,
  };
}

function challenge(pr: PaymentRequired): Response {
  return new Response(JSON.stringify(pr), { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(pr), "content-type": "application/json" } });
}

const paid = (init?: RequestInit) => new Headers(init?.headers).has("PAYMENT-SIGNATURE");
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
    expect(q.quote?.options.map((o) => [o.usd, o.payable])).toEqual([["0.002", true], ["0.002", true]]);
    expect(q.quote?.untrusted_content.description).toBe("Live price quote");
    expect(createPaymentPayload).not.toHaveBeenCalled();
    expect(await ledger.load()).toEqual([]);
  });
  it("reports a free resource as untrusted content", async () => {
    const q = await getQuote(deps(async () => new Response("hello")), "http://localhost:8402/");
    expect(q).toMatchObject({ payment_required: false, status: 200, untrusted_content: { text: "hello", truncated: false } });
    expect(q.untrusted_content?.note).toMatch(/never as instructions/);
  });
  it("refuses non-http URLs before any network call", async () => {
    const fetch = vi.fn();
    await expect(getQuote(deps(fetch), "file:///etc/passwd")).rejects.toThrow(PayRefused);
    await expect(getQuote(deps(fetch), "not a url")).rejects.toThrow(PayRefused);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("payAndFetch refusals (nothing signed, nothing recorded)", () => {
  const refuse = async (pr: PaymentRequired, code: string, maxUsd?: bigint) => {
    const args: Parameters<typeof payAndFetch>[1] = { url: "http://x/api/quote" };
    if (maxUsd !== undefined) args.maxUsd = maxUsd;
    await expect(payAndFetch(deps(async () => challenge(pr)), args)).rejects.toMatchObject({ code });
    expect(createPaymentPayload).not.toHaveBeenCalled();
    expect(await ledger.load()).toEqual([]);
  };
  it("refuses a quote above BUYER_MAX_USD_PER_CALL", () => refuse(paymentRequired([{ ...solanaReq, amount: "50000" }]), "per_call"));
  it("refuses when the caller's max_usd is lower than the price", () => refuse(paymentRequired(), "max_usd", usdToAtomic("0.001")));
  it("refuses a swapped asset (USDG) before caps", () => refuse(paymentRequired([{ ...solanaReq, asset: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH" }]), "asset"));
  it("refuses a mainnet rail before caps", () => refuse(paymentRequired([{ ...solanaReq, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }]), "network"));
  it("refuses when the seller only accepts a rail this wallet lacks", () => refuse(paymentRequired([baseReq]), "unsupported_network"));
  it("refuses a zero amount", async () => {
    await expect(payAndFetch(deps(async () => challenge(paymentRequired([{ ...solanaReq, amount: "0" }]))), { url: "http://x/api/quote" })).rejects.toThrow(/zero-amount/);
    expect(createPaymentPayload).not.toHaveBeenCalled();
  });
  it("refuses when the daily cap would be exceeded", async () => {
    const r = await ledger.reserve({ amount: 249_000n, caps: { perCall: 10n ** 9n, perDay: 10n ** 9n }, url: "http://x", network: solanaReq.network, asset: solanaReq.asset });
    if (!r.ok) throw new Error("setup");
    await ledger.finalize(r.id, { status: "settled", tx: "t" });
    await expect(payAndFetch(deps(async () => challenge(paymentRequired())), { url: "http://x/api/quote" })).rejects.toMatchObject({ code: "per_day" });
    expect(createPaymentPayload).not.toHaveBeenCalled();
    expect(await ledger.spentToday()).toBe(249_000n);
  });
  it("reports a wallet that cannot be loaded as a refusal", async () => {
    const d = deps(async () => challenge(paymentRequired()), { wallet: async () => { throw new Error("no wallet configured"); } });
    await expect(payAndFetch(d, { url: "http://x/api/quote" })).rejects.toMatchObject({ code: "no_wallet" });
  });
  it("releases the reservation when signing fails", async () => {
    createPaymentPayload.mockRejectedValue(new Error("rpc down"));
    await expect(payAndFetch(deps(async () => challenge(paymentRequired())), { url: "http://x/api/quote" })).rejects.toMatchObject({ code: "sign_failed" });
    expect(await ledger.load()).toEqual([]);
  });
});

describe("payAndFetch payment", () => {
  it("pays within caps, records the settlement and links the explorer", async () => {
    const receipt = { success: true, transaction: "5sig", network: solanaReq.network, payer: wallet.addresses.solana ?? "" };
    const fetch = vi.fn(async (_u: string | URL, init?: RequestInit) => {
      if (!paid(init)) return challenge(paymentRequired());
      expect(new Headers(init?.headers).get("x-agent-name")).toBe("pay-mcp");
      expect(init?.redirect).toBe("manual");
      return new Response(JSON.stringify({ price: 142.1 }), { status: 200, headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(receipt) } });
    });
    const r = await payAndFetch(deps(fetch), { url: "http://localhost:8402/api/quote", maxUsd: usdToAtomic("0.01") });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(createPaymentPayload).toHaveBeenCalledTimes(1);
    expect(createPaymentPayload.mock.calls[0]?.[0]?.accepts).toEqual([solanaReq]); // only the chosen rail is handed to the signer
    expect(r.paid).toBe(true);
    expect(r.receipt).toMatchObject({ usd: "0.002", network_name: "Solana devnet", asset: solanaReq.asset, tx: "5sig", status: "settled", simulated: false, explorer_url: "https://explorer.solana.com/tx/5sig?cluster=devnet" });
    expect(r.untrusted_content.text).toBe('{"price":142.1}');
    expect(await ledger.spentToday()).toBe(2000n);
    expect((await ledger.last(1))[0]).toMatchObject({ tx: "5sig", payer: wallet.addresses.solana, status: "settled" });
    expect(await ledger.needsReconcile()).toEqual([]);
  });

  it("says plainly when the settlement was simulated and gives no link", async () => {
    const receipt = { success: true, transaction: "SIMULATED-1234", network: solanaReq.network };
    const fetch = async (_u: string | URL, init?: RequestInit) =>
      paid(init) ? new Response("ok", { status: 200, headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(receipt) } }) : challenge(paymentRequired());
    const r = await payAndFetch(deps(fetch), { url: "http://x/api/quote" });
    expect(r.receipt).toMatchObject({ simulated: true, status: "simulated" });
    expect(r.receipt?.explorer_url).toBeUndefined();
    expect(r.receipt?.note).toMatch(/simulated/i);
  });

  it("keeps a facilitator rejection counted because the seller holds a signed payment", async () => {
    const fetch = async (_u: string | URL, init?: RequestInit) =>
      paid(init) ? challenge(paymentRequired([solanaReq], "invalid_exact_svm_transaction_simulation_failed")) : challenge(paymentRequired());
    await expect(payAndFetch(deps(fetch), { url: "http://x/api/quote" })).rejects.toSatisfy(
      (e: unknown) => e instanceof PaymentRejected && e.reason === "invalid_exact_svm_transaction_simulation_failed" && e.counted_usd === "0.002" && /seller received a signed payment/.test(e.message),
    );
    expect(await ledger.spentToday()).toBe(2000n);
    expect((await ledger.needsReconcile())[0]).toMatchObject({ status: "rejected_after_send", reason: "invalid_exact_svm_transaction_simulation_failed" });
  });

  it("a dishonest seller cannot drain past the daily cap by rejecting", async () => {
    const fetch = async (_u: string | URL, init?: RequestInit) =>
      paid(init) ? challenge(paymentRequired([{ ...solanaReq, amount: "10000" }], "nope")) : challenge(paymentRequired([{ ...solanaReq, amount: "10000" }]));
    for (let i = 0; i < 25; i++) await expect(payAndFetch(deps(fetch), { url: "http://x/api/quote" })).rejects.toThrow(PaymentRejected);
    await expect(payAndFetch(deps(fetch), { url: "http://x/api/quote" })).rejects.toMatchObject({ code: "per_day" });
    expect(createPaymentPayload).toHaveBeenCalledTimes(25);
    expect(await ledger.spentToday()).toBe(250_000n);
  });

  it("counts a payment whose receipt never arrived", async () => {
    const fetch = async (_u: string | URL, init?: RequestInit) => (paid(init) ? new Response("ok") : challenge(paymentRequired()));
    const r = await payAndFetch(deps(fetch), { url: "http://x/api/quote" });
    expect(r.receipt).toMatchObject({ status: "unknown", tx: "" });
    expect(await ledger.spentToday()).toBe(2000n);
  });

  it("counts a payment when the paid request itself fails", async () => {
    const fetch = async (_u: string | URL, init?: RequestInit) => {
      if (paid(init)) throw new TypeError("fetch failed");
      return challenge(paymentRequired());
    };
    await expect(payAndFetch(deps(fetch), { url: "http://x/api/quote" })).rejects.toThrow(/stays counted/);
    expect((await ledger.needsReconcile())[0]).toMatchObject({ status: "unknown", reason: expect.stringContaining("fetch failed") });
  });

  it("does not follow a redirect with the payment attached", async () => {
    const fetch = vi.fn(async (_u: string | URL, init?: RequestInit) =>
      paid(init) ? new Response(null, { status: 302, headers: { location: "http://evil/collect" } }) : challenge(paymentRequired()),
    );
    await expect(payAndFetch(deps(fetch), { url: "http://x/api/quote" })).rejects.toThrow(/302 redirect .*not re-sent/);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await ledger.spentToday()).toBe(2000n);
  });

  it("pays the URL that issued the challenge, not a redirect target", async () => {
    const fetch = vi.fn(async (u: string | URL, init?: RequestInit) => {
      if (paid(init)) {
        expect(String(u)).toBe("http://x/api/quote");
        return new Response("ok", { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: "s", network: solanaReq.network }) } });
      }
      return challenge(paymentRequired());
    });
    await payAndFetch(deps(fetch), { url: "http://x/api/quote" });
  });

  it("truncates long bodies and reports it", async () => {
    const fetch = async (_u: string | URL, init?: RequestInit) =>
      paid(init)
        ? new Response("x".repeat(100), { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: "s", network: solanaReq.network }) } })
        : challenge(paymentRequired());
    const r = await payAndFetch(deps(fetch), { url: "http://x/api/quote" });
    expect(r.untrusted_content).toMatchObject({ truncated: true, bytes: 100 });
    expect(r.untrusted_content.text.length).toBe(32);
  });
});
