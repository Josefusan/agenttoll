import type { StatsError } from "@/lib/types";

export function EmptyState({ gatewayUrl }: { gatewayUrl: string }) {
  const curl = `curl -i -A "ClaudeBot/1.0" ${gatewayUrl}/api/quote`;
  return (
    <div className="card px-6 py-8 sm:px-10 sm:py-12">
      <div className="max-w-2xl">
        <div className="label">No agent payments yet</div>
        <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">Point an agent at your gateway and this page fills itself.</h2>
        <p className="mt-3 text-sm text-ink-2 leading-relaxed">
          Humans who open your site still get the normal page. An agent hitting a priced route gets a <span className="font-mono">402</span>{" "}
          with the USDC price, pays, and the settlement shows up here within a second.
        </p>
        <ol className="mt-6 flex flex-col gap-4 text-sm">
          <Step n={1} title="See the challenge an agent sees">
            <Code>{curl}</Code>
          </Step>
          <Step n={2} title="Pay it with the demo buyer (devnet USDC)">
            <Code>{`cargo run -p agenttoll-buyer -- ${gatewayUrl}/api/quote`}</Code>
          </Step>
          <Step n={3} title="Or let Claude pay">
            <p className="text-ink-2">
              Add the <span className="font-mono">pay-mcp</span> server from <span className="font-mono">demo/</span> and ask Claude a question that
              needs your data. Its <span className="font-mono">pay_and_fetch</span> tool settles the request under the spend cap you set.
            </p>
          </Step>
        </ol>
      </div>
    </div>
  );
}

export function ErrorState({ error }: { error: StatsError }) {
  const copy: Record<StatsError["error"], { title: string; body: string }> = {
    not_configured: {
      title: "Dashboard is not pointed at a gateway yet",
      body: "Copy apps/dashboard/.env.example to .env.local and set AGENTTOLL_ADMIN_URL and AGENTTOLL_ADMIN_TOKEN, then restart.",
    },
    gateway_unreachable: {
      title: "Gateway admin API is unreachable",
      body: "Check that agenttoll-gateway is running and that admin_listen in agenttoll.yaml matches AGENTTOLL_ADMIN_URL.",
    },
    gateway_error: {
      title: "Gateway answered, but not with stats",
      body: "Usually a wrong AGENTTOLL_ADMIN_TOKEN (401) or a gateway build older than the admin API.",
    },
  };
  const c = copy[error.error];
  return (
    <div className="card px-6 py-8 sm:px-10 sm:py-10 border-[rgba(224,168,74,0.35)]">
      <div className="label text-warn">Not connected</div>
      <h2 className="mt-2 text-xl sm:text-2xl font-semibold tracking-tight">{c.title}</h2>
      <p className="mt-2 text-sm text-ink-2 leading-relaxed max-w-2xl">{c.body}</p>
      <p className="mt-3 font-mono text-xs text-ink-3 break-all">{error.detail}</p>
      <p className="mt-5 text-sm text-ink-2">
        No gateway handy? Run the fixture: <Code inline>pnpm fixture</Code> then set <Code inline>AGENTTOLL_ADMIN_URL=http://127.0.0.1:8403</Code>{" "}
        and <Code inline>AGENTTOLL_ADMIN_TOKEN=fixture-token</Code>.
      </p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-3">
      <span className="num flex h-7 w-7 items-center justify-center rounded-full border border-accent-line bg-accent-soft text-xs font-semibold text-accent-ink">
        {n}
      </span>
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <div className="mt-1.5">{children}</div>
      </div>
    </li>
  );
}

function Code({ children, inline = false }: { children: React.ReactNode; inline?: boolean }) {
  if (inline) return <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-ink">{children}</code>;
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-bg px-3.5 py-2.5 font-mono text-[12.5px] text-ink-2 leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}
