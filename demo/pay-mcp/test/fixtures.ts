import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";

export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"; // KB-SOL-01
export const BASE_SEPOLIA = "eip155:84532"; // KB-BASE-01

export const solanaReq: PaymentRequirements = {
  scheme: "exact",
  network: SOLANA_DEVNET,
  amount: "2000",
  asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  payTo: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  maxTimeoutSeconds: 60,
  extra: { feePayer: "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" },
};

export const baseReq: PaymentRequirements = {
  scheme: "exact",
  network: BASE_SEPOLIA,
  amount: "2000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2" },
};

export function paymentRequired(accepts: PaymentRequirements[] = [solanaReq, baseReq], error?: string): PaymentRequired {
  const pr: PaymentRequired = {
    x402Version: 2,
    resource: { url: "http://localhost:8402/api/quote", description: "Live price quote", mimeType: "application/json" },
    accepts,
  };
  if (error) pr.error = error;
  return pr;
}
