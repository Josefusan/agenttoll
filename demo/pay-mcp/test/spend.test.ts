import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultSpendPath, SpendLedger, utcDay } from "../src/spend.js";

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, "..");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
const HAMMER = join(ROOT, "test", "helpers", "hammer.ts");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pay-mcp-spend-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const caps = { perCall: 10_000n, perDay: 250_000n };
const base = { amount: 2000n, caps, url: "http://x/api/quote", network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", asset: "USDC" };

describe("SpendLedger", () => {
  it("starts empty when the file does not exist", async () => {
    const ledger = new SpendLedger(join(dir, "nested", "spend.json"));
    expect(await ledger.load()).toEqual([]);
    expect(await ledger.spentToday()).toBe(0n);
  });

  it("reserves under the cap, counts the reservation, finalizes in place, leaves no temp or lock file", async () => {
    const file = join(dir, "nested", "spend.json");
    const ledger = new SpendLedger(file);
    const r = await ledger.reserve(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await ledger.spentToday()).toBe(2000n);
    expect((await ledger.needsReconcile()).map((p) => p.status)).toEqual(["pending"]);
    const rec = await ledger.finalize(r.id, { status: "settled", tx: "5sig", payer: "7xK" });
    expect(rec).toMatchObject({ status: "settled", tx: "5sig", payer: "7xK", amount_atomic: "2000" });
    expect(await ledger.needsReconcile()).toEqual([]);
    const reread = new SpendLedger(file);
    expect((await reread.load()).map((p) => p.status)).toEqual(["settled"]);
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
    expect(await readdir(join(dir, "nested"))).toEqual(["spend.json"]);
  });

  it("refuses over the caps without writing, and releases a reservation that never left", async () => {
    const ledger = new SpendLedger(join(dir, "spend.json"));
    expect(await ledger.reserve({ ...base, amount: 50_000n })).toMatchObject({ ok: false, code: "per_call" });
    expect(await ledger.reserve({ ...base, maxUsd: 1000n })).toMatchObject({ ok: false, code: "max_usd" });
    expect(await ledger.load()).toEqual([]);
    const r = await ledger.reserve(base);
    if (!r.ok) throw new Error("expected ok");
    await ledger.release(r.id);
    expect(await ledger.load()).toEqual([]);
    expect(await ledger.spentToday()).toBe(0n);
  });

  it("keeps a rejected-after-send payment counted", async () => {
    const ledger = new SpendLedger(join(dir, "spend.json"));
    const r = await ledger.reserve(base);
    if (!r.ok) throw new Error("expected ok");
    await ledger.finalize(r.id, { status: "rejected_after_send", tx: "", reason: "invalid_exact_svm_transaction_simulation_failed" });
    expect(await ledger.spentToday()).toBe(2000n);
    expect((await ledger.needsReconcile())[0]).toMatchObject({ status: "rejected_after_send", reason: "invalid_exact_svm_transaction_simulation_failed" });
    await expect(ledger.release(r.id)).rejects.toThrow(/already rejected_after_send/);
  });

  it("only counts the current UTC day", async () => {
    const file = join(dir, "spend.json");
    const yesterday = new SpendLedger(file, () => new Date("2026-10-01T23:59:00Z"));
    await yesterday.reserve(base);
    const today = new SpendLedger(file, () => new Date("2026-10-02T00:01:00Z"));
    expect(await today.spentToday()).toBe(0n);
    await today.reserve(base);
    expect(await today.spentToday()).toBe(2000n);
    expect((await today.last(10)).length).toBe(2);
    expect((await today.last(10))[0]?.ts.startsWith("2026-10-02")).toBe(true);
  });

  it("refuses to pay on top of a corrupt file instead of resetting it", async () => {
    const file = join(dir, "spend.json");
    await writeFile(file, "{not json");
    await expect(new SpendLedger(file).load()).rejects.toThrow(/not valid JSON/);
    await expect(new SpendLedger(file).reserve(base)).rejects.toThrow(/not valid JSON/);
  });

  it("sweeps a stale lock instead of waiting forever", async () => {
    const file = join(dir, "spend.json");
    const lock = `${file}.lock`;
    await writeFile(lock, "999999");
    const { utimes } = await import("node:fs/promises");
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    expect(await new SpendLedger(file).reserve(base)).toMatchObject({ ok: true });
  });

  it("utcDay and default path", () => {
    expect(utcDay(new Date("2026-10-02T03:04:05Z"))).toBe("2026-10-02");
    expect(defaultSpendPath({})).toMatch(/\.agenttoll[/\\]spend\.json$/);
    expect(defaultSpendPath({ PAY_MCP_SPEND_FILE: "/tmp/x.json" })).toBe("/tmp/x.json");
  });
});

describe("two processes sharing one ledger", () => {
  const hammer = (file: string, count: number, amount: bigint, perDay: bigint) =>
    run(TSX, [HAMMER, file, String(count), amount.toString(), perDay.toString()], { cwd: ROOT }).then((r) => Number(r.stdout));

  it("loses no records", { timeout: 60_000 }, async () => {
    const file = join(dir, "spend.json");
    const [a, b] = await Promise.all([hammer(file, 25, 10_000n, 10n ** 12n), hammer(file, 25, 10_000n, 10n ** 12n)]);
    expect(a + b).toBe(50);
    expect((await new SpendLedger(file).load()).length).toBe(50);
    expect(await readdir(dir)).toEqual(["spend.json"]);
  });

  it("cannot both pass the daily cap", { timeout: 60_000 }, async () => {
    const file = join(dir, "spend.json");
    const perDay = 25n * 10_000n;
    const [a, b] = await Promise.all([hammer(file, 30, 10_000n, perDay), hammer(file, 30, 10_000n, perDay)]);
    expect(a + b).toBe(25);
    const ledger = new SpendLedger(file);
    expect((await ledger.load()).length).toBe(25);
    expect(await ledger.spentToday()).toBe(perDay);
  });
});
