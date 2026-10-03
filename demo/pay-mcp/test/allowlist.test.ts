import { describe, expect, it } from "vitest";

import { allowlistFromEnv, assetAllowed, KNOWN_NETWORKS } from "../src/allowlist.js";
import { describeQuote, refusalFor, selectRequirement } from "../src/quote.js";
import { BASE_SEPOLIA, baseReq, paymentRequired, SOLANA_DEVNET, solanaReq } from "./fixtures.js";

const both = new Set(["solana", "eip155"]);
const testnets = allowlistFromEnv({});
const withMainnet = allowlistFromEnv({ PAY_MCP_ALLOW_MAINNET: "1" });

describe("allowlist", () => {
  it("defaults to Solana devnet and Base Sepolia USDC only", () => {
    expect([...testnets.keys()]).toEqual([SOLANA_DEVNET, BASE_SEPOLIA]);
    expect(testnets.get(SOLANA_DEVNET)?.asset).toBe("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    expect(testnets.get(BASE_SEPOLIA)?.asset).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  });
  it("adds mainnet only with PAY_MCP_ALLOW_MAINNET=1", () => {
    expect(withMainnet.size).toBe(KNOWN_NETWORKS.length);
    expect(withMainnet.get("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")?.asset).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(withMainnet.get("eip155:8453")?.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(allowlistFromEnv({ PAY_MCP_ALLOW_MAINNET: "true" }).size).toBe(2);
  });
  it("compares EVM assets case-insensitively and Solana mints exactly", () => {
    const base = testnets.get(BASE_SEPOLIA)!;
    expect(assetAllowed(base, base.asset.toLowerCase())).toBe(true);
    const sol = testnets.get(SOLANA_DEVNET)!;
    expect(assetAllowed(sol, sol.asset.toLowerCase())).toBe(false);
  });
});

describe("selection under the allowlist", () => {
  it("refuses a USDG mint swap on Solana devnet as refused:asset", () => {
    const usdg = { ...solanaReq, asset: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH" };
    const r = selectRequirement(paymentRequired([usdg]), "solana", both, testnets);
    expect(r).toMatchObject({ ok: false, code: "asset" });
    if (!r.ok) expect(r.reason).toContain("not USDC on Solana devnet");
  });
  it("refuses wSOL", () => {
    const wsol = { ...solanaReq, asset: "So11111111111111111111111111111111111111112" };
    expect(selectRequirement(paymentRequired([wsol]), "solana", both, testnets)).toMatchObject({ ok: false, code: "asset" });
  });
  it("refuses a Base mainnet offer without the flag, accepts it with the flag", () => {
    const mainnet = { ...baseReq, network: "eip155:8453" as const, asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" };
    const r = selectRequirement(paymentRequired([mainnet]), "eip155", both, testnets);
    expect(r).toMatchObject({ ok: false, code: "network" });
    if (!r.ok) expect(r.reason).toContain("PAY_MCP_ALLOW_MAINNET");
    expect(selectRequirement(paymentRequired([mainnet]), "eip155", both, withMainnet)).toMatchObject({ ok: true });
  });
  it("refuses a Solana mainnet USDC offer without the flag", () => {
    const mainnet = { ...solanaReq, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const, asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" };
    expect(selectRequirement(paymentRequired([mainnet]), "solana", both, testnets)).toMatchObject({ ok: false, code: "network" });
  });
  it("skips a swapped asset and pays the honest option next to it", () => {
    const usdg = { ...solanaReq, asset: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH" };
    const r = selectRequirement(paymentRequired([usdg, baseReq]), "solana", both, testnets);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.selection.requirement.network).toBe(BASE_SEPOLIA);
  });
  it("accepts lower-cased Base Sepolia USDC", () => {
    const lower = { ...baseReq, asset: baseReq.asset.toLowerCase() };
    expect(selectRequirement(paymentRequired([lower]), "eip155", both, testnets)).toMatchObject({ ok: true });
  });
  it("marks unpayable options in the quote", () => {
    const wsol = { ...solanaReq, asset: "So11111111111111111111111111111111111111112" };
    const q = describeQuote(paymentRequired([solanaReq, wsol]), testnets);
    expect(q.options.map((o) => o.payable)).toEqual([true, false]);
    expect(q.options[1]?.refusal).toContain("not USDC");
    expect(refusalFor(solanaReq, testnets)).toBeUndefined();
  });
});
