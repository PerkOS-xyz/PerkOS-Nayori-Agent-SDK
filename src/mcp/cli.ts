#!/usr/bin/env node
import { constants, openSync, closeSync, fstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHermesMcp } from "./server.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("nayori-mcp --config /absolute/public-profile.json\nQA testnet read/prepare only. No signing, broadcast, x402 or private keys."); return;
  }
  if (args.length !== 2 || args[0] !== "--config" || !isAbsolute(args[1]!)) throw new Error("config_required");
  const fd = openSync(args[1]!, constants.O_RDONLY | constants.O_NOFOLLOW);
  let profile: unknown;
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.size > 4096) throw new Error("invalid_profile");
    profile = JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
  const server = createHermesMcp(profile);
  await server.connect(new StdioServerTransport());
}
main().catch(() => { console.error("Nayori MCP could not start. Supply a valid public QA profile; never include private keys."); process.exitCode = 1; });
