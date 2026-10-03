import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_MAX_BODY_BYTES, maxBodyBytesFromEnv } from "../src/config.js";
import { keyFileModeWarning } from "../src/wallet.js";

describe("PAY_MCP_MAX_BODY_BYTES", () => {
  it("falls back to the default on junk", () => {
    expect(maxBodyBytesFromEnv({})).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(maxBodyBytesFromEnv({ PAY_MCP_MAX_BODY_BYTES: "lots" })).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(maxBodyBytesFromEnv({ PAY_MCP_MAX_BODY_BYTES: "0" })).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(maxBodyBytesFromEnv({ PAY_MCP_MAX_BODY_BYTES: "-5" })).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(maxBodyBytesFromEnv({ PAY_MCP_MAX_BODY_BYTES: "4096" })).toBe(4096);
  });
});

describe("key file permissions", () => {
  it("warns when the keypair is group or world readable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pay-mcp-key-"));
    try {
      const file = join(dir, "k.json");
      await writeFile(file, "[]", { mode: 0o644 });
      await chmod(file, 0o644);
      expect(await keyFileModeWarning(file)).toMatch(/readable by other users .*chmod 600/);
      await chmod(file, 0o600);
      expect(await keyFileModeWarning(file)).toBeUndefined();
      expect(await keyFileModeWarning(join(dir, "missing.json"))).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
