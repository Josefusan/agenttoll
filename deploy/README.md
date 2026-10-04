# Deploying the AgentToll demo

Every payment on this stack is SIMULATED. The facilitator is `demo/mock-facilitator`, tx ids start with `SIMULATED-`, and nothing touches a chain. Do not describe these payments as on-chain.

Pieces: demo origin (4000), simulated facilitator (4020), gateway (8402 public, admin 8403 local only), dashboard (3000 in Docker, 3402 on the shared VPS).

The admin API (8403) must never be exposed. The dashboard has no login of its own, so publish it only with demo data.

## Path A: Docker compose (after someone runs the sudo Docker install)

```bash
cp .env.example .env
# set AGENTTOLL_SOLANA_PAYTO (public address only), AGENTTOLL_ADMIN_TOKEN (24+ chars),
# AGENTTOLL_PUBLIC_URL (the URL agents will use)
# On the shared VPS also set DASHBOARD_PORT=3402 (port 3000 belongs to another project).
docker compose up --build -d
docker compose ps
docker compose logs -f gateway
docker compose restart gateway     # restart one service
docker compose down                # stop
```

The compose gateway uses `deploy/agenttoll.docker.yaml`. The dashboard host port is `DASHBOARD_PORT` (default 3000).

## Path B: pm2 plus Cloudflare quick tunnels (no sudo, no Docker)

Needs: Rust release binaries, node, pnpm, pm2, cloudflared. Quick tunnels are outbound only, so the firewall stays closed.

### One-time setup

```bash
# 1. Build the binaries (CARGO_BUILD_JOBS=2 on the shared box)
cargo build --release -p agenttoll-gateway -p agenttoll-demo-origin -p agenttoll-mock-facilitator -p agenttoll-buyer

# 2. Secrets file outside git, mode 600. Never print it.
cat > ~/agenttoll-live.env <<'ENV'
AGENTTOLL_SOLANA_PAYTO=<public address>
AGENTTOLL_ADMIN_TOKEN=<24+ random chars>
AGENTTOLL_PUBLIC_URL=http://127.0.0.1:8402
AGENTTOLL_DATA_DIR=/home/<you>/agenttoll-data
ENV
chmod 600 ~/agenttoll-live.env
mkdir -p ~/agenttoll-data/logs

# 3. Build the dashboard
cd apps/dashboard
pnpm install --frozen-lockfile
AGENTTOLL_ADMIN_URL=http://127.0.0.1:8403 pnpm exec next build
cd ../..
```

### Start

```bash
pm2 start deploy/pm2.config.cjs
pm2 save
pm2 list
```

Override defaults with env vars before `pm2 start`: `AGENTTOLL_BIN` (binary dir), `AGENTTOLL_ENV_FILE`, `AGENTTOLL_DATA_DIR`, `CLOUDFLARED`, `AGENTTOLL_GATEWAY_PORT`, `AGENTTOLL_DASHBOARD_PORT`.

### Read the tunnel URLs

Quick tunnel URLs change every time a tunnel process restarts.

```bash
grep -ho 'https://[a-z0-9-]*\.trycloudflare\.com' ~/agenttoll-data/logs/at-tunnel-gw.err.log | tail -1     # gateway
grep -ho 'https://[a-z0-9-]*\.trycloudflare\.com' ~/agenttoll-data/logs/at-tunnel-dash.err.log | tail -1   # dashboard
```

### Point quotes at the gateway URL

The gateway quotes `public_url` as the resource URL in 402 responses. After a tunnel URL changes:

```bash
GW=$(grep -ho 'https://[a-z0-9-]*\.trycloudflare\.com' ~/agenttoll-data/logs/at-tunnel-gw.err.log | tail -1)
sed -i "s|^AGENTTOLL_PUBLIC_URL=.*|AGENTTOLL_PUBLIC_URL=$GW|" ~/agenttoll-live.env
pm2 restart at-gateway --update-env
pm2 save
```

### Restart and stop

```bash
pm2 restart at-gateway          # one process (its env file is re-read on restart)
pm2 restart all
pm2 restart at-tunnel-gw        # new gateway URL, then repeat "Point quotes" above
pm2 logs at-gateway --lines 50
pm2 stop at-origin at-facilitator at-gateway at-dashboard at-tunnel-gw at-tunnel-dash
pm2 resurrect                   # restore the saved list (after a pm2 kill or reboot)
```

pm2 does not start itself on reboot without `pm2 startup`, which needs sudo. After a reboot run `pm2 resurrect`, then re-read the tunnel URLs.

## Verify from outside the host

```bash
GW=https://<gateway-tunnel>.trycloudflare.com
curl -s -D - -o /dev/null -A "Mozilla/5.0 (compatible; ClaudeBot/1.0)" $GW/api/quote | grep -iE '^HTTP|^payment-required'   # 402
curl -s -o /dev/null -w '%{http_code}\n' -A "Mozilla/5.0 (Macintosh) Chrome/141" -H "Accept-Language: en" -H "Sec-Fetch-Mode: navigate" $GW/api/quote   # 200
curl -s $GW/.well-known/agenttoll.json
BUYER_SOLANA_KEYPAIR=/tmp/buyer.json target/release/agenttoll-buyer $GW/api/quote    # one SIMULATED paid request
```

Make a throwaway buyer key with `agenttoll-buyer --new-solana-keypair /tmp/buyer.json`. Do not fund it. The simulated facilitator does not check balances.

## Known caveat: Cloudflare blocks AI crawler user agents at its edge

On a trycloudflare.com quick tunnel, Cloudflare answers some well known AI crawler user agents (ClaudeBot, GPTBot, PerplexityBot) with its own `403 Your request was blocked.` before the request reaches the gateway (response header `server: cloudflare`, no `PAYMENT-REQUIRED`). The same user agents get the expected 402 when sent straight to the gateway on 127.0.0.1:8402. Other agent user agents (`Claude-User/1.0`, `AgentToll-Buyer`) get the 402 through the tunnel. For a demo through a quick tunnel, use one of those. A named Cloudflare tunnel on your own zone with the AI bot block turned off, or Path A with a real host, does not have this limit.
