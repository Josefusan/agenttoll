import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { type Caps, type CapVerdict, checkCaps } from "./caps.js";
import { type Atomic } from "./money.js";

export type PaymentStatus =
  /** Reserved under the cap; the payment is being signed or is in flight. Counts. */
  | "pending"
  /** Facilitator reported success with a transaction id. */
  | "settled"
  /** Gateway answered with a SIMULATED transaction id: nothing moved on chain. Counts anyway. */
  | "simulated"
  /** The signed payment was sent but no receipt came back. Counts until reconciled. */
  | "unknown"
  /** The seller rejected the payment after receiving the signed payload. It still holds a signed
   *  bearer payment it could settle, so this counts until reconciled. */
  | "rejected_after_send";

/** Statuses a person should look at: money may or may not have moved. */
export const RECONCILE_STATUSES: readonly PaymentStatus[] = ["pending", "unknown", "rejected_after_send"];

export interface PaymentRecord {
  id: string;
  ts: string;
  url: string;
  tool?: string;
  network: string;
  asset: string;
  amount_atomic: string;
  payer?: string;
  tx: string;
  status: PaymentStatus;
  reason?: string;
}

interface SpendFile {
  version: 1;
  payments: PaymentRecord[];
}

const RETENTION_DAYS = 90;
const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function defaultSpendPath(env: NodeJS.ProcessEnv): string {
  const configured = env.PAY_MCP_SPEND_FILE;
  if (configured && configured.length > 0) return configured.replace(/^~(?=$|\/)/, homedir());
  return join(homedir(), ".agenttoll", "spend.json");
}

export interface ReserveInput {
  amount: Atomic;
  caps: Caps;
  maxUsd?: Atomic;
  url: string;
  tool?: string;
  network: string;
  asset: string;
}

export type ReserveResult = { ok: true; id: string } | Extract<CapVerdict, { ok: false }>;

export interface Finalize {
  status: Exclude<PaymentStatus, "pending">;
  tx: string;
  payer?: string;
  reason?: string;
}

/**
 * JSON ledger of payments shared by every pay-mcp process on the machine. Every read-modify-write runs
 * under an exclusive lock file, so two processes cannot both pass the daily cap or lose each other's
 * rows. A payment is reserved (counted) before it is signed and finalized after the seller answers.
 */
export class SpendLedger {
  constructor(
    readonly file: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<PaymentRecord[]> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`${this.file} is not valid JSON (${(err as Error).message}); fix or move it before paying`);
    }
    if (!isSpendFile(parsed)) throw new Error(`${this.file} is not a pay-mcp spend file`);
    return parsed.payments;
  }

  async spentToday(): Promise<Atomic> {
    return sumDay(await this.load(), utcDay(this.now()));
  }

  /** Cap check and reservation in one locked step. Refusals write nothing. */
  async reserve(input: ReserveInput): Promise<ReserveResult> {
    return this.locked(async () => {
      const payments = await this.load();
      const capInput: Parameters<typeof checkCaps>[1] = { caps: input.caps, spentToday: sumDay(payments, utcDay(this.now())) };
      if (input.maxUsd !== undefined) capInput.maxUsd = input.maxUsd;
      const verdict = checkCaps(input.amount, capInput);
      if (!verdict.ok) return verdict;
      const rec: PaymentRecord = {
        id: randomBytes(8).toString("hex"),
        ts: this.now().toISOString(),
        url: input.url,
        network: input.network,
        asset: input.asset,
        amount_atomic: input.amount.toString(),
        tx: "",
        status: "pending",
      };
      if (input.tool !== undefined) rec.tool = input.tool;
      payments.push(rec);
      await this.write(prune(payments, this.now()));
      return { ok: true, id: rec.id };
    });
  }

  /** Only for reservations where nothing was ever sent (signing failed). */
  async release(id: string): Promise<void> {
    await this.locked(async () => {
      const payments = await this.load();
      const rec = payments.find((p) => p.id === id);
      if (rec && rec.status !== "pending") throw new Error(`cannot release ${id}: already ${rec.status}`);
      await this.write(payments.filter((p) => p.id !== id));
    });
  }

  async finalize(id: string, outcome: Finalize): Promise<PaymentRecord> {
    return this.locked(async () => {
      const payments = await this.load();
      const rec = payments.find((p) => p.id === id);
      if (!rec) throw new Error(`reservation ${id} vanished from ${this.file}; the payment is uncounted, reconcile by hand`);
      rec.status = outcome.status;
      rec.tx = outcome.tx;
      if (outcome.payer) rec.payer = outcome.payer;
      if (outcome.reason) rec.reason = outcome.reason;
      await this.write(payments);
      return rec;
    });
  }

  async last(n: number): Promise<PaymentRecord[]> {
    const all = await this.load();
    return all.slice(-n).reverse();
  }

  async needsReconcile(): Promise<PaymentRecord[]> {
    return (await this.load()).filter((p) => RECONCILE_STATUSES.includes(p.status));
  }

  private async write(payments: PaymentRecord[]): Promise<void> {
    const body: SpendFile = { version: 1, payments };
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, this.file);
  }

  /** Exclusive lock via O_EXCL create of `<file>.lock`; retries with jitter; sweeps stale locks. */
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const lock = `${this.file}.lock`;
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        const fh = await open(lock, "wx", 0o600);
        await fh.writeFile(String(process.pid));
        await fh.close();
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        try {
          const st = await stat(lock);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            await rm(lock, { force: true });
            continue;
          }
        } catch {
          continue; // the other process released it between our open and stat
        }
        if (Date.now() > deadline) throw new Error(`${lock} held by another process for more than ${LOCK_WAIT_MS / 1000}s; not paying`);
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 20));
      }
    }
    try {
      return await fn();
    } finally {
      await rm(lock, { force: true });
    }
  }
}

function sumDay(payments: PaymentRecord[], day: string): Atomic {
  let total = 0n;
  for (const p of payments) if (p.ts.slice(0, 10) === day) total += BigInt(p.amount_atomic);
  return total;
}

function prune(payments: PaymentRecord[], now: Date): PaymentRecord[] {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  return payments.filter((p) => p.ts >= cutoff);
}

function isSpendFile(v: unknown): v is SpendFile {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return o.version === 1 && Array.isArray(o.payments) && o.payments.every(isRecord);
}

function isRecord(v: unknown): v is PaymentRecord {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.ts === "string" &&
    typeof o.url === "string" &&
    typeof o.network === "string" &&
    typeof o.amount_atomic === "string" &&
    /^\d+$/.test(o.amount_atomic) &&
    typeof o.tx === "string" &&
    typeof o.status === "string"
  );
}
