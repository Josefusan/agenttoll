import type { FeedState } from "@/hooks/use-live-stats";

export function Header({ feed, lastEventAt, now }: { feed: FeedState; lastEventAt: number | null; now: number }) {
  return (
    <header className="flex items-center justify-between gap-4 py-5">
      <div className="flex items-center gap-3 min-w-0">
        <Mark />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-tight">AgentToll</span>
            <span className="text-[15px] text-ink-3">Revenue</span>
          </div>
          <p className="text-xs text-ink-3 truncate">Agents pay per request in USDC. Humans browse free.</p>
        </div>
      </div>
      <FeedPill feed={feed} lastEventAt={lastEventAt} now={now} />
    </header>
  );
}

function FeedPill({ feed, lastEventAt, now }: { feed: FeedState; lastEventAt: number | null; now: number }) {
  const text =
    feed === "live"
      ? lastEventAt && now - lastEventAt < 60_000
        ? "Live"
        : "Live, waiting for settlements"
      : feed === "connecting"
        ? "Connecting to gateway"
        : feed === "reconnecting"
          ? "Feed dropped, reconnecting"
          : "Feed offline, retrying";
  const dot = feed === "live" ? "bg-good live-dot" : feed === "offline" ? "bg-danger" : "bg-warn";
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-2 shrink-0"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span className="hidden sm:inline">{text}</span>
      <span className="sm:hidden">
        {feed === "live" ? "Live" : feed === "connecting" ? "Connecting" : feed === "reconnecting" ? "Reconnecting" : "Offline"}
      </span>
    </div>
  );
}

function Mark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="32" height="32" rx="9" fill="var(--surface-2)" stroke="var(--line-strong)" />
      <path d="M9 22.5h16" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M12 22V12.5a5 5 0 0 1 10 0V22" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="17" cy="11" r="2.2" fill="var(--accent)" />
    </svg>
  );
}
