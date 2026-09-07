import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";

it("speaks actual stdio MCP with no stdout noise, keys or network for context/preparation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nayori-mcp-stdio-"));
  const config = join(dir, "public-profile.json");
  writeFileSync(config, JSON.stringify({ network: "testnet", role: "client",
    client: "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5",
    provider: "ST3QBWTA0XSA94YDXT13QFH3ZMSZSM1V4Z645YHT9",
    evaluator: "STBTXHXFXFGMNPXST7A6XQ1WNGC0V6TB6CDDQZB4",
    treasury: "ST1E7E64H8VSSSGE0RPWF90RRC91MQG7CRQRM1BFX" }));
  const client = new Client({ name: "stdio-consumer", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", "tsx", resolve("src/mcp/cli.ts"), "--config", config], env: {}, stderr: "pipe" });
  let stderr = ""; transport.stderr?.on("data", b => { stderr += String(b); });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(6);
    expect((await client.callTool({ name: "nayori_context" })).isError).not.toBe(true);
    const result = await client.callTool({ name: "nayori_prepare_job", arguments: { asset: "stx",
      description: "Compute 7+5", acceptanceCriteria: [{ id: "sum", requirement: "result12", verification: "Arithmetic" }] } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("nayori-criteria-v1");
    expect(stderr).toBe("");
  } finally { await client.close(); await transport.close(); rmSync(dir, { recursive: true }); }
}, 15000);
