import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, chmodSync, writeFileSync, readFileSync, symlinkSync, linkSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deserializeTransaction } from "@stacks/transactions";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PerkOSClient } from "../src/client.js";
import { prepareEvaluationJob } from "../src/evaluation-commitments.js";
import { createHermesMcp, QA_CONTRACTS } from "../src/mcp/server.js";
import { parsePermit, hash, parseExecution, commitmentInput } from "../src/custody/permit.js";
import { Ledger, readPrivateFile } from "../src/custody/ledger.js";
import { CustodyEngine, type CustodyBackend } from "../src/custody/engine.js";
import { testnetBackend } from "../src/custody/backend.js";
import { custodyPort, listenCustody } from "../src/custody/socket.js";
import type { ContractCallPlan, JobRecord } from "../src/types.js";

// Public deterministic fixture already used in signers.test.ts. NEVER fund this key/address.
const fixtureKey = "000000000000000000000000000000000000000000000000000000000000000101";
const profile = { network: "testnet" as const, role: "client" as const,
  client: "ST1THWXQ8368SDN2MJGE4BMDKMCHZ2GSVTSQDA7QF",
  provider: "ST3QBWTA0XSA94YDXT13QFH3ZMSZSM1V4Z645YHT9",
  evaluator: "STBTXHXFXFGMNPXST7A6XQ1WNGC0V6TB6CDDQZB4",
  treasury: "ST1E7E64H8VSSSGE0RPWF90RRC91MQG7CRQRM1BFX" };
const raw = { version: 1, id: "qa-fixture", profile, asset: "stx", amount: "100000", gasBudget: "30000",
  expiresAt: "2099-01-01T00:00:00.000Z", expiredAt: "999999", jobId: null,
  description: "Compute 7+5", acceptanceCriteria: [{ id: "sum", requirement: "Return 12", verification: "Check arithmetic" }],
  agentName: "QA fixture", actions: ["register", "create", "set-budget", "fund", "assign", "finalize"],
  evidenceOrigins: ["https://evaluator.qa.nayori.ai"], serviceFeeConsent: "200bps-net-after-evaluation" };
const txid = "0x" + "a".repeat(64);
function directory() { const d = realpathSync(mkdtempSync(join(tmpdir(), "nayori-custody-"))); chmodSync(d, 0o700); return d; }
const closes: (() => unknown)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function plan(action: ContractCallPlan["intent"]["operation"] = "create-job"): ContractCallPlan {
  return { type: "contract-call", network: "testnet", contract: QA_CONTRACTS.stxCommerce,
    functionName: action, functionArgs: [], postConditions: [], postConditionMode: "deny", intent: { operation: action } };
}
async function setup(overrides = {}, enabled = true) {
  const permit = await parsePermit({ ...raw, ...overrides }), dir = directory();
  const ledger = new Ledger(dir, hash(permit), permit.profile[permit.profile.role]); closes.push(() => ledger.close());
  const backend = { prepare: vi.fn().mockResolvedValue(plan()),
    sign: vi.fn().mockResolvedValue({ txid, bytes: new Uint8Array([1]) }), broadcast: vi.fn().mockResolvedValue(undefined),
    confirmation: vi.fn().mockResolvedValue({ success: true, result: "(ok u23)" }) } satisfies CustodyBackend;
  const engine = new CustodyEngine(permit, ledger, backend, enabled);
  return { permit, dir, ledger, backend, engine };
}
describe("immutable operator permits", () => {
  it("deep copies criteria, roles and actions before hashing", async () => {
    const source = structuredClone(raw), p = await parsePermit(source), digest = hash(p);
    source.acceptanceCriteria[0]!.requirement = "drain wallet"; source.profile.client = profile.provider;
    expect(hash(p)).toBe(digest); expect(Object.isFrozen(p.actions)).toBe(true);
    expect(Object.isFrozen(p.acceptanceCriteria[0])).toBe(true);
  });
  it.each([
    { privateKey: "secret" }, { apiUrl: "https://evil.test" }, { amount: "100001" }, { amount: "01" },
    { asset: "sbtc", amount: "1001" }, { asset: "usdcx" }, { gasBudget: "35001" },
    { actions: ["create", "create"] }, { actions: ["create", "transfer"] },
    { actions: ["create", "submit"] }, { jobId: "2" }, { expiresAt: "tomorrow" },
    { serviceFeeConsent: "none" }, { evidenceOrigins: ["http://localhost"] },
    { evidenceOrigins: ["https://example.com/path"] }, { profile: { ...profile, network: "mainnet" } },
    { profile: { ...profile, role: "provider" } },
  ])("rejects unsafe operator configuration %j", async change => {
    await expect(parsePermit({ ...raw, ...change })).rejects.toThrow();
  });
  it("requires exact submit schema and allowlisted evidence origin", async () => {
    const p = await parsePermit({ ...raw, profile: { ...profile, role: "provider" }, jobId: "3", actions: ["submit"] });
    const evidence = [{ id: "answer", uri: "https://evaluator.qa.nayori.ai/result.txt", sha256: "a".repeat(64), mediaType: "text/plain", sizeBytes: 2 }];
    expect((await parseExecution({ action: "submit", evidence }, p, "3")).action).toBe("submit");
    await expect(parseExecution({ action: "submit", evidence, amount: "1" }, p, "3")).rejects.toThrow();
    await expect(parseExecution({ action: "submit", evidence: [{ ...evidence[0], uri: "https://evil.test/result" }] }, p, "3")).rejects.toThrow();
    await expect(parseExecution({ action: "submit", evidence: [{ ...evidence[0], sizeBytes: 8193 }] }, p, "3")).rejects.toThrow();
  });
});
describe("durable reservation, gas and replay control", () => {
  it("defaults to no signing or network preparation", async () => {
    const s = await setup({}, false); await expect(s.engine.execute({ action: "create" })).rejects.toThrow();
    expect(s.backend.prepare).not.toHaveBeenCalled(); expect(s.backend.sign).not.toHaveBeenCalled();
  });
  it("persists reservation before key access and txid before broadcast", async () => {
    const s = await setup();
    s.backend.sign.mockImplementation(async () => {
      expect(s.ledger.latest("create")?.state).toBe("reserved"); return { txid, bytes: new Uint8Array([1]) };
    });
    s.backend.broadcast.mockImplementation(async () => {
      expect(s.ledger.latest("create")?.txid).toBe(txid);
      expect(readFileSync(join(s.dir, profile.client + ".jsonl"), "utf8")).toContain(txid);
    });
    await s.engine.execute({ action: "create" }); await s.engine.execute({ action: "create" });
    expect(s.backend.sign).toHaveBeenCalledTimes(1); expect(s.engine.status().gasReserved).toBe("5000");
    await s.engine.reconcile(); expect(s.engine.status().jobId).toBe("23");
    await s.engine.execute({ action: "create" }); expect(s.backend.sign).toHaveBeenCalledTimes(1);
  });
  it("restarts without resetting the budget or resending a tx", async () => {
    const s = await setup(); await s.engine.execute({ action: "create" }); s.ledger.close();
    const reopened = new Ledger(s.dir, hash(s.permit), profile.client); closes.push(() => reopened.close());
    const engine = new CustodyEngine(s.permit, reopened, s.backend, true);
    await engine.execute({ action: "create" }); expect(s.backend.sign).toHaveBeenCalledTimes(1);
    await engine.reconcile(); expect(engine.status().jobId).toBe("23");
  });
  it.each(["sign", "broadcast"] as const)("blocks additional spending after ambiguous %s failure", async stage => {
    const s = await setup(); s.backend[stage].mockRejectedValue(new Error("sensitive-provider-message"));
    await expect(s.engine.execute({ action: "create" })).rejects.toThrow();
    await expect(s.engine.execute({ action: "register" })).rejects.toThrow();
    await s.engine.execute({ action: "create" }); expect(s.backend.sign).toHaveBeenCalledTimes(1);
  });
  it("rejects parallel execution and waits for signing during shutdown", async () => {
    const s = await setup(); let release!: () => void;
    s.backend.sign.mockImplementation(async () => { await new Promise<void>(r => { release = r; }); return { txid, bytes: new Uint8Array([1]) }; });
    const pending = s.engine.execute({ action: "create" }); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(s.engine.execute({ action: "create" })).rejects.toThrow();
    let stopped = false; const stop = s.engine.shutdown().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false); release(); await pending; await stop;
    await expect(s.engine.execute({ action: "create" })).rejects.toThrow();
  });
  it("does not release gas on confirmation; budget is cumulative", async () => {
    const s = await setup({ gasBudget: "5000" }); await s.engine.execute({ action: "create" }); await s.engine.reconcile();
    await expect(s.engine.execute({ action: "register" })).rejects.toThrow(); expect(s.backend.sign).toHaveBeenCalledTimes(1);
  });
  it("does not advance a pending or aborted transaction", async () => {
    const s = await setup(); await s.engine.execute({ action: "create" });
    s.backend.confirmation.mockResolvedValue({ success: false, result: "(err u1)" });
    await s.engine.reconcile(); expect(s.engine.status().jobId).toBeNull();
    await expect(s.engine.execute({ action: "fund" })).rejects.toThrow();
  });
  it("rejects expired authorization before preparing or reading a key", async () => {
    const s = await setup({ expiresAt: "2020-01-01T00:00:00.000Z" });
    await expect(s.engine.execute({ action: "create" })).rejects.toThrow(); expect(s.backend.prepare).not.toHaveBeenCalled();
  });
  it.each([{ network: "mainnet" }, { contract: QA_CONTRACTS.sbtcCommerce }, { functionName: "transfer" },
    { postConditionMode: "allow" }, { intent: { sender: profile.provider } }])("rejects escaped plans before reservation %j", async change => {
    const s = await setup(); s.backend.prepare.mockResolvedValue({ ...plan(), ...change } as ContractCallPlan);
    await expect(s.engine.execute({ action: "create" })).rejects.toThrow(); expect(s.backend.sign).not.toHaveBeenCalled();
    expect(s.ledger.entries).toHaveLength(0);
  });
  it("fails closed after an append error even if the process remains alive", async () => {
    const s = await setup(); vi.spyOn(s.ledger, "append").mockImplementation(() => { throw Error("disk full"); });
    await expect(s.engine.execute({ action: "create" })).rejects.toThrow();
    await expect(s.engine.execute({ action: "create" })).rejects.toThrow(); expect(s.backend.sign).not.toHaveBeenCalled();
    expect(s.engine.status().enabled).toBe(false);
  });
});
describe("private files and locks", () => {
  it("prevents another process or permit from resetting the wallet ledger", async () => {
    const s = await setup(); expect(() => new Ledger(s.dir, hash(s.permit), profile.client)).toThrow();
    s.ledger.close(); expect(() => new Ledger(s.dir, "b".repeat(64), profile.client)).toThrow();
  });
  it("rejects partial/corrupted journal writes on restart", async () => {
    const s = await setup(); s.ledger.close();
    writeFileSync(join(s.dir, profile.client + ".jsonl"), '{"permitHash":', { mode: 0o600 });
    expect(() => new Ledger(s.dir, hash(s.permit), profile.client)).toThrow();
  });
  it("does not treat an existing empty journal as a new budget", async () => {
    const s = await setup(); s.ledger.close(); writeFileSync(join(s.dir, profile.client + ".jsonl"), "");
    expect(() => new Ledger(s.dir, hash(s.permit), profile.client)).toThrow();
  });
  it("rejects loose permissions, symlinks and hardlinks for keys", () => {
    const d = directory(), path = join(d, "key"); writeFileSync(path, "fixture", { mode: 0o600 });
    expect(readPrivateFile(path)).toBe("fixture"); chmodSync(path, 0o644); expect(() => readPrivateFile(path)).toThrow();
    chmodSync(path, 0o600); symlinkSync(path, join(d, "symlink")); expect(() => readPrivateFile(join(d, "symlink"))).toThrow();
    linkSync(path, join(d, "hardlink")); expect(() => readPrivateFile(path)).toThrow();
  });
});
describe("actual SDK planning and offline signing", () => {
  function mockNetwork(nonce = 0) {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input); expect(url.origin).toBe("https://api.testnet.hiro.so"); expect(init?.redirect).toBe("error");
      if (url.pathname === "/v2/info") return Response.json({ network_id: 2147483648, burn_block_height: 100, stacks_tip_height: 100 });
      if (url.pathname.endsWith("/nonces")) return Response.json({ possible_next_nonce: nonce, last_executed_tx_nonce: null,
        last_mempool_tx_nonce: null, detected_missing_nonces: [] });
      throw Error("unexpected network");
    }); vi.stubGlobal("fetch", fetcher); return fetcher;
  }
  it("builds a real register-agent SDK call then signs offline with fixed gas and nonce zero", async () => {
    const fetcher = mockNetwork(), p = await parsePermit(raw), dir = directory(), key = join(dir, "key");
    writeFileSync(key, fixtureKey, { mode: 0o600 }); const b = testnetBackend(key);
    const prepared = await b.prepare(p, { action: "register" }, null);
    expect(prepared.functionName).toBe("register-agent"); expect(prepared.contract).toBe(QA_CONTRACTS.agentRegistry);
    const signed = await b.sign(prepared, profile.client, p.expiresAt), tx = deserializeTransaction(signed.bytes);
    expect("0x" + tx.txid()).toBe(signed.txid); expect(tx.chainId).toBe(2147483648);
    expect(tx.auth.spendingCondition?.nonce).toBe(0n); expect(tx.auth.spendingCondition?.fee).toBe(5000n);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/v2/transactions"))).toBe(false);
  });
  it("rejects a non-idle wallet nonce before loading a key", async () => {
    mockNetwork(2); const b = testnetBackend("/does-not-exist/key");
    await expect(b.sign(plan(), profile.client, raw.expiresAt)).rejects.toThrow("custody_guard_failed");
  });
  it("checks live fee policy before constructing create-job", async () => {
    mockNetwork(); const p = await parsePermit(raw), b = testnetBackend("/never-read/key");
    const policy = { configured: true, basisPoints: 200 as const, treasury: profile.treasury, reviewWindow: 12n, appealWindow: 3n, appealAuthority: profile.evaluator };
    vi.spyOn(PerkOSClient.prototype, "getServiceFeePolicy").mockResolvedValue(policy);
    expect((await b.prepare(p, { action: "create" }, null)).functionName).toBe("create-job");
    vi.mocked(PerkOSClient.prototype.getServiceFeePolicy).mockResolvedValue({ ...policy, treasury: profile.provider });
    await expect(b.prepare(p, { action: "create" }, null)).rejects.toThrow();
  });
  it.each(["stx", "sbtc"] as const)("plans every buyer/provider SDK step for %s; mocked chain, no sends", async asset => {
    mockNetwork();
    const p = await parsePermit({ ...raw, asset, amount: asset === "sbtc" ? "1000" : "100000" });
    const prepared = await prepareEvaluationJob(commitmentInput(p)), amount = BigInt(p.amount);
    const token = "SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token";
    const job: JobRecord = { id: 3n, asset, client: profile.client, evaluator: profile.evaluator,
      treasury: profile.treasury, description: prepared.description, budget: amount, expiredAt: 999999n, status: "open", statusCode: 0n };
    const jobs = vi.spyOn(PerkOSClient.prototype, "getJob").mockResolvedValue(job);
    const escrow = vi.spyOn(PerkOSClient.prototype, "getEscrowBalance").mockResolvedValue(0n);
    const fee = { jobId: 3n, basisPoints: 200 as const, treasury: profile.treasury, feeAmount: amount / 50n, serviceRecorded: false };
    const fees = vi.spyOn(PerkOSClient.prototype, "getJobServiceFee").mockResolvedValue(fee);
    vi.spyOn(PerkOSClient.prototype, "getConfiguredSbtcToken").mockResolvedValue(token);
    vi.spyOn(PerkOSClient.prototype, "getJobPaymentToken").mockResolvedValue(token);
    const backend = testnetBackend("/must-never-load/key");
    const budget = await backend.prepare(p, { action: "set-budget" }, "3"); expect(budget.intent.amount).toBe(amount);
    const fund = await backend.prepare(p, { action: "fund" }, "3");
    expect(fund.intent.sender).toBe(profile.client); expect(fund.postConditions).toHaveLength(1);
    jobs.mockResolvedValue({ ...job, status: "funded", statusCode: 1n }); escrow.mockResolvedValue(amount);
    expect((await backend.prepare(p, { action: "assign" }, "3")).functionName).toBe("assign-provider");
    jobs.mockResolvedValue({ ...job, status: "funded", statusCode: 1n, provider: profile.provider });
    const provider = await parsePermit({ ...raw, asset, amount: p.amount, profile: { ...profile, role: "provider" }, jobId: "3", actions: ["submit"] });
    const evidence = [{ id: "result", uri: "https://evaluator.qa.nayori.ai/result.txt", sha256: "a".repeat(64), mediaType: "text/plain", sizeBytes: 2 }];
    expect((await backend.prepare(provider, { action: "submit", evidence }, "3")).functionName).toBe("submit-work");
    jobs.mockResolvedValue({ ...job, status: "decision-pending", statusCode: 7n, provider: profile.provider });
    fees.mockResolvedValue({ ...fee, serviceRecorded: true });
    const d = { jobId: 3n, originalDecision: "approve" as const, evidenceHash: "a".repeat(64), explanationHash: "b".repeat(64), decidedAtBurn: 90n, appealDeadline: 99n };
    const decision = vi.spyOn(PerkOSClient.prototype, "getDecision").mockResolvedValue(d);
    const finalize = await backend.prepare(p, { action: "finalize" }, "3");
    expect(finalize.intent.recipient).toBe(profile.provider); expect(finalize.postConditionMode).toBe("deny");
    expect(finalize.postConditions.length).toBeGreaterThan(0);
    decision.mockResolvedValue({ ...d, appealDeadline: 100n });
    await expect(backend.prepare(p, { action: "finalize" }, "3")).rejects.toThrow();
    decision.mockResolvedValue({ ...d, appealedBy: profile.client });
    await expect(backend.prepare(p, { action: "finalize" }, "3")).rejects.toThrow();
    jobs.mockResolvedValue({ ...job, client: profile.provider });
    await expect(backend.prepare(p, { action: "fund" }, "3")).rejects.toThrow();
  });
});
describe("real Unix socket + official MCP protocol, no live key or funds", () => {
  it("delegates a bounded action and rejects wallet/amount overrides", async () => {
    const s = await setup(), ipc = join(s.dir, "ipc"); mkdirSync(ipc, { mode: 0o710 }); chmodSync(ipc, 0o710);
    const socket = join(ipc, "s"), service = await listenCustody(socket, s.engine);
    closes.push(() => new Promise<void>(resolve => service.close(() => resolve())));
    const port = custodyPort(socket, hash(s.permit), s.permit.profile);
    const mcp = createHermesMcp(profile, undefined, port), client = new Client({ name: "custody-fixture", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair(); await mcp.connect(a); await client.connect(b);
    closes.push(async () => { await client.close(); await mcp.close(); });
    expect((await client.listTools()).tools).toHaveLength(8);
    expect((await client.callTool({ name: "nayori_execute", arguments: { action: "create", amount: "200000" } })).isError).toBe(true);
    expect((await client.callTool({ name: "nayori_execute", arguments: { action: "submit", evidence: [] } })).isError).toBe(true);
    expect(s.backend.sign).not.toHaveBeenCalled();
    const response = await client.callTool({ name: "nayori_execute", arguments: { action: "create" } }); expect(response.isError).not.toBe(true);
    expect(s.backend.sign).toHaveBeenCalledTimes(1);
    await client.callTool({ name: "nayori_execute", arguments: { action: "create" } }); expect(s.backend.sign).toHaveBeenCalledTimes(1);
    const mismatch = custodyPort(socket, "f".repeat(64), s.permit.profile);
    await expect(mismatch.execute({ action: "create" })).rejects.toThrow();
    const otherRole = custodyPort(socket, hash(s.permit), { ...s.permit.profile, role: "provider" });
    await expect(otherRole.execute({ action: "create" })).rejects.toThrow();
  });
  it("redacts raw failures and does not deny that signing may have happened", async () => {
    const mcp = createHermesMcp(profile, undefined, { status: async () => ({}), execute: async () => { throw Error("private-secret"); } });
    const client = new Client({ name: "redaction", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair();
    await mcp.connect(a); await client.connect(b); closes.push(async () => { await client.close(); await mcp.close(); });
    const response = await client.callTool({ name: "nayori_execute", arguments: { action: "create" } });
    expect(response.isError).toBe(true); expect(JSON.stringify(response)).not.toContain("private-secret");
    expect(JSON.stringify(response)).toContain("may already be signed");
  });
});
