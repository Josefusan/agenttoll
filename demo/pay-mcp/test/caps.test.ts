import { describe, expect, it } from "vitest";

import { capsFromEnv, checkCaps, DEFAULT_CAPS } from "../src/caps.js";
import { usdToAtomic } from "../src/money.js";

const caps = { perCall: usdToAtomic("0.01"), perDay: usdToAtomic("0.25") };

describe("capsFromEnv", () => {
  it("defaults to $0.01 per call and $0.25 per day", () => {
    expect(capsFromEnv({})).toEqual({ perCall: 10_000n, perDay: 250_000n });
    expect(DEFAULT_CAPS).toEqual({ perCall: "0.01", perDay: "0.25" });
  });
  it("reads overrides", () => {
    expect(capsFromEnv({ BUYER_MAX_USD_PER_CALL: "0.05", BUYER_MAX_USD_PER_DAY: "1" })).toEqual({ perCall: 50_000n, perDay: 1_000_000n });
  });
});

describe("checkCaps", () => {
  it("allows $0.002 under default caps", () => {
    expect(checkCaps(2000n, { caps, spentToday: 0n })).toEqual({ ok: true, limit: 10_000n });
  });
  it("refuses above the per-call cap", () => {
    const v = checkCaps(50_000n, { caps, spentToday: 0n });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("per_call");
      expect(v.reason).toContain("BUYER_MAX_USD_PER_CALL");
    }
  });
  it("the caller's max_usd wins when it is lower", () => {
    const v = checkCaps(2000n, { caps, maxUsd: 1000n, spentToday: 0n });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("max_usd");
      expect(v.limit).toBe(1000n);
    }
  });
  it("the env cap wins when max_usd is higher", () => {
    const v = checkCaps(20_000n, { caps, maxUsd: 1_000_000n, spentToday: 0n });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("per_call");
    expect(checkCaps(2000n, { caps, maxUsd: 1_000_000n, spentToday: 0n })).toEqual({ ok: true, limit: 10_000n });
  });
  it("refuses when the day would be exceeded, counting what is already spent", () => {
    expect(checkCaps(2000n, { caps, spentToday: 248_000n }).ok).toBe(true);
    const v = checkCaps(2000n, { caps, spentToday: 248_001n });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("per_day");
      expect(v.reason).toContain("$0.001999 left");
    }
  });
  it("never goes negative on remaining when already over", () => {
    const v = checkCaps(1n, { caps, spentToday: 300_000n });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("$0 left");
  });
});
