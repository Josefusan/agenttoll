// Child process for the cross-process ledger tests: reserve `count` payments of `amount` against `perDay`.
import { SpendLedger } from "../../src/spend.js";

const [file, count, amount, perDay] = process.argv.slice(2);
if (!file || !count || !amount || !perDay) throw new Error("usage: hammer <file> <count> <amountAtomic> <perDayAtomic>");
const ledger = new SpendLedger(file);
let ok = 0;
for (let i = 0; i < Number(count); i++) {
  const r = await ledger.reserve({ amount: BigInt(amount), caps: { perCall: BigInt(amount), perDay: BigInt(perDay) }, url: `http://x/${process.pid}/${i}`, network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", asset: "USDC" });
  if (r.ok) ok++;
}
process.stdout.write(String(ok));
