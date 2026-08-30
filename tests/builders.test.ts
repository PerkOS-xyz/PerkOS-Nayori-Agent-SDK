import { Cl, ClarityType } from "@stacks/transactions";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEPLOYMENTS,
  PerkOSError,
  PerkOSTransactionBuilder,
  resolveConfig,
} from "../src/index.js";

const CLIENT = "SP1VY24ADP27HERH4XMQTK44XB9QX4ZASPMPJKPVF";
const PROVIDER = "SP3DQCVZ26XCDGZFYB4TXJC6TMMZAVXZTER1DP8HV";
const EVALUATOR = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const PINNED_SBTC =
  "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH.historical-sbtc" as const;
const config = resolveConfig({ network: "mainnet" });
const builder = new PerkOSTransactionBuilder(config);
const candidateBuilder = new PerkOSTransactionBuilder(
  resolveConfig({
    network: "mainnet",
    contracts: {
      stxCommerce: "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH.agentic-commerce-v4",
      sbtcCommerce: "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH.sbtc-commerce-v3",
      reputationRegistry:
        "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH.reputation-registry-v3",
    },
  })
);

describe("transaction builders", () => {
  it("serializes agent registration and endpoints", () => {
    const plan = builder.registerAgent({
      name: "Research Agent",
      description: "Produces cited reports.",
      wallet: CLIENT,
      endpoints: [{ name: "mcp", url: "https://agent.example/mcp" }],
    });

    expect(plan.contract).toBe(DEFAULT_DEPLOYMENTS.mainnet.agentRegistry);
    expect(plan.functionName).toBe("register-agent");
    expect(plan.functionArgs).toHaveLength(4);
    expect(plan.functionArgs[0]?.type).toBe(ClarityType.StringASCII);
    expect(plan.functionArgs[3]?.type).toBe(ClarityType.List);
    expect(plan.postConditionMode).toBe("deny");
  });

  it("builds an exact sBTC funding post-condition", () => {
    const plan = builder.fundJob({
      asset: "sbtc",
      jobId: 7n,
      amount: 25_000n,
      sender: CLIENT,
    });

    expect(plan.contract).toBe(DEFAULT_DEPLOYMENTS.mainnet.sbtcCommerce);
    expect(plan.functionName).toBe("fund-job");
    expect(plan.functionArgs).toHaveLength(2);
    expect(plan.functionArgs[1]?.type).toBe(ClarityType.PrincipalContract);
    expect(plan.postConditions).toEqual([
      {
        type: "ft-postcondition",
        address: CLIENT,
        condition: "eq",
        amount: "25000",
        asset: `${DEFAULT_DEPLOYMENTS.mainnet.sbtcToken}::sbtc-token`,
      },
    ]);
  });

  it("builds an exact STX funding post-condition", () => {
    const plan = builder.fundJob({
      asset: "stx",
      jobId: 9n,
      amount: 1_500_000n,
      sender: CLIENT,
    });

    expect(plan.contract).toBe(DEFAULT_DEPLOYMENTS.mainnet.stxCommerce);
    expect(plan.functionArgs).toHaveLength(1);
    expect(plan.postConditions).toEqual([
      {
        type: "stx-postcondition",
        address: CLIENT,
        condition: "eq",
        amount: "1500000",
      },
    ]);
  });

  it("guards settlement with the escrow contract principal", () => {
    const plan = builder.completeJob({
      asset: "sbtc",
      jobId: 7n,
      amount: "25000",
      recipient: PROVIDER,
    });

    expect(plan.intent.recipient).toBe(PROVIDER);
    expect(plan.postConditionMode).toBe("deny");
    expect(plan.postConditions[0]).toMatchObject({
      type: "ft-postcondition",
      address: DEFAULT_DEPLOYMENTS.mainnet.sbtcCommerce,
      condition: "eq",
      amount: "25000",
    });
  });

  it("builds exact timeout payout plans for both versioned assets", () => {
    const sbtc = candidateBuilder.settleReviewTimeout({
      asset: "sbtc",
      jobId: 7n,
      amount: 25_000n,
      recipient: PROVIDER,
      sbtcToken: PINNED_SBTC,
    });
    const stx = candidateBuilder.settleReviewTimeout({
      asset: "stx",
      jobId: 8n,
      amount: 1_500_000n,
      recipient: PROVIDER,
    });

    expect(sbtc.functionName).toBe("settle-review-timeout");
    expect(sbtc.functionArgs).toHaveLength(2);
    expect(sbtc.functionArgs[1]).toEqual(
      Cl.contractPrincipal(
        "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH",
        "historical-sbtc"
      )
    );
    expect(sbtc.postConditionMode).toBe("deny");
    expect(sbtc.postConditions[0]).toMatchObject({
      type: "ft-postcondition",
      address: candidateBuilder.config.contracts.sbtcCommerce,
      condition: "eq",
      amount: "25000",
      asset: `${PINNED_SBTC}::sbtc-token`,
    });
    expect(stx.functionArgs).toHaveLength(1);
    expect(stx.postConditions[0]).toMatchObject({
      type: "stx-postcondition",
      address: candidateBuilder.config.contracts.stxCommerce,
      condition: "eq",
      amount: "1500000",
    });
  });

  it("builds a deny-mode permissionless reputation retry with no asset transfer", () => {
    const plan = candidateBuilder.retryReputationSync("sbtc", 7n);

    expect(plan.functionName).toBe("retry-reputation-sync");
    expect(plan.functionArgs).toHaveLength(1);
    expect(plan.postConditionMode).toBe("deny");
    expect(plan.postConditions).toEqual([]);
    expect(plan.intent).toMatchObject({
      operation: "retry-reputation-sync",
      asset: "sbtc",
      jobId: 7n,
    });
  });

  it("serializes the complete STX and sBTC lifecycle", () => {
    const create = builder.createJob({
      asset: "sbtc",
      provider: PROVIDER,
      evaluator: EVALUATOR,
      expiredAt: 5_000_000n,
      description: "Produce a market report.",
    });
    const setBudget = builder.setBudget({ asset: "sbtc", jobId: 1n, amount: 50_000n });
    const assign = builder.assignProvider({
      asset: "sbtc",
      jobId: 1n,
      provider: PROVIDER,
    });
    const submit = builder.submitWork({
      asset: "sbtc",
      jobId: 1n,
      deliverable: "ipfs:bafybeigdyr",
    });
    const reject = builder.rejectJob({
      asset: "sbtc",
      jobId: 1n,
      amount: 50_000n,
      recipient: CLIENT,
    });
    const rate = builder.rateProvider({
      asset: "sbtc",
      jobId: 1n,
      score: 5n,
      comment: "Accurate delivery",
    });

    expect([
      create.functionName,
      setBudget.functionName,
      assign.functionName,
      submit.functionName,
      reject.functionName,
      rate.functionName,
    ]).toEqual([
      "create-job",
      "set-budget",
      "assign-provider",
      "submit-work",
      "reject-job",
      "rate-provider",
    ]);
  });

  it("rejects unsafe or contract-incompatible input", () => {
    expect(() =>
      builder.createJob({
        asset: "sbtc",
        provider: PROVIDER,
        evaluator: PROVIDER,
        expiredAt: 5_000_000n,
        description: "Invalid role assignment",
      })
    ).toThrow("provider and evaluator must be different");

    expect(() =>
      builder.submitWork({
        asset: "stx",
        jobId: 1n,
        deliverable: new Uint8Array(65),
      })
    ).toThrowError(PerkOSError);
  });
});
