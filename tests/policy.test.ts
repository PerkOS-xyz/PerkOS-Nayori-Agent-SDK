import { describe, expect, it } from "vitest";
import {
  PerkOSError,
  PerkOSTransactionBuilder,
  SpendingPolicy,
  resolveConfig,
} from "../src/index.js";

const CLIENT = "SP1VY24ADP27HERH4XMQTK44XB9QX4ZASPMPJKPVF";
const config = resolveConfig({ network: "mainnet" });
const builder = new PerkOSTransactionBuilder(config);

function funding(amount: bigint) {
  return builder.fundJob({
    asset: "sbtc",
    jobId: 7n,
    amount,
    sender: CLIENT,
  });
}

describe("spending policy", () => {
  it("fails closed when a funding limit is missing", () => {
    const policy = new SpendingPolicy(config);

    expect(() => policy.authorize(funding(1n))).toThrowError(PerkOSError);
    expect(() => policy.authorize(funding(1n))).toThrow("requires maxPerTransaction.sbtc");
  });

  it("enforces transaction and cumulative session limits", () => {
    const policy = new SpendingPolicy(config, {
      allowedAssets: ["sbtc"],
      maxPerTransaction: { sbtc: 50_000n },
      maxPerSession: { sbtc: 75_000n },
    });

    const first = funding(50_000n);
    expect(policy.authorize(first).remainingThisSession).toBe(25_000n);
    policy.record(first);
    expect(policy.spentThisSession("sbtc")).toBe(50_000n);
    expect(() => policy.authorize(funding(30_000n))).toThrow("session limit");
    expect(() => policy.authorize(funding(50_001n))).toThrow("per-transaction limit");
  });

  it("rejects calls to an unapproved contract", () => {
    const policy = new SpendingPolicy(config, {
      maxPerTransaction: { sbtc: 50_000n },
      maxPerSession: { sbtc: 75_000n },
    });
    const original = funding(1n);
    const tampered = {
      ...original,
      contract:
        "SP000000000000000000002Q6VF78.not-perkos" as typeof original.contract,
    };

    expect(() => policy.authorize(tampered)).toThrow("is not allowed");
  });

  it("allows non-spending protocol operations without a spend limit", () => {
    const policy = new SpendingPolicy(config);
    const plan = builder.registerAgent({
      name: "Agent",
      description: "A safe agent",
      wallet: CLIENT,
    });

    expect(policy.authorize(plan)).toEqual({ operation: "register-agent" });
  });
});
