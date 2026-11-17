import { Cl } from "@stacks/transactions";
import type { ClarityValue } from "@stacks/transactions";
import { describe, expect, it } from "vitest";
import type { ContractCallPlan, ReadOnlyCall, ReadOnlyTransport } from "../src/index.js";
import {
  NayoriNextClient,
  PerkOSError,
  nayoriNextJobStatus,
  parseNayoriNextAllowance,
  parseNayoriNextApplications,
  parseNayoriNextDecision,
  parseNayoriNextJob,
  parseNayoriNextProviderStats,
  parseNayoriNextSubmission,
} from "../src/index.js";

const DEPLOYER = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const CLIENT = "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5";
const PROVIDER = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
const EVALUATOR = "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC";
const TREASURY = "ST2NEB84ASENDXKYGJPQW86YXQCEFEX2ZQPG87ND";
const AUTHORITY = "ST2REHHS5J3CERCRBEPMGH7921Q6PYKAADT7JP2VB";
const ESCROW_SBTC = `${DEPLOYER}.nayori-escrow-sbtc`;
const APPLICATIONS = `${DEPLOYER}.nayori-applications`;
const SBTC = "SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token";
const TXID = `0x${"ab".repeat(32)}`;

function jobCv(status: number, budget = 1_000n, provider: string | null = PROVIDER) {
  return Cl.some(
    Cl.tuple({
      client: Cl.principal(CLIENT),
      evaluator: Cl.principal(EVALUATOR),
      provider: provider ? Cl.some(Cl.principal(provider)) : Cl.none(),
      treasury: Cl.principal(TREASURY),
      "appeal-authority": Cl.principal(AUTHORITY),
      budget: Cl.uint(budget),
      description: Cl.stringAscii("test job"),
      "delivery-deadline": Cl.uint(900_144n),
      "delivery-blocks": Cl.uint(144n),
      "review-blocks": Cl.uint(12n),
      status: Cl.uint(status),
    })
  );
}

function decisionCv(decision: number, appealed = false) {
  return Cl.some(
    Cl.tuple({
      decision: Cl.uint(decision),
      "by-default": Cl.bool(false),
      "evidence-hash": Cl.bufferFromHex("11".repeat(32)),
      "appeal-deadline": Cl.uint(900_300n),
      appellant: appealed ? Cl.some(Cl.principal(PROVIDER)) : Cl.none(),
      "resolution-deadline": appealed ? Cl.some(Cl.uint(900_444n)) : Cl.none(),
    })
  );
}

function statsCv() {
  return Cl.tuple({
    completed: Cl.uint(3n),
    rejected: Cl.uint(1n),
    "not-delivered": Cl.uint(0n),
    "completed-value-sbtc": Cl.uint(30_000n),
    "completed-value-stx": Cl.uint(5_000_000n),
    "distinct-clients": Cl.uint(2n),
    "rating-sum": Cl.uint(14n),
    "rating-count": Cl.uint(3n),
  });
}

function makeClient(
  answers: Record<string, ClarityValue | ((call: ReadOnlyCall) => ClarityValue)>,
  signer = CLIENT,
  spendingPolicy = { maxPerTransaction: { sbtc: 1_000_000n }, maxPerSession: { sbtc: 2_000_000n } }
) {
  const calls: ReadOnlyCall[] = [];
  const plans: ContractCallPlan[] = [];
  const transport: ReadOnlyTransport = async (call) => {
    calls.push(call);
    const answer = answers[call.functionName];
    if (answer === undefined) throw new Error(`Unexpected function ${call.functionName}`);
    return typeof answer === "function" ? answer(call) : answer;
  };
  const client = new NayoriNextClient({
    network: "testnet",
    deployer: DEPLOYER,
    readOnlyTransport: transport,
    spendingPolicy,
    signer: {
      getAddress: async () => signer,
      signAndBroadcast: async (plan) => {
        plans.push(plan);
        return { txid: TXID };
      },
    },
  });
  return { client, calls, plans };
}

describe("next generation parsers", () => {
  it("parses a job tuple and every status", () => {
    expect(parseNayoriNextJob(Cl.none(), "sbtc", 1n)).toBeNull();
    expect(parseNayoriNextJob(jobCv(2, 1_000n), "sbtc", 4n)).toEqual({
      id: 4n,
      asset: "sbtc",
      client: CLIENT,
      evaluator: EVALUATOR,
      provider: PROVIDER,
      treasury: TREASURY,
      appealAuthority: AUTHORITY,
      budget: 1_000n,
      description: "test job",
      deliveryDeadline: 900_144n,
      deliveryBlocks: 144n,
      reviewBlocks: 12n,
      status: "offered",
      statusCode: 2n,
    });
    expect(parseNayoriNextJob(jobCv(0, 1_000n, null), "stx", 1n)?.provider).toBeUndefined();
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((code) => nayoriNextJobStatus(BigInt(code)))
    ).toEqual([
      "open", "funded", "offered", "accepted", "submitted", "decided",
      "disputed", "completed", "rejected", "refunded", "expired",
    ]);
    expect(() => nayoriNextJobStatus(11n)).toThrow(PerkOSError);
    expect(() => parseNayoriNextJob(Cl.uint(1), "sbtc", 1n)).toThrow(/optional/);
  });

  it("parses submissions, decisions, stats, applications and allowances", () => {
    expect(
      parseNayoriNextSubmission(
        Cl.some(Cl.tuple({ deliverable: Cl.bufferFromHex("abcd"), "review-deadline": Cl.uint(12n) })),
        3n
      )
    ).toEqual({ jobId: 3n, deliverable: "abcd", reviewDeadline: 12n });
    expect(parseNayoriNextDecision(decisionCv(2, true), 3n)).toEqual({
      jobId: 3n,
      decision: "reject",
      byDefault: false,
      evidenceHash: "11".repeat(32),
      appealDeadline: 900_300n,
      appellant: PROVIDER,
      resolutionDeadline: 900_444n,
    });
    expect(() => parseNayoriNextDecision(decisionCv(3), 3n)).toThrow(/unknown decision/);
    expect(parseNayoriNextProviderStats(statsCv(), PROVIDER)).toEqual({
      provider: PROVIDER,
      completed: 3n,
      rejected: 1n,
      notDelivered: 0n,
      completedValueSbtc: 30_000n,
      completedValueStx: 5_000_000n,
      distinctClients: 2n,
      ratingSum: 14n,
      ratingCount: 3n,
    });
    expect(
      parseNayoriNextApplications(
        Cl.list([
          Cl.tuple({ applicant: Cl.principal(PROVIDER), deposit: Cl.uint(900n) }),
          Cl.tuple({ applicant: Cl.principal(EVALUATOR), deposit: Cl.uint(100n) }),
        ])
      )
    ).toEqual([
      { applicant: PROVIDER, deposit: 900n },
      { applicant: EVALUATOR, deposit: 100n },
    ]);
    expect(parseNayoriNextAllowance(Cl.none())).toBeNull();
    expect(parseNayoriNextAllowance(Cl.some(Cl.none()))).toEqual({});
    expect(parseNayoriNextAllowance(Cl.some(Cl.some(Cl.uint(5n))))).toEqual({ until: 5n });
  });
});

describe("NayoriNextClient", () => {
  it("refuses reads and broadcasts while the contracts are not deployed", async () => {
    const client = new NayoriNextClient({ network: "testnet" });
    await expect(client.getJobCount("sbtc")).rejects.toThrow(/not deployed/);
  });

  it("reads escrow, reputation, agents, roles and applications", async () => {
    const { client, calls } = makeClient({
      "get-job-count": Cl.uint(4n),
      "get-job": jobCv(7),
      "get-escrow-balance": Cl.uint(0n),
      "get-provider-stats": statsCv(),
      "get-outcome": Cl.some(
        Cl.tuple({
          provider: Cl.principal(PROVIDER),
          client: Cl.principal(CLIENT),
          completed: Cl.bool(true),
          value: Cl.uint(1_000n),
          rated: Cl.bool(false),
        })
      ),
      "get-agent": Cl.some(
        Cl.tuple({ name: Cl.stringAscii("p"), uri: Cl.stringAscii("u"), "registered-at": Cl.uint(10n) })
      ),
      "is-registered": Cl.bool(true),
      "get-treasury": Cl.principal(TREASURY),
      "get-appeal-authority": Cl.principal(AUTHORITY),
      "get-handover": Cl.none(),
      "get-applications": Cl.list([]),
    });
    expect(await client.getJobCount("sbtc")).toBe(4n);
    expect((await client.getJob("sbtc", 1))?.status).toBe("completed");
    expect(await client.getEscrowBalance("sbtc", 1)).toBe(0n);
    expect((await client.getProviderStats(PROVIDER)).ratingCount).toBe(3n);
    expect(await client.getOutcome("sbtc", 1)).toMatchObject({ completed: true, rated: false });
    expect(await client.getAgent(PROVIDER)).toEqual({ wallet: PROVIDER, name: "p", uri: "u", registeredAt: 10n });
    expect(await client.isRegisteredAgent(PROVIDER)).toBe(true);
    expect(await client.getTreasury()).toBe(TREASURY);
    expect(await client.getAppealAuthority()).toBe(AUTHORITY);
    expect(await client.getHandover("treasury")).toBeNull();
    expect(await client.getApplications(1)).toEqual([]);
    expect(calls.find((call) => call.functionName === "get-outcome")?.functionArgs).toEqual([
      Cl.contractPrincipal(DEPLOYER, "nayori-escrow-sbtc"),
      Cl.uint(1n),
    ]);
    expect(calls.find((call) => call.functionName === "get-job")?.contract).toBe(ESCROW_SBTC);
  });

  it("funds an open job with exactly its live budget from the client", async () => {
    const { client, plans } = makeClient({ "get-job": jobCv(0, 25_000n, null) });
    const receipt = await client.fundJob("sbtc", 3);
    expect(receipt).toMatchObject({ operation: "fund-job", amount: 25_000n, jobId: 3n });
    expect(plans[0]?.postConditions).toEqual([
      { type: "ft-postcondition", address: CLIENT, condition: "eq", amount: "25000", asset: `${SBTC}::sbtc-token` },
    ]);
    expect(client.policy.spentThisSession("sbtc")).toBe(25_000n);
  });

  it("refuses funding by a wallet that is not the client or a job that is not open", async () => {
    const other = makeClient({ "get-job": jobCv(0) }, PROVIDER);
    await expect(other.client.fundJob("sbtc", 3)).rejects.toMatchObject({ details: { clarityCode: 302n } });
    const funded = makeClient({ "get-job": jobCv(1) });
    await expect(funded.client.fundJob("sbtc", 3)).rejects.toMatchObject({ details: { clarityCode: 301n } });
  });

  it("requires spending limits before funding", async () => {
    const { client } = makeClient({ "get-job": jobCv(0) }, CLIENT, {} as never);
    await expect(client.fundJob("sbtc", 3)).rejects.toMatchObject({ code: "POLICY_LIMIT_REQUIRED" });
  });

  it("names a provider after checking it against the job's parties", async () => {
    const { client, plans } = makeClient({ "get-job": jobCv(1) });
    await client.nameProvider("sbtc", 3, PROVIDER);
    expect(plans[0]?.functionName).toBe("name-provider");
    await expect(client.nameProvider("sbtc", 3, TREASURY)).rejects.toMatchObject({
      details: { clarityCode: 307n },
    });
  });

  it("settles a decided job to the winner with the exact escrow outflow", async () => {
    const { client, plans } = makeClient({
      "get-job": jobCv(5, 1_000n),
      "get-escrow-balance": Cl.uint(1_000n),
      "get-decision": decisionCv(2),
    }, EVALUATOR);
    const receipt = await client.settleJob("sbtc", 3);
    expect(receipt.operation).toBe("settle-job");
    expect(plans[0]?.intent.recipient).toBe(CLIENT);
    expect(plans[0]?.postConditions).toEqual([
      { type: "ft-postcondition", address: ESCROW_SBTC, condition: "eq", amount: "1000", asset: `${SBTC}::sbtc-token` },
    ]);
    // Settlement is not spending by the signer.
    expect(client.policy.spentThisSession("sbtc")).toBe(0n);
  });

  it("refuses payouts when the escrow does not hold the budget", async () => {
    const { client } = makeClient({
      "get-job": jobCv(6, 1_000n),
      "get-escrow-balance": Cl.uint(0n),
    }, AUTHORITY);
    await expect(
      client.resolveAppeal({ asset: "sbtc", jobId: 3, decision: "approve", resolutionHash: "22".repeat(32) })
    ).rejects.toMatchObject({ code: "READ_FAILED" });
  });

  it("resolves an appeal and refunds an undelivered job", async () => {
    const { client, plans } = makeClient({
      "get-job": (call) => (Number((call.functionArgs[0] as { value: bigint }).value) === 3 ? jobCv(6) : jobCv(3)),
      "get-escrow-balance": Cl.uint(1_000n),
    }, AUTHORITY);
    await client.resolveAppeal({ asset: "sbtc", jobId: 3, decision: "approve", resolutionHash: "22".repeat(32) });
    expect(plans[0]?.intent).toMatchObject({ operation: "resolve-appeal", recipient: PROVIDER, amount: 1_000n });
    await client.refundNoDelivery("sbtc", 4);
    expect(plans[1]?.intent).toMatchObject({ operation: "refund-no-delivery", recipient: CLIENT });
    expect(plans[1]?.postConditions[0]).toMatchObject({ address: ESCROW_SBTC, amount: "1000" });
  });

  it("applies, withdraws and declines with deposit-exact post-conditions", async () => {
    const applicant = makeClient(
      {
        "get-application": Cl.some(Cl.tuple({ applicant: Cl.principal(PROVIDER), deposit: Cl.uint(600n) })),
      },
      PROVIDER
    );
    await applicant.client.applyToJob({ jobId: 2, deposit: 600 });
    expect(applicant.client.policy.spentThisSession("sbtc")).toBe(600n);
    await applicant.client.withdrawApplication(2);
    expect(applicant.plans[1]?.postConditions).toEqual([
      { type: "ft-postcondition", address: APPLICATIONS, condition: "eq", amount: "600", asset: `${SBTC}::sbtc-token` },
    ]);

    const owner = makeClient({ "get-application": Cl.none() });
    await expect(owner.client.declineApplication(2, PROVIDER)).rejects.toMatchObject({
      details: { clarityCode: 608n },
    });
  });

  it("enforces the per-transaction limit on application deposits", async () => {
    const { client } = makeClient({}, PROVIDER, {
      maxPerTransaction: { sbtc: 500n },
      maxPerSession: { sbtc: 1_000n },
    });
    await expect(client.applyToJob({ jobId: 2, deposit: 600 })).rejects.toMatchObject({ code: "POLICY_DENIED" });
  });

  it("checks the signer against the plan sender", async () => {
    const { client } = makeClient({}, PROVIDER);
    await expect(
      client.execute(client.transactions.fundJob({ asset: "sbtc", jobId: 1, budget: 1_000, sender: CLIENT }))
    ).rejects.toMatchObject({ code: "SIGNER_MISMATCH" });
  });
});
