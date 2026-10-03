import { Badge } from "./card";
import { absoluteTime, agentLabel, atomicToUsd, networkInfo, timeAgo, truncateMiddle } from "@/lib/format";
import { eventKey, hasOnChainProof, isSimulated, settlementStatus, type RevenueEvent } from "@/lib/types";

export function LiveFeed({
  events,
  fresh,
  now,
  limit = 12,
}: {
  events: RevenueEvent[];
  fresh: Set<string>;
  now: number;
  limit?: number;
}) {
  if (events.length === 0) {
    return <p className="text-sm text-ink-3 py-8 text-center">Settlements appear here within a second of landing.</p>;
  }
  return (
    <ul className="-mx-2 flex flex-col">
      {events.slice(0, limit).map((e) => (
        <FeedRow key={eventKey(e)} e={e} fresh={fresh.has(eventKey(e))} now={now} />
      ))}
    </ul>
  );
}

function FeedRow({ e, fresh, now }: { e: RevenueEvent; fresh: boolean; now: number }) {
  const net = networkInfo(e.network);
  const status = settlementStatus(e);
  const explorer = hasOnChainProof(e) && net.explorer ? net.explorer(e.tx_signature) : null;
  const sig = e.tx_signature.replace(/^unconfirmed:/, "");

  return (
    <li
      className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 border-b border-line last:border-b-0 ${
        fresh ? "row-enter" : ""
      }`}
    >
      <span className="num text-[15px] font-semibold text-accent-ink w-[4.5rem]">+{atomicToUsd(e.amount_atomic)}</span>

      <span className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium truncate max-w-[12rem]">{agentLabel(e.agent_name)}</span>
        <span className="font-mono text-[12.5px] text-ink-2 truncate max-w-[14rem]">
          {e.mcp_tool ? `mcp ${e.mcp_tool}` : e.route}
        </span>
        <Badge tone={net.family === "solana" ? "accent" : net.family === "base" ? "base" : "neutral"}>{net.label}</Badge>
        {isSimulated(e) && (
          <Badge tone="warn" title="Paid through the local simulated facilitator. No on-chain transaction exists.">
            Simulated
          </Badge>
        )}
        {status === "pending" && (
          <Badge tone="neutral" title="Broadcast, confirming. The explorer link shows the transaction as it lands.">
            Pending
          </Badge>
        )}
        {status === "unconfirmed" && (
          <Badge tone="danger" title="Facilitator settle timed out after the content was served. The payment may not have landed.">
            Unconfirmed
          </Badge>
        )}
      </span>

      <span className="text-right text-xs text-ink-3 flex flex-col items-end gap-0.5 shrink-0">
        <time dateTime={new Date(e.ts).toISOString()} title={absoluteTime(e.ts)}>
          {timeAgo(e.ts, now)}
        </time>
        {explorer ? (
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-accent-ink hover:underline"
            title={status === "pending" ? "Broadcast, confirming. Open in explorer." : `Open ${e.tx_signature} in explorer`}
          >
            {truncateMiddle(e.tx_signature, 4, 4)} ↗
          </a>
        ) : (
          <span className="font-mono text-ink-3" title={status === "unconfirmed" ? "No on-chain proof yet" : "No explorer link for simulated payments"}>
            {truncateMiddle(sig, 4, 4)}
          </span>
        )}
      </span>
    </li>
  );
}
