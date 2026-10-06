# Skills

Agent Skills layout (`<name>/SKILL.md` with `name` + `description` frontmatter). Load on demand; do not paste into memory.

## Project skills (in this repo)

| Skill | Use for | Primary agent |
|---|---|---|
| [x402-protocol](x402-protocol/SKILL.md) | x402 v2 headers, payloads, verify/settle order | payments, proxy, critic |
| [agenttoll-proxy-rust](agenttoll-proxy-rust/SKILL.md) | Rust gateway build | proxy |
| [agenttoll-worker-edge](agenttoll-worker-edge/SKILL.md) | Cloudflare Worker edition | proxy |
| [solana-usdc-settlement](solana-usdc-settlement/SKILL.md) | Solana devnet USDC, Kora, explorer | payments |
| [agent-detection](agent-detection/SKILL.md) | Human vs agent classification | proxy |
| [paid-mcp-tools](paid-mcp-tools/SKILL.md) | Per-MCP-tool pricing | proxy, demo |
| [revenue-dashboard](revenue-dashboard/SKILL.md) | Dashboard + admin API | dashboard |
| [claude-buyer-demo](claude-buyer-demo/SKILL.md) | Claude pays on camera | demo |
| [critic-gate](critic-gate/SKILL.md) | Pre-merge review | critic |
| [colosseum-submission](colosseum-submission/SKILL.md) | Form, videos, checklist | launch |
| [hackathon-distribution](hackathon-distribution/SKILL.md) | Build-in-public posts | launch |
| [skillbox-router](skillbox-router/SKILL.md) | Route a task to skills (vendored from Skillbox, MIT) | orchestrator |
| [skills-library](skills-library/SKILL.md) | Skillbox discovery protocol (vendored, MIT) | orchestrator |
| [production-architecture-audit](production-architecture-audit/SKILL.md) | Boundary ladder (levels 0-3) and the six-pillar production-grade scorecard | architect, critic |

## Imported skill packs (pulled locally, not committed)

`bash scripts/import-skills.sh` links the project skills into `.claude/skills/` and pulls these packs (gitignored, because they are private or third-party):

| Pack | Repo | Skills pulled | Why it helps win |
|---|---|---|---|
| Skillbox | [Josefusan/skillbox](https://github.com/Josefusan/skillbox) (public) | `typesafe-ai`, john-peslar `hormozi-pitch`, `offer-stack-builder`, `founder-content-engine` | Skill routing; typed AI decisions; pitch and offer framing for the video and accelerator application |
| Distribution playbook | [Josefusan/distribution-playbook](https://github.com/Josefusan/distribution-playbook) (private) | `distribution-first-strategy`, `platform-growth-playbooks`, `brand-voice-and-authentic-ai-writing`, `taste-over-slop`, `coding-agents-and-knowledge-systems`, `context-engineering-profiles` | Launch and build-in-public method; voice and taste rules for judge-facing copy; agent context design |

The private pack needs your own GitHub auth (`gh auth login`) on the machine that runs the script.
