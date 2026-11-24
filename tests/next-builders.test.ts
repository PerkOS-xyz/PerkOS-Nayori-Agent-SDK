import { Cl, ClarityType } from "@stacks/transactions";
import { describe, expect, it } from "vitest";
import {
  NayoriNextTransactionBuilder,
  PerkOSError,
  resolveNayoriNextConfig,
} from "../src/index.js";

const DEPLOYER = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const CLIENT = "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5";
const PROVIDER = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
const EVALUATOR = "ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC";
const SBTC = "SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token";
const ESCROW_SBTC = `${DEPLOYER}.nayori-escrow-sbtc`;
const ESCROW_STX = `${DEPLOYER}.nayori-escrow-stx`;
const APPLICATIONS = `${DEPLOYER}.nayori-applications`;
const HASH = "11".repeat(32);

const config = resolveNayoriNextConfig({ network: "testnet", deployer: DEPLOYER });
const builder = new NayoriNextTransactionBuilder(config);

function clarityCode(fn: () => unknown): bigint | undefined {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PerkOSError);
    return (error as PerkOSError).details?.clarityCode;
  }
  throw new Error("expected a PerkOSError");
}

const job = {
  asset: "sbtc" as const,
  evaluator: EVALUATOR,
  budget: 1_000n,
  deliveryBlocks: 144,
  reviewBlocks: 12,
  description: "test job",
};

describe("next generation transaction builders", () => {
  it("creates a job with no token argument", () => {
    const plan = builder.createJob({ ...job, client: CLIENT });
    expect(plan.contract).toBe(ESCROW_SBTC);
    expect(plan.functionName).toBe("create-job");
    expect(plan.functionArgs).toEqual([
      Cl.principal(EVALUATOR),
      Cl.uint(1_000n),
      Cl.uint(144n),
      Cl.uint(12n),
      Cl.stringAscii("test job"),
    ]);
    expect(plan.postConditionMode).toBe("deny");
    expect(plan.postConditions).toEqual([]);
    expect(plan.intent).toMatchObject({ operation: "create-job", asset: "sbtc", sender: CLIENT });
    expect(builder.createJob({ ...job, asset: "stx", budget: 1_000_000n }).contract).toBe(ESCROW_STX);
  });

  it("enforces budget, window and description bounds with the contract codes", () => {
    expect(clarityCode(() => builder.createJob({ ...job, budget: 999n }))).toBe(308n);
    expect(clarityCode(() => builder.createJob({ ...job, budget: 100_000_001n }))).toBe(308n);
    expect(builder.createJob({ ...job, budget: 100_000_000n }).functionName).toBe("create-job");
    expect(clarityCode(() => builder.createJob({ ...job, asset: "stx", budget: 999_999n }))).toBe(308n);
    expect(
      clarityCode(() => builder.createJob({ ...job, asset: "stx", budget: 100_000_000_001n }))
    ).toBe(308n);
    expect(clarityCode(() => builder.createJob({ ...job, deliveryBlocks: 143 }))).toBe(309n);
    expect(clarityCode(() => builder.createJob({ ...job, deliveryBlocks: 4_321 }))).toBe(309n);
    expect(clarityCode(() => builder.createJob({ ...job, reviewBlocks: 11 }))).toBe(309n);
    expect(clarityCode(() => builder.createJob({ ...job, reviewBlocks: 1_009 }))).toBe(309n);
    expect(clarityCode(() => builder.createJob({ ...job, description: "" }))).toBe(310n);
    expect(clarityCode(() => builder.createJob({ ...job, client: EVALUATOR }))).toBe(307n);
    expect(() => builder.createJob({ ...job, description: "x".repeat(513) })).toThrow(PerkOSError);
    expect(() =>
      builder.createJob({ ...job, evaluator: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE" })
    ).toThrow(/does not belong/);
  });

  it("binds sBTC funding to exactly the budget from the client", () => {
    const plan = builder.fundJob({ asset: "sbtc", jobId: 3, budget: 25_000n, sender: CLIENT });
    expect(plan.functionArgs).toEqual([Cl.uint(3n)]);
    expect(plan.postConditions).toEqual([
      {
        type: "ft-postcondition",
        address: CLIENT,
        condition: "eq",
        amount: "25000",
        asset: `${SBTC}::sbtc-token`,
      },
    ]);
    expect(plan.intent).toMatchObject({ operation: "fund-job", amount: 25_000n, jobId: 3n, sender: CLIENT });
  });

  it("binds STX funding to exactly the budget from the client", () => {
    const plan = builder.fundJob({ asset: "stx", jobId: 4, budget: 2_000_000n, sender: CLIENT });
    expect(plan.contract).toBe(ESCROW_STX);
    expect(plan.postConditions).toEqual([
      { type: "stx-postcondition", address: CLIENT, condition: "eq", amount: "2000000" },
    ]);
  });

  it("names and accepts a provider, then submits work", () => {
    const named = builder.nameProvider({ asset: "sbtc", jobId: 1, provider: PROVIDER });
    expect(named.functionArgs).toEqual([Cl.uint(1n), Cl.principal(PROVIDER)]);
    expect(
      clarityCode(() =>
        builder.nameProvider({ asset: "sbtc", jobId: 1, provider: EVALUATOR, parties: [CLIENT, EVALUATOR] })
      )
    ).toBe(307n);
    expect(builder.acceptJob({ asset: "sbtc", jobId: 1 }).functionName).toBe("accept-job");
    const submitted = builder.submitWork({ asset: "sbtc", jobId: 1, deliverable: "ipfs:bafy" });
    expect(submitted.functionArgs[1]?.type).toBe(ClarityType.Buffer);
    expect(() =>
      builder.submitWork({ asset: "sbtc", jobId: 1, deliverable: new Uint8Array(65) })
    ).toThrow(PerkOSError);
  });

  it("records decisions and appeals with non-zero hashes", () => {
    const decided = builder.recordDecision({ asset: "sbtc", jobId: 2, decision: "reject", evidenceHash: HASH });
    expect(decided.functionArgs).toEqual([Cl.uint(2n), Cl.uint(2n), Cl.bufferFromHex(HASH)]);
    expect(
      clarityCode(() =>
        builder.recordDecision({ asset: "sbtc", jobId: 2, decision: "approve", evidenceHash: "00".repeat(32) })
      )
    ).toBe(312n);
    expect(
      clarityCode(() =>
        builder.recordDecision({ asset: "sbtc", jobId: 2, decision: "maybe" as never, evidenceHash: HASH })
      )
    ).toBe(311n);
    expect(builder.recordDefaultApproval({ asset: "stx", jobId: 2 }).functionArgs).toEqual([Cl.uint(2n)]);
    const appealed = builder.appeal({ asset: "sbtc", jobId: 2, evidenceHash: `0x${HASH}` });
    expect(appealed.functionName).toBe("appeal");
    expect(appealed.postConditions).toEqual([]);
  });

  it("guards every escrow payout with the contract's exact outflow", () => {
    const resolved = builder.resolveAppeal({
      asset: "sbtc",
      jobId: 5,
      decision: "approve",
      resolutionHash: HASH,
      budget: 1_000n,
      recipient: PROVIDER,
    });
    expect(resolved.functionArgs).toEqual([Cl.uint(5n), Cl.uint(1n), Cl.bufferFromHex(HASH)]);
    expect(resolved.postConditions).toEqual([
      {
        type: "ft-postcondition",
        address: ESCROW_SBTC,
        condition: "eq",
        amount: "1000",
        asset: `${SBTC}::sbtc-token`,
      },
    ]);
    expect(resolved.intent).toMatchObject({ operation: "resolve-appeal", amount: 1_000n, recipient: PROVIDER });

    const settled = builder.settleJob({ asset: "stx", jobId: 6, budget: 1_000_000n });
    expect(settled.functionArgs).toEqual([Cl.uint(6n)]);
    expect(settled.postConditions).toEqual([
      { type: "stx-postcondition", address: ESCROW_STX, condition: "eq", amount: "1000000" },
    ]);

    const refunded = builder.refundNoDelivery({ asset: "sbtc", jobId: 7, budget: 5_000n, recipient: CLIENT });
    expect(refunded.functionName).toBe("refund-no-delivery");
    expect(refunded.postConditions[0]).toMatchObject({ address: ESCROW_SBTC, condition: "eq", amount: "5000" });
    expect(clarityCode(() => builder.settleJob({ asset: "sbtc", jobId: 6, budget: 10n }))).toBe(308n);
  });

  it("closes, rates and retries without moving funds", () => {
    expect(builder.closeUnfunded({ asset: "sbtc", jobId: 8 }).postConditions).toEqual([]);
    expect(builder.retryReputation({ asset: "stx", jobId: 8 }).functionName).toBe("retry-reputation");
    expect(builder.rateProvider({ asset: "sbtc", jobId: 8, score: 5 }).functionArgs).toEqual([
      Cl.uint(8n),
      Cl.uint(5n),
    ]);
    expect(clarityCode(() => builder.rateProvider({ asset: "sbtc", jobId: 8, score: 0 }))).toBe(205n);
    expect(clarityCode(() => builder.rateProvider({ asset: "sbtc", jobId: 8, score: 6 }))).toBe(205n);
  });

  it("allows and disallows a contract caller per target", () => {
    const helper = `${DEPLOYER}.helper` as const;
    const allowed = builder.allowContractCaller({ caller: helper, target: "escrowSbtc", until: 900_000 });
    expect(allowed.contract).toBe(`${DEPLOYER}.nayori-permissions`);
    expect(allowed.functionArgs).toEqual([
      Cl.contractPrincipal(DEPLOYER, "helper"),
      Cl.contractPrincipal(DEPLOYER, "nayori-escrow-sbtc"),
      Cl.some(Cl.uint(900_000n)),
    ]);
    const open = builder.allowContractCaller({ caller: helper, target: APPLICATIONS });
    expect(open.functionArgs[2]).toEqual(Cl.none());
    expect(builder.disallowContractCaller({ caller: helper, target: "agents" }).functionArgs).toEqual([
      Cl.contractPrincipal(DEPLOYER, "helper"),
      Cl.contractPrincipal(DEPLOYER, "nayori-agents"),
    ]);
    expect(() => builder.allowContractCaller({ caller: CLIENT as never, target: "agents" })).toThrow(
      /contract id/
    );
  });

  it("builds role handovers", () => {
    const proposed = builder.proposeHandover({ role: "appeal-authority", candidate: PROVIDER });
    expect(proposed.contract).toBe(`${DEPLOYER}.nayori-roles`);
    expect(proposed.functionArgs).toEqual([Cl.uint(2n), Cl.principal(PROVIDER)]);
    expect(builder.cancelHandover("treasury").functionArgs).toEqual([Cl.uint(1n)]);
    expect(builder.acceptHandover("treasury").functionName).toBe("accept-handover");
    expect(clarityCode(() => builder.cancelHandover("owner" as never))).toBe(100n);
  });

  it("registers and updates an agent for the signing wallet", () => {
    const plan = builder.registerAgent({ name: "Research Agent", uri: "" });
    expect(plan.contract).toBe(`${DEPLOYER}.nayori-agents`);
    expect(plan.functionName).toBe("register");
    expect(plan.functionArgs).toEqual([Cl.stringAscii("Research Agent"), Cl.stringAscii("")]);
    expect(builder.updateAgent({ name: "R", uri: "https://agent.example" }).functionName).toBe("update");
    expect(clarityCode(() => builder.registerAgent({ name: "", uri: "" }))).toBe(503n);
    expect(() => builder.registerAgent({ name: "x".repeat(65), uri: "" })).toThrow(PerkOSError);
    expect(() => builder.registerAgent({ name: "a", uri: "u".repeat(257) })).toThrow(PerkOSError);
  });

  it("applies with an exact deposit and a bounded displacement refund", () => {
    const plan = builder.applyToJob({ jobId: 9, deposit: 500, sender: PROVIDER });
    expect(plan.contract).toBe(APPLICATIONS);
    expect(plan.functionArgs).toEqual([Cl.uint(9n), Cl.uint(500n)]);
    expect(plan.postConditions).toEqual([
      { type: "ft-postcondition", address: PROVIDER, condition: "eq", amount: "500", asset: `${SBTC}::sbtc-token` },
      { type: "ft-postcondition", address: APPLICATIONS, condition: "lte", amount: "500", asset: `${SBTC}::sbtc-token` },
    ]);
    expect(plan.intent).toMatchObject({ operation: "apply-to-job", asset: "sbtc", amount: 500n, sender: PROVIDER });
    expect(clarityCode(() => builder.applyToJob({ jobId: 9, deposit: 99, sender: PROVIDER }))).toBe(605n);
    expect(clarityCode(() => builder.applyToJob({ jobId: 9, deposit: 1_000_001, sender: PROVIDER }))).toBe(605n);
  });

  it("refunds an application deposit exactly from the contract", () => {
    const withdrawn = builder.withdrawApplication({ jobId: 9, applicant: PROVIDER, deposit: 500 });
    expect(withdrawn.functionName).toBe("withdraw");
    expect(withdrawn.functionArgs).toEqual([Cl.uint(9n)]);
    expect(withdrawn.intent.sender).toBe(PROVIDER);
    expect(withdrawn.postConditions).toEqual([
      { type: "ft-postcondition", address: APPLICATIONS, condition: "eq", amount: "500", asset: `${SBTC}::sbtc-token` },
    ]);
    for (const [method, name] of [
      ["declineApplication", "decline"],
      ["releaseApplication", "release"],
    ] as const) {
      const plan = builder[method]({ jobId: 9, applicant: PROVIDER, deposit: 700 });
      expect(plan.functionName).toBe(name);
      expect(plan.functionArgs).toEqual([Cl.uint(9n), Cl.principal(PROVIDER)]);
      expect(plan.intent.sender).toBeUndefined();
      expect(plan.postConditions[0]).toMatchObject({ address: APPLICATIONS, condition: "eq", amount: "700" });
    }
  });
});
