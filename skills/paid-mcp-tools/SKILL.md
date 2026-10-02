---
name: paid-mcp-tools
description: Price individual MCP tools behind AgentToll: inspect Streamable HTTP JSON-RPC bodies, charge per tools/call, keep discovery free, return proper errors to MCP clients. Use when touching mcp.rs or the demo MCP origin.
---
# Paid MCP tools

Retrieve KB-X402-05.

- Endpoint from config `mcp.endpoint`. Only POST bodies are inspected.
- Free: `initialize`, `notifications/*`, `tools/list`, `resources/list`, `prompts/list`, `ping`.
- Priced: `tools/call` → price = `mcp.tools[params.name]` or `default_tool_price_usd`.
- Batched JSON-RPC arrays: sum prices of all `tools/call` entries.
- Unpaid priced call → HTTP 402 with PAYMENT-REQUIRED (resource = `mcp:<tool>`). MCP clients with an x402-aware transport pay and retry; others see the 402.
- Add tool prices to the `tools/list` response as `annotations` or description suffix ("$0.005 per call via x402") so agents can plan spend. Do this by rewriting the JSON response from origin only when `mcp.advertise_prices: true`.
- If the x402 spec defines an MCP-native payment transport, implement it as an alternative path (VERIFY in KB-X402-05).
