import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { type Atomic } from "./money.js";

export type PaymentStatus =
  /** Facilitator reported success with a transaction id. */
  | "settled"
  /** The signed payment was sent but no receipt came back; counted as spent to stay under the cap. */
  | "unknown"
  /** Gateway answered with a SIMULATED transaction id: nothing moved on chain. Counted anyway. */
  | "simulated";

export interface PaymentRecord {
  ts: string;
  url: string;
  tool?: string;
  network: string;
  asset: string;
  amount_atomic: string;
  payer?: string;
  tx: string;
  status: PaymentStatus;
}

interface SpendFile {
  version: 1;
  payments: PaymentRecord[];
}

const RETENTION_DAYS = 90;

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function defaultSpendPath(env: NodeJS.ProcessEnv): string {
  const configured = env.PAY_MCP_SPEND_FILE;
  if (configured && configured.length > 0) return configured.replace(/^~(?=$|\/)/, homedir());
  return join(homedir(), ".agenttoll", "spend.json");
}

/** Append-only JSON file of payments. Every write goes to a temp file and is renamed into place. */
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
    const day = utcDay(this.now());
    let total = 0n;
    for (const p of await this.load()) {
      if (p.ts.slice(0, 10) === day) total += BigInt(p.amount_atomic);
    }
    return total;
  }

  async record(rec: Omit<PaymentRecord, "ts">): Promise<PaymentRecord> {
    const payments = await this.load();
    const full: PaymentRecord = { ts: this.now().toISOString(), ...rec };
    payments.push(full);
    await this.write(prune(payments, this.now()));
    return full;
  }

  async last(n: number): Promise<PaymentRecord[]> {
    const all = await this.load();
    return all.slice(-n).reverse();
  }

  private async write(payments: PaymentRecord[]): Promise<void> {
    const body: SpendFile = { version: 1, payments };
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, this.file);
  }
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
    typeof o.ts === "string" &&
    typeof o.url === "string" &&
    typeof o.network === "string" &&
    typeof o.amount_atomic === "string" &&
    /^\d+$/.test(o.amount_atomic) &&
    typeof o.tx === "string"
  );
}
