import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHermesMcp, parseProfile, QA_CONTRACTS, toolsFor } from "../src/mcp/server.js";
import { prepareEvaluationJob, prepareEvaluationSubmission } from "../src/evaluation-commitments.js";

const profile = { network: "testnet", role: "client",
  client: "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5",
  provider: "ST3QBWTA0XSA94YDXT13QFH3ZMSZSM1V4Z645YHT9",
  evaluator: "STBTXHXFXFGMNPXST7A6XQ1WNGC0V6TB6CDDQZB4",
  treasury: "ST1E7E64H8VSSSGE0RPWF90RRC91MQG7CRQRM1BFX" };
const criteria = [{ id: "sum", requirement: "Return 7+5=12", verification: "Check arithmetic" }];
const input = { asset: "sbtc", description: "Compute 7+5", acceptanceCriteria: criteria };
const evidence = [{ id: "result", uri: "https://evaluator.qa.nayori.ai/qa-evidence/result.json",
  sha256: "a".repeat(64), mediaType: "application/json", sizeBytes: 12 }];
function mockReader() {
  return { getAgentCount: vi.fn().mockResolvedValue(2n), getJobCount: vi.fn().mockResolvedValue(12n),
    getAgent: vi.fn().mockResolvedValue({ id: 1n }), getJob: vi.fn().mockResolvedValue({ id: 12n, status: "completed" }),
    getDecision: vi.fn().mockResolvedValue({ finalDecision: "approve" }), getEscrowBalance: vi.fn().mockResolvedValue(0n),
    getJobServiceFee: vi.fn().mockResolvedValue({ feeAmount: 20n }), getReputation: vi.fn().mockResolvedValue({ completedJobs: 14n }) };
}
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.unstubAllGlobals(); });
async function connect(role = "client", reader = mockReader()) {
  const server = createHermesMcp({ ...profile, role }, reader);
  const client = new Client({ name: "qa-test", version: "1" });
  const [s, c] = InMemoryTransport.createLinkedPair();
  await server.connect(s); await client.connect(c);
  cleanup.push(async () => { await client.close(); await server.close(); });
  return { client, reader };
}
function parsed(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as { text: string }[];
  return JSON.parse(content[0]!.text);
}
describe("QA MCP profile", () => {
  it("copies and freezes the public profile", () => {
    const value = { ...profile }; const p = parseProfile(value); value.role = "provider";
    expect(p.role).toBe("client"); expect(Object.isFrozen(p)).toBe(true);
  });
  it.each([
    { network: "mainnet" }, { role: "evaluator" }, { client: "invalid" },
    { provider: profile.client }, { privateKey: "never-reflect-this" },
    { apiUrl: "http://localhost:1234" }, { signerModule: "/tmp/evil.js" },
  ])("rejects invalid role/network/secrets/config %j", change => {
    expect(() => parseProfile({ ...profile, ...change })).toThrow();
  });
  it("advertises only six non-mutating role-specific tools", () => {
    for (const role of ["client", "provider"]) {
      const tools = toolsFor(parseProfile({ ...profile, role }));
      expect(tools).toHaveLength(6);
      expect(tools.every(t => t.annotations?.readOnlyHint && t.inputSchema.additionalProperties === false)).toBe(true);
      expect(tools.some(t => /sign|broadcast|fund|finalize/.test(t.name))).toBe(false);
    }
  });
});
describe("real MCP initialize/list/call protocol, mocked chain", () => {
  it("handshakes and reports no signing or x402 capability", async () => {
    const { client } = await connect(); expect((await client.listTools()).tools).toHaveLength(6);
    const r = parsed(await client.callTool({ name: "nayori_context" }));
    expect(r.network).toBe("testnet"); expect(r.capabilities.sign).toBe(false); expect(r.capabilities.x402).toBe(false);
  });
  it("serializes real SDK-shaped BigInts and reads only the requested job", async () => {
    const { client, reader } = await connect();
    const r = parsed(await client.callTool({ name: "nayori_get_job", arguments: { asset: "sbtc", jobId: "12" } }));
    expect(r.escrow).toBe("0"); expect(r.fee.feeAmount).toBe("20");
    expect(reader.getJob).toHaveBeenCalledExactlyOnceWith("sbtc", 12n);
  });
  it("returns nonexistent jobs without looking up a nonexistent decision", async () => {
    const reader = mockReader(); reader.getJob.mockResolvedValue(null);
    const { client } = await connect("client", reader);
    expect(parsed(await client.callTool({ name: "nayori_get_job", arguments: { asset: "stx", jobId: "99" } }))).toEqual({ job: null });
    expect(reader.getDecision).not.toHaveBeenCalled();
  });
  it("uses the actual SDK commitment helper offline", async () => {
    const fetch = vi.fn(() => { throw Error("unexpected network"); }); vi.stubGlobal("fetch", fetch);
    const { client } = await connect();
    const result = parsed(await client.callTool({ name: "nayori_prepare_job", arguments: input }));
    const expected = await prepareEvaluationJob({ ...input, asset: "sbtc", network: "testnet",
      contract: QA_CONTRACTS.sbtcCommerce, client: profile.client, evaluator: profile.evaluator });
    expect(result).toEqual({ ...expected, signed: false, broadcast: false }); expect(fetch).not.toHaveBeenCalled();
  });
  it("prepares provider commitment without fetching or claiming byte verification", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); const { client } = await connect("provider");
    const result = parsed(await client.callTool({ name: "nayori_prepare_submission", arguments: { ...input, jobId: "12", evidence } }));
    const expected = await prepareEvaluationSubmission({ ...input, network: "testnet", asset: "sbtc",
      contract: QA_CONTRACTS.sbtcCommerce, client: profile.client, evaluator: profile.evaluator,
      provider: profile.provider, jobId: "12", evidence });
    expect(result.deliverable).toBe(Buffer.from(expected.deliverable).toString("hex"));
    expect(result.evidenceBytesVerified).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["0", "-1", "01", "1.2", (2n ** 128n).toString(), "1; echo unsafe"])("rejects invalid id %s before a chain call", async id => {
    const { client, reader } = await connect();
    expect((await client.callTool({ name: "nayori_get_job", arguments: { asset: "sbtc", jobId: id } })).isError).toBe(true);
    expect(reader.getJob).not.toHaveBeenCalled();
  });
  it.each([
    { asset: "usdcx", jobId: "1" }, { asset: "stx", jobId: "1", network: "mainnet" },
    { asset: "stx", jobId: "1", apiUrl: "http://127.0.0.1" }, { asset: "stx", jobId: 1 },
  ])("rejects unknown fields and asset overrides %j", async args => {
    const { client, reader } = await connect();
    expect((await client.callTool({ name: "nayori_get_job", arguments: args })).isError).toBe(true);
    expect(reader.getJob).not.toHaveBeenCalled();
  });
  it("rejects the other role's preparation and arbitrary signing tools", async () => {
    const { client } = await connect("provider");
    for (const name of ["nayori_prepare_job", "nayori_sign", "execute_shell", "nayori_fund_job"]) {
      expect((await client.callTool({ name, arguments: input })).isError).toBe(true);
    }
  });
  it("does not reflect raw chain errors or secret-looking input", async () => {
    const reader = mockReader(); reader.getAgent.mockRejectedValue(Error("private diagnostic Bearer NEVER-ECHO"));
    const { client } = await connect("client", reader);
    const r = await client.callTool({ name: "nayori_get_agent", arguments: { agentId: "1" } });
    expect(r.isError).toBe(true); expect(JSON.stringify(r)).not.toContain("NEVER-ECHO");
  });
  it("rejects oversized input and nested unknown fields", async () => {
    const { client } = await connect();
    for (const args of [{ ...input, description: "x".repeat(33000) },
      { ...input, acceptanceCriteria: [{ ...criteria[0], privateKey: "invalid" }] }]) {
      expect((await client.callTool({ name: "nayori_prepare_job", arguments: args })).isError).toBe(true);
    }
  });
  it("rejects unsafe URI, unknown MIME and oversized evidence manifests", async () => {
    const { client } = await connect("provider");
    for (const e of [{ ...evidence[0], uri: "file:///etc/passwd" }, { ...evidence[0], sizeBytes: 8193 },
      { ...evidence[0], mediaType: "text/html" }, { ...evidence[0], extra: true }]) {
      expect((await client.callTool({ name: "nayori_prepare_submission", arguments: { ...input, jobId: "12", evidence: [e] } })).isError).toBe(true);
    }
  });
});
