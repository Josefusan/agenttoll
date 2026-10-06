# Stable demo URL plan

Status: plan only. Nothing here was run. Written 2026-10-04 by the D11 launch-kit run.

The live demo currently runs on Cloudflare **quick tunnels**. They need no account and no sudo, but
the hostname is random and changes on every tunnel restart, which the judges named as a gap.

Facts checked on the VPS on 2026-10-04:

```
which cloudflared        -> /home/joseph/bin/cloudflared
cloudflared --version    -> cloudflared version 2026.9.3 (built 2026-09-24-16:07 UTC)
cloudflared tunnel login --help -> "Generate a configuration file with your login details"
ls ~/.cloudflared        -> No such file or directory          (no certificate yet)
pm2 describe at-tunnel-gw   -> tunnel --no-autoupdate --url http://127.0.0.1:8402
pm2 describe at-tunnel-dash -> tunnel --no-autoupdate --url http://127.0.0.1:3402
```
Ports behind the tunnels: gateway `127.0.0.1:8402`, dashboard `127.0.0.1:3402`. Port 3000 belongs to
pumpwire and is untouched by all three options.

## Option A — named Cloudflare tunnel on a domain you control in Cloudflare (recommended)

A named tunnel gets a permanent hostname (`gw.<domain>`) and survives restarts. No sudo.

Who runs it: **you (Joseph)**, because `cloudflared tunnel login` needs a browser. No sudo.

```bash
# 1. Authorise a zone you own in your Cloudflare account (opens a browser URL).
cloudflared tunnel login

# 2. Create the tunnel; this writes ~/.cloudflared/<UUID>.json (a secret, mode 600).
cloudflared tunnel create agenttoll

# 3. Point DNS at it (repeat for the dashboard hostname).
cloudflared tunnel route dns agenttoll gw.<your-domain>
cloudflared tunnel route dns agenttoll dash.<your-domain>

# 4. Write ~/.cloudflared/config.yml:
#    tunnel: agenttoll
#    credentials-file: /home/joseph/.cloudflared/<UUID>.json
#    ingress:
#      - hostname: gw.<your-domain>
#        service: http://127.0.0.1:8402
#      - hostname: dash.<your-domain>
#        service: http://127.0.0.1:3402
#      - service: http_status:404

# 5. Replace the two quick-tunnel processes with one named-tunnel process.
pm2 delete at-tunnel-gw at-tunnel-dash
pm2 start "cloudflared tunnel --no-autoupdate run agenttoll" --name at-tunnel --cwd /home/joseph
pm2 save

# 6. Update the live URLs and the tracked copies.
#    Edit ~/Hackathons/AgentToll-LIVE.txt to the two https://gw./dash. hostnames, then:
bash scripts/refresh-live-urls.sh --apply
```

Time: about 10–15 minutes, mostly the browser login and DNS. Riskiest bit: the tunnel credentials
file (`~/.cloudflared/<UUID>.json`) is a secret — keep it out of every repo, report and log.

Risk: needs a domain already on Cloudflare. If you do not have one, register/transfer one first
(that is the only part with a cost). Cloudflare Access can lock the dashboard hostname later.

## Option B — direct on the VPS IP behind a reverse proxy, with `ufw allow`

Skip the tunnel and serve TLS on the VPS itself. This is the only option needing **sudo**, and it
needs a DNS A record pointing a domain at `13.140.171.233`.

Who runs it: **you, with sudo** (interactive `ssh -t`). An agent cannot (no sudo).

```bash
# DNS: an A record  gw.<your-domain> -> 13.140.171.233
ssh -t joseph@13.140.171.233
sudo apt-get install -y caddy            # reverse proxy + automatic Let's Encrypt TLS
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp

# /etc/caddy/Caddyfile:
#   gw.<your-domain>   { reverse_proxy 127.0.0.1:8402 }
#   dash.<your-domain> { reverse_proxy 127.0.0.1:3402 }
sudo systemctl reload caddy
```
Then `pm2 delete at-tunnel-gw at-tunnel-dash; pm2 save`, and point `AgentToll-LIVE.txt` at the new
hostnames.

Time: about 20–30 minutes. Risks: opens the host to the public internet (new attack surface), needs a
domain and certificate renewal, and puts the payment path directly on the box. Do **not** reuse or
disturb port 3000 (pumpwire) or any `pumpwire-*` process. This option is heavier than A for the same
result.

## Option C — keep quick tunnels, refresh on submit day (fallback)

No setup. The URL is re-read whenever the tunnel restarts.

Who runs it: you or an agent.

```bash
pm2 restart at-tunnel-gw at-tunnel-dash
grep -h 'https://[a-z0-9-]*\.trycloudflare\.com' ~/agenttoll/data/logs/at-tunnel-gw.err.log | tail -1
bash scripts/refresh-live-urls.sh --check     # exits 1 on a stale or dead URL
bash scripts/refresh-live-urls.sh --apply     # rewrites tracked copies; does not commit
```

Time: about 2 minutes. Risks: the public URL changes on every restart and after a reboot, and nothing
restarts pm2 automatically (`pm2 resurrect` first if the host rebooted). A dead URL mid-judging is the
real risk; `refresh-live-urls.sh --check` catches it before you submit.

## Recommendation

**Option A.** It gives a permanent `gw.<domain>` URL, needs no sudo, keeps the payment path on
localhost behind Cloudflare, and reuses the existing ports (8402/3402). Do it before recording the
demo, then `refresh-live-urls.sh --apply`. Until the named tunnel is up, use **Option C** so today's
submit-day check still passes. **Option B** only if a Cloudflare-managed domain is impossible; it is
the most work and the largest new attack surface for no extra benefit.
