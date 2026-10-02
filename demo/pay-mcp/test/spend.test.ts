import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultSpendPath, SpendLedger, utcDay } from "../src/spend.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pay-mcp-spend-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const rec = { url: "http://x/api/quote", network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", asset: "USDC", amount_atomic: "2000", tx: "sig", status: "settled" as const };

describe("SpendLedger", () => {
  it("starts empty when the file does not exist", async () => {
    const ledger = new SpendLedger(join(dir, "nested", "spend.json"));
    expect(await ledger.load()).toEqual([]);
    expect(await ledger.spentToday()).toBe(0n);
  });

  it("records, persists and sums today's spend", async () => {
    const file = join(dir, "nested", "spend.json");
    const ledger = new SpendLedger(file);
    await ledger.record(rec);
    await ledger.record({ ...rec, amount_atomic: "1000" });
    expect(await ledger.spentToday()).toBe(3000n);
    const reread = new SpendLedger(file);
    expect((await reread.load()).map((p) => p.amount_atomic)).toEqual(["2000", "1000"]);
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
    expect(await readdir(join(dir, "nested"))).toEqual(["spend.json"]); // no temp file left behind
  });

  it("only counts the current UTC day", async () => {
    const file = join(dir, "spend.json");
    const yesterday = new SpendLedger(file, () => new Date("2026-10-01T23:59:00Z"));
    await yesterday.record(rec);
    const today = new SpendLedger(file, () => new Date("2026-10-02T00:01:00Z"));
    expect(await today.spentToday()).toBe(0n);
    await today.record(rec);
    expect(await today.spentToday()).toBe(2000n);
    expect((await today.last(10)).length).toBe(2);
    expect((await today.last(10))[0]?.ts.startsWith("2026-10-02")).toBe(true);
  });

  it("refuses to pay on top of a corrupt file instead of resetting it", async () => {
    const file = join(dir, "spend.json");
    await writeFile(file, "{not json");
    await expect(new SpendLedger(file).load()).rejects.toThrow(/not valid JSON/);
  });

  it("utcDay and default path", () => {
    expect(utcDay(new Date("2026-10-02T03:04:05Z"))).toBe("2026-10-02");
    expect(defaultSpendPath({})).toMatch(/\.agenttoll[/\\]spend\.json$/);
    expect(defaultSpendPath({ PAY_MCP_SPEND_FILE: "/tmp/x.json" })).toBe("/tmp/x.json");
  });
});
