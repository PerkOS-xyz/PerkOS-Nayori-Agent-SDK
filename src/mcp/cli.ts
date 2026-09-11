#!/usr/bin/env node
import { constants, openSync, closeSync, fstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNayoriMcp, parseProfile } from "./server.js";
import { custodyPort } from "../custody/socket.js";
import { createEvidenceTokenProvider, createMcpPrivateEvidence } from "./private-evidence.js";

function file(path: string, secret = false): unknown {
  if (!isAbsolute(path)) throw new Error("absolute_path_required");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.size > 8192 || secret && (s.mode & 0o077) !== 0) throw new Error("invalid_file");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("nayori-mcp --config /absolute/public-profile.json [--custody-socket /ipc/nayori.sock --permit-hash SHA256] [--private-evidence-client /absolute/mode-600.json] [--enable-qa-evaluation] [--enable-job-discovery]\nDefault: QA read/prepare only. Private evidence uses a wallet-linked OAuth client, never a wallet key. Never provide private keys to MCP."); return;
  }
  const values = new Map<string, string>(), flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--enable-job-discovery", "--enable-qa-evaluation"].includes(arg)) { if (flags.has(arg)) throw Error("duplicate_flag"); flags.add(arg); continue; }
    if (!["--config", "--custody-socket", "--permit-hash", "--private-evidence-client"].includes(arg) || values.has(arg) || !args[i + 1]) throw Error("invalid_argument");
    values.set(arg, args[++i]!);
  }
  const configPath = values.get("--config"); if (!configPath) throw new Error("config_required");
  const profile = file(configPath);
  const parsed = parseProfile(profile);
  const socket = values.get("--custody-socket"), permit = values.get("--permit-hash");
  if (Boolean(socket) !== Boolean(permit)) throw Error("custody_pair_required");
  const custody = socket && permit ? custodyPort(socket, permit, parsed) : undefined;
  let privateEvidence;
  const privatePath = values.get("--private-evidence-client");
  if (privatePath) {
    const value = file(privatePath, true);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid_private_evidence_credentials");
    const c = value as Record<string, unknown>;
    const required = parsed.role === "provider" ? ["evidence:read", "evidence:write"] : ["evidence:read"];
    if (c.walletAddress !== (parsed.role === "provider" ? parsed.provider : parsed.client) ||
      !Array.isArray(c.scopes) || c.scopes.join(" ") !== required.join(" ") ||
      typeof c.clientId !== "string" || typeof c.clientSecret !== "string" || typeof c.tokenEndpoint !== "string") throw Error("invalid_private_evidence_credentials");
    privateEvidence = createMcpPrivateEvidence(parsed, { accessToken: createEvidenceTokenProvider({ tokenEndpoint: c.tokenEndpoint,
      clientId: c.clientId, clientSecret: c.clientSecret, scopes: required as ("evidence:read" | "evidence:write")[] }) });
  }
  const server = createNayoriMcp(parsed, undefined, custody, flags.has("--enable-qa-evaluation"),
    flags.has("--enable-job-discovery"), privateEvidence);
  await server.connect(new StdioServerTransport());
}
main().catch(() => { console.error("Nayori MCP could not start. Supply a valid public QA profile; never include private keys."); process.exitCode = 1; });
