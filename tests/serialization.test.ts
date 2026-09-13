import {
  makeUnsignedContractCall,
  privateKeyToPublic,
  serializeTransaction,
} from "@stacks/transactions";
import { describe, expect, it } from "vitest";
import {
  PerkOSTransactionBuilder,
  quoteServiceFee,
  resolveConfig,
  type ContractCallPlan,
} from "../src/index.js";

const CLIENT = "SP1VY24ADP27HERH4XMQTK44XB9QX4ZASPMPJKPVF";
const PROVIDER = "SP3DQCVZ26XCDGZFYB4TXJC6TMMZAVXZTER1DP8HV";
const TREASURY = "SP1NT1V4X6GQR6T32Z8MSMNECZ6GSWX9HZ81SM1Y8";
const PUBLIC_KEY = privateKeyToPublic(
  "000000000000000000000000000000000000000000000000000000000000000101"
);
const builder = new PerkOSTransactionBuilder(resolveConfig({ network: "mainnet" }));

async function serialize(plan: ContractCallPlan) {
  const [contractAddress, contractName] = plan.contract.split(".");
  if (!contractAddress || !contractName) throw new Error("Invalid test contract");
  const transaction = await makeUnsignedContractCall({
    contractAddress,
    contractName,
    functionName: plan.functionName,
    functionArgs: [...plan.functionArgs],
    publicKey: PUBLIC_KEY,
    network: plan.network,
    fee: 500n,
    nonce: 0n,
    postConditionMode: plan.postConditionMode,
    postConditions: [...plan.postConditions],
  });
  return serializeTransaction(transaction);
}

describe("Stacks transaction serialization", () => {
  it("serializes a guarded sBTC funding plan without network access", async () => {
    const plan = builder.fundJob({
      asset: "sbtc",
      jobId: 7n,
      amount: 25_000n,
      sender: CLIENT,
      serviceFeeAcceptance: {
        gross: 25_000n,
        basisPoints: 200,
        treasury: TREASURY,
        rejectionRefund: "net-after-evaluation",
      },
    });

    await expect(serialize(plan)).resolves.toMatch(/^[0-9a-f]+$/);
  });

  it("serializes a contract-principal settlement post-condition", async () => {
    const plan = builder.finalizeDecision({
      asset: "sbtc",
      jobId: 7n,
      amount: 25_000n,
      recipient: PROVIDER,
      sbtcToken: builder.config.contracts.sbtcToken,
      serviceFee: {
        ...quoteServiceFee(25_000n),
        treasury: TREASURY,
        waived: false,
      },
    });

    await expect(serialize(plan)).resolves.toMatch(/^[0-9a-f]+$/);
  });

  it("serializes the versioned timeout payout with an exact deny post-condition", async () => {
    const plan = builder.settleReviewTimeout({
      asset: "sbtc",
      jobId: 7n,
      amount: 25_000n,
      recipient: PROVIDER,
    });

    expect(plan.functionName).toBe("settle-review-timeout");
    expect(plan.postConditionMode).toBe("deny");
    await expect(serialize(plan)).resolves.toMatch(/^[0-9a-f]+$/);
  });
});
