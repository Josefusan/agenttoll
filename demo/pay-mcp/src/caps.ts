import { type Atomic, formatUsd, minAtomic, usdToAtomic } from "./money.js";

export interface Caps {
  /** Hard ceiling for one payment (BUYER_MAX_USD_PER_CALL, default $0.01). */
  perCall: Atomic;
  /** Hard ceiling for one UTC day (BUYER_MAX_USD_PER_DAY, default $0.25). */
  perDay: Atomic;
}

export const DEFAULT_CAPS = { perCall: "0.01", perDay: "0.25" } as const;

export function capsFromEnv(env: NodeJS.ProcessEnv): Caps {
  return {
    perCall: usdToAtomic(env.BUYER_MAX_USD_PER_CALL ?? DEFAULT_CAPS.perCall),
    perDay: usdToAtomic(env.BUYER_MAX_USD_PER_DAY ?? DEFAULT_CAPS.perDay),
  };
}

export type CapCode = "per_call" | "max_usd" | "per_day";

export type CapVerdict =
  | { ok: true; limit: Atomic }
  | { ok: false; code: CapCode; limit: Atomic; reason: string };

export interface CapInput {
  caps: Caps;
  /** The caller's own ceiling for this call; the lower of it and caps.perCall wins. */
  maxUsd?: Atomic;
  spentToday: Atomic;
}

/** Decides whether `amount` may be paid. Pure: nothing is signed or written here. */
export function checkCaps(amount: Atomic, input: CapInput): CapVerdict {
  const { caps, maxUsd, spentToday } = input;
  const limit = maxUsd === undefined ? caps.perCall : minAtomic(maxUsd, caps.perCall);
  if (amount > limit) {
    const bound: CapCode = maxUsd !== undefined && maxUsd < caps.perCall ? "max_usd" : "per_call";
    const label = bound === "max_usd" ? "max_usd for this call" : "BUYER_MAX_USD_PER_CALL";
    return {
      ok: false,
      code: bound,
      limit,
      reason: `quote ${formatUsd(amount)} is above ${label} (${formatUsd(limit)}); not paid`,
    };
  }
  if (spentToday + amount > caps.perDay) {
    const remaining = caps.perDay > spentToday ? caps.perDay - spentToday : 0n;
    return {
      ok: false,
      code: "per_day",
      limit,
      reason: `quote ${formatUsd(amount)} would exceed BUYER_MAX_USD_PER_DAY (${formatUsd(caps.perDay)}); ${formatUsd(spentToday)} spent today, ${formatUsd(remaining)} left; not paid`,
    };
  }
  return { ok: true, limit };
}
