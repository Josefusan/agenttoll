// Atomic USDC integers everywhere in code; dollars only at the moment of display.

const USDC_DECIMALS = 6;

/** 2000 -> "$0.002", 1_250_000 -> "$1.25", 0 -> "$0.00". */
export function atomicToUsd(atomic: number): string {
  const sign = atomic < 0 ? "-" : "";
  const dollars = Math.abs(atomic) / 10 ** USDC_DECIMALS;
  if (dollars >= 1) {
    return `${sign}$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const trimmed = dollars.toFixed(USDC_DECIMALS).replace(/0+$/, "");
  const decimals = trimmed.split(".")[1] ?? "";
  return `${sign}$${dollars.toFixed(Math.max(2, decimals.length))}`;
}

export function compactInt(n: number): string {
  return n.toLocaleString("en-US");
}

export type NetworkInfo = {
  label: string;
  short: string;
  family: "solana" | "base" | "other";
  testnet: boolean;
  explorer: ((sig: string) => string) | null;
};

// CAIP-2 ids. Solana devnet genesis hash starts EtWT..., mainnet 5eykt...
export function networkInfo(network: string): NetworkInfo {
  if (network.startsWith("solana:EtWT")) {
    return {
      label: "Solana devnet",
      short: "Solana",
      family: "solana",
      testnet: true,
      explorer: (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`,
    };
  }
  if (network.startsWith("solana:5eykt")) {
    return {
      label: "Solana",
      short: "Solana",
      family: "solana",
      testnet: false,
      explorer: (s) => `https://explorer.solana.com/tx/${s}`,
    };
  }
  if (network === "eip155:84532") {
    return {
      label: "Base Sepolia",
      short: "Base",
      family: "base",
      testnet: true,
      explorer: (h) => `https://sepolia.basescan.org/tx/${h}`,
    };
  }
  if (network === "eip155:8453") {
    return {
      label: "Base",
      short: "Base",
      family: "base",
      testnet: false,
      explorer: (h) => `https://basescan.org/tx/${h}`,
    };
  }
  if (network.startsWith("solana:")) {
    return { label: "Solana (other cluster)", short: "Solana", family: "solana", testnet: true, explorer: null };
  }
  return { label: network, short: network, family: "other", testnet: true, explorer: null };
}

export function truncateMiddle(s: string, head = 6, tail = 6): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function absoluteTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function agentLabel(name: string | null): string {
  return name && name.trim().length > 0 ? name : "Unknown agent";
}
