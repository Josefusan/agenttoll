# Decisions log

| Date | Decision | Why | Alternatives considered |
|---|---|---|---|
| 2026-10-02 | Rust gateway is the primary build; Cloudflare Worker is a second edition | Performance, single binary, Website Factory VPS hosting; Worker covers Cloudflare users | Worker-only (locks to Cloudflare), Node proxy (slower, less differentiated) |
| 2026-10-02 | Solana primary, Base secondary | Colosseum Solana track; Solana leads weekly x402 volume (KB-MKT-01); Base has mature EVM x402 tooling | Solana only, Base only |
| 2026-10-02 | Default detection mode `agents-only` | Humans must never see a paywall; spoofed bot UAs only get a price quote | Charge all requests |
| 2026-10-02 | Settle only after origin 2xx | Agents should not pay for errors; builds trust | Settle before forwarding |
| 2026-10-02 | Non-custodial: funds go straight to founder `payTo` | No money-transmitter risk; simpler trust story | Pooled account with payouts |
