import { describe, expect, it } from "vitest";

import { atomicToUsd, formatUsd, MoneyError, parseAtomic, usdToAtomic } from "../src/money.js";

describe("usdToAtomic", () => {
  it("parses decimal strings exactly (KB-AMT-01)", () => {
    expect(usdToAtomic("0.002")).toBe(2000n);
    expect(usdToAtomic("$0.002")).toBe(2000n);
    expect(usdToAtomic("0.001")).toBe(1000n);
    expect(usdToAtomic("0.05")).toBe(50_000n);
    expect(usdToAtomic("1")).toBe(1_000_000n);
    expect(usdToAtomic("0.25")).toBe(250_000n);
  });
  it("accepts numbers by formatting to 6 decimals", () => {
    expect(usdToAtomic(0.01)).toBe(10_000n);
    expect(usdToAtomic(0.002)).toBe(2000n);
  });
  it("rejects more than 6 decimals, negatives and junk", () => {
    expect(() => usdToAtomic("0.0000001")).toThrow(MoneyError);
    expect(() => usdToAtomic("-1")).toThrow(MoneyError);
    expect(() => usdToAtomic("abc")).toThrow(MoneyError);
    expect(() => usdToAtomic(Number.NaN)).toThrow(MoneyError);
    expect(() => usdToAtomic(-0.5)).toThrow(MoneyError);
  });
});

describe("parseAtomic", () => {
  it("accepts only integer strings", () => {
    expect(parseAtomic("2000")).toBe(2000n);
    expect(() => parseAtomic(2000)).toThrow(MoneyError);
    expect(() => parseAtomic("20.00")).toThrow(MoneyError);
    expect(() => parseAtomic("-1")).toThrow(MoneyError);
  });
});

describe("atomicToUsd", () => {
  it("formats without trailing zeros", () => {
    expect(atomicToUsd(2000n)).toBe("0.002");
    expect(atomicToUsd(1_000_000n)).toBe("1");
    expect(atomicToUsd(0n)).toBe("0");
    expect(atomicToUsd(250_000n)).toBe("0.25");
    expect(formatUsd(10_000n)).toBe("$0.01");
  });
});
