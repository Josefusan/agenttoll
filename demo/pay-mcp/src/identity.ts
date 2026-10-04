import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export const VERSION: string = pkg.version;

/**
 * Self-declared agent identity. The AgentToll detector already lists `AgentToll-Buyer` as an
 * agent token, so this UA is quoted a price without any gateway change.
 */
export const USER_AGENT = `AgentToll-Buyer/pay-mcp ${VERSION} (+https://github.com/Josefusan/agenttoll)`;

export const AGENT_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent": USER_AGENT,
  "X-Agent-Name": "pay-mcp",
};
