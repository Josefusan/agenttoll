// USDC has 6 decimals on Solana and Base (KB-AMT-01). All money here is a bigint of atomic units.

export const USDC_DECIMALS = 6;
const SCALE = 10n ** BigInt(USDC_DECIMALS);

export type Atomic = bigint;

export class MoneyError extends Error {}

/** "0.002", "$0.002", 0.002 -> 2000n. Strings are parsed exactly; a number is formatted to 6 decimals first. */
export function usdToAtomic(input: string | number): Atomic {
  const text = typeof input === "number" ? numberToDecimal(input) : input.trim();
  const m = /^\$?(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!m) {
    throw new MoneyError(`not a USD amount with at most ${USDC_DECIMALS} decimals: ${JSON.stringify(input)}`);
  }
  const whole = BigInt(m[1] ?? "0");
  const frac = BigInt((m[2] ?? "").padEnd(USDC_DECIMALS, "0"));
  return whole * SCALE + frac;
}

function numberToDecimal(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new MoneyError(`not a USD amount: ${n}`);
  // The only float in this module. It only ever formats a cap typed by a person or a model,
  // never an amount that goes on chain; those arrive as atomic strings.
  return n.toFixed(USDC_DECIMALS);
}

/** Atomic string from a PaymentRequirements.amount. Rejects anything that is not a plain integer. */
export function parseAtomic(amount: unknown): Atomic {
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    throw new MoneyError(`amount is not an atomic integer string: ${JSON.stringify(amount)}`);
  }
  return BigInt(amount);
}

/** 2000n -> "0.002"; 1_000_000n -> "1". */
export function atomicToUsd(a: Atomic): string {
  if (a < 0n) throw new MoneyError("negative amount");
  const whole = a / SCALE;
  const frac = (a % SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function formatUsd(a: Atomic): string {
  return `$${atomicToUsd(a)}`;
}

export function minAtomic(a: Atomic, b: Atomic): Atomic {
  return a < b ? a : b;
}
