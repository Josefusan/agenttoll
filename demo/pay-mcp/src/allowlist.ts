// Which (network, asset) pairs this wallet will ever pay. Anything else is refused before cap checks,
// so a seller cannot swap in a different mint, a wrapped token, or a mainnet rail (KB-SOL-01, KB-BASE-01).

export interface AllowedNetwork {
  network: string;
  name: string;
  /** USDC on that network. EVM addresses compare case-insensitively. */
  asset: string;
  mainnet: boolean;
}

export const KNOWN_NETWORKS: readonly AllowedNetwork[] = [
  { network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", name: "Solana devnet", asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", mainnet: false },
  { network: "eip155:84532", name: "Base Sepolia", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", mainnet: false },
  { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", name: "Solana mainnet", asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", mainnet: true },
  { network: "eip155:8453", name: "Base", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", mainnet: true },
];

export type Allowlist = ReadonlyMap<string, AllowedNetwork>;

/** Devnet + Base Sepolia by default; mainnet rails only with PAY_MCP_ALLOW_MAINNET=1. */
export function allowlistFromEnv(env: NodeJS.ProcessEnv): Allowlist {
  const mainnet = env.PAY_MCP_ALLOW_MAINNET === "1";
  return new Map(KNOWN_NETWORKS.filter((n) => mainnet || !n.mainnet).map((n) => [n.network, n]));
}

export function assetAllowed(entry: AllowedNetwork, asset: string): boolean {
  return entry.network.startsWith("eip155:") ? entry.asset.toLowerCase() === asset.toLowerCase() : entry.asset === asset;
}
