import { readFile, stat } from "node:fs/promises";

import { x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { ExactSvmScheme } from "@x402/svm";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { privateKeyToAccount } from "viem/accounts";

import type { Allowlist } from "./allowlist.js";
import type { Namespace } from "./quote.js";

/** The one thing the payer needs from a wallet: turn a challenge into a signed payload. */
export interface PaymentSigner {
  createPaymentPayload(paymentRequired: PaymentRequired): Promise<PaymentPayload>;
}

export interface Wallet {
  signer: PaymentSigner;
  /** CAIP namespaces this wallet can pay on: "solana" and/or "eip155". */
  namespaces: ReadonlySet<string>;
  preferred: Namespace;
  addresses: { solana?: string; base?: string };
  /** Exact CAIP-2 networks registered with the SDK (never wildcards). */
  networks: string[];
  warnings: string[];
}

export class WalletError extends Error {}

const DEVNET_RPC = "https://api.devnet.solana.com";

/** Builds the x402 client from env. Keys are read from files / env and never logged or returned. */
export async function loadWallet(env: NodeJS.ProcessEnv, allowlist: Allowlist): Promise<Wallet> {
  const client = new x402Client();
  const namespaces = new Set<string>();
  const addresses: Wallet["addresses"] = {};
  const networks: string[] = [];
  const warnings: string[] = [];
  const allowed = (ns: string) => [...allowlist.keys()].filter((n) => n.startsWith(`${ns}:`));

  const keypairPath = env.BUYER_SOLANA_KEYPAIR;
  if (keypairPath) {
    const modeWarning = await keyFileModeWarning(keypairPath);
    if (modeWarning) warnings.push(modeWarning);
    const svmSigner = await createKeyPairSignerFromBytes(await readSolanaKeypair(keypairPath));
    const scheme = new ExactSvmScheme(svmSigner, { rpcUrl: env.SOLANA_RPC_URL ?? DEVNET_RPC });
    for (const n of allowed("solana")) {
      client.register(n as `${string}:${string}`, scheme);
      networks.push(n);
    }
    namespaces.add("solana");
    addresses.solana = svmSigner.address;
  }

  const evmKey = env.BUYER_EVM_PRIVATE_KEY;
  if (evmKey) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(evmKey)) {
      throw new WalletError("BUYER_EVM_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string");
    }
    const account = privateKeyToAccount(evmKey as `0x${string}`);
    const scheme = new ExactEvmScheme(account);
    for (const n of allowed("eip155")) {
      client.register(n as `${string}:${string}`, scheme);
      networks.push(n);
    }
    namespaces.add("eip155");
    addresses.base = account.address;
  }

  if (namespaces.size === 0) {
    throw new WalletError(
      "no wallet configured: set BUYER_SOLANA_KEYPAIR (path to a solana-keygen JSON file) and/or BUYER_EVM_PRIVATE_KEY",
    );
  }
  for (const w of warnings) console.error(`pay-mcp warning: ${w}`);
  return { signer: client, namespaces, preferred: preferredNamespace(env), addresses, networks, warnings };
}

export function preferredNamespace(env: NodeJS.ProcessEnv): Namespace {
  const raw = (env.PAY_MCP_NETWORK ?? "solana").toLowerCase();
  if (raw === "solana") return "solana";
  if (raw === "base" || raw === "eip155") return "eip155";
  throw new WalletError(`PAY_MCP_NETWORK must be "solana" or "base", got ${JSON.stringify(raw)}`);
}

/** A key file readable by group or others is a warning, not an error: the demo must still run. */
export async function keyFileModeWarning(path: string): Promise<string | undefined> {
  try {
    const st = await stat(path);
    if (process.platform !== "win32" && (st.mode & 0o077) !== 0) {
      return `${path} is readable by other users (mode ${(st.mode & 0o777).toString(8)}); run: chmod 600 ${path}`;
    }
  } catch {
    // readSolanaKeypair reports the missing file
  }
  return undefined;
}

/** solana-keygen writes a JSON array of 64 bytes (32 secret + 32 public). */
async function readSolanaKeypair(path: string): Promise<Uint8Array> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new WalletError(`cannot read BUYER_SOLANA_KEYPAIR ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WalletError(`${path} is not a solana-keygen JSON byte array`);
  }
  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) {
    throw new WalletError(`${path} must hold exactly 64 bytes as a JSON array`);
  }
  return new Uint8Array(parsed as number[]);
}
