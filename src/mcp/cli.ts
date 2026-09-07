#!/usr/bin/env node
import { constants, openSync, closeSync, fstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHermesMcp, parseProfile } from "./server.js";
import { custodyPort } from "../custody/socket.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("nayori-mcp --config /absolute/public-profile.json [--custody-socket /ipc/nayori.sock --permit-hash SHA256 [--enable-qa-evaluation]]\nDefault: QA read/prepare only. Evaluation requires provider custody. Never provide private keys to MCP."); return;
  }
  const enableEvaluation = args.at(-1) === "--enable-qa-evaluation";
  if (enableEvaluation) args.pop();
  if (![2, 6].includes(args.length) || args[0] !== "--config" || !isAbsolute(args[1]!) ||
    args.length === 6 && (args[2] !== "--custody-socket" || args[4] !== "--permit-hash")) throw new Error("config_required");
  const fd = openSync(args[1]!, constants.O_RDONLY | constants.O_NOFOLLOW);
  let profile: unknown;
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.size > 4096) throw new Error("invalid_profile");
    profile = JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
  const parsed = parseProfile(profile);
  const custody = args.length === 6 ? custodyPort(args[3]!, args[5]!, parsed) : undefined;
  const server = createHermesMcp(parsed, undefined, custody, enableEvaluation);
  await server.connect(new StdioServerTransport());
}
main().catch(() => { console.error("Nayori MCP could not start. Supply a valid public QA profile; never include private keys."); process.exitCode = 1; });
