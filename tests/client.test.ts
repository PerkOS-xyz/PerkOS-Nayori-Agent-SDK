import { Cl } from "@stacks/transactions";
import { describe, expect, it, vi } from "vitest";
import type {
  ContractCallPlan,
  PerkOSSigner,
  ReadOnlyTransport,
  TransactionTrackerLike,
} from "../src/index.js";
import { PerkOSClient, PerkOSError } from "../src/index.js";

const CLIENT = "SP1VY24ADP27HERH4XMQTK44XB9QX4ZASPMPJKPVF";
const PROVIDER = "SP3DQCVZ26XCDGZFYB4TXJC6TMMZAVXZTER1DP8HV";
const EVALUATOR = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const BROADCAST_TXID = `0x${"ab".repeat(32)}`;
const SETTLED_TXID = `0x${"cd".repeat(32)}`;

function jobResponse() {
  return Cl.ok(
    Cl.tuple({
      client: Cl.principal(CLIENT),
      provider: Cl.some(Cl.principal(PROVIDER)),
      evaluator: Cl.principal(EVALUATOR),
      description: Cl.stringAscii("Research job"),
      budget: Cl.uint(25_000n),
      "expired-at": Cl.uint(5_000_000n),
      status: Cl.uint(2n),
      deliverable: Cl.some(Cl.bufferFromAscii("ipfs:bafy")),
    })
  );
}

describe("PerkOSClient", () => {
  it("parses agents, jobs, escrow, and reputation from Clarity values", async () => {
    const transport: ReadOnlyTransport = vi.fn(async (call) => {
      switch (call.functionName) {
        case "get-agent-count":
          return Cl.ok(Cl.uint(12n));
        case "get-agent":
          return Cl.ok(
            Cl.tuple({
              name: Cl.stringAscii("Research Agent"),
              description: Cl.stringAscii("Produces cited reports"),
              creator: Cl.principal(CLIENT),
              wallet: Cl.principal(PROVIDER),
              active: Cl.bool(true),
              endpoints: Cl.list([
                Cl.tuple({
                  name: Cl.stringAscii("mcp"),
                  url: Cl.stringAscii("https://agent.example/mcp"),
                }),
              ]),
            })
          );
        case "get-job":
          return jobResponse();
        case "get-escrow-balance":
          return Cl.ok(Cl.uint(25_000n));
        case "get-reputation":
          return Cl.ok(
            Cl.tuple({
              "total-score": Cl.uint(9n),
              "rating-count": Cl.uint(2n),
              "average-score-x100": Cl.uint(450n),
              "completed-jobs": Cl.uint(3n),
              "disputed-jobs": Cl.uint(1n),
            })
          );
        default:
          throw new Error(`Unexpected function ${call.functionName}`);
      }
    });
    const client = new PerkOSClient({ network: "mainnet", readOnlyTransport: transport });

    expect(await client.getAgentCount()).toBe(12n);
    expect(await client.getAgent(1n)).toMatchObject({
      id: 1n,
      name: "Research Agent",
      wallet: PROVIDER,
      endpoints: [{ name: "mcp", url: "https://agent.example/mcp" }],
    });
    expect(await client.getJob("sbtc", 7n)).toMatchObject({
      id: 7n,
      provider: PROVIDER,
      status: "submitted",
      budget: 25_000n,
    });
    expect(await client.getEscrowBalance("sbtc", 7n)).toBe(25_000n);
    expect(await client.getReputation(PROVIDER)).toMatchObject({
      averageScoreX100: 450n,
      completedJobs: 3n,
    });
  });

  it("returns null for missing on-chain records", async () => {
    const transport: ReadOnlyTransport = async (call) =>
      call.functionName === "get-agent"
        ? Cl.error(Cl.uint(102n))
        : Cl.error(Cl.uint(302n));
    const client = new PerkOSClient({ network: "mainnet", readOnlyTransport: transport });

    expect(await client.getAgent(999n)).toBeNull();
    expect(await client.getJob("sbtc", 999n)).toBeNull();
  });

  it("does not invoke a signer when policy rejects funding", async () => {
    const getAddress = vi.fn(async () => CLIENT);
    const signAndBroadcast = vi.fn(async () => ({ txid: "0xdenied" }));
    const signer: PerkOSSigner = {
      getAddress,
      signAndBroadcast,
    };
    const client = new PerkOSClient({ network: "mainnet", signer });

    await expect(
      client.fundJob({ asset: "sbtc", jobId: 7n, amount: 1n })
    ).rejects.toBeInstanceOf(PerkOSError);
    expect(getAddress).not.toHaveBeenCalled();
    expect(signAndBroadcast).not.toHaveBeenCalled();
  });

  it("broadcasts approved funding and returns a structured receipt", async () => {
    const seen: ContractCallPlan[] = [];
    const signer: PerkOSSigner = {
      getAddress: async () => CLIENT,
      signAndBroadcast: async (plan) => {
        seen.push(plan);
        return { txid: BROADCAST_TXID };
      },
    };
    const client = new PerkOSClient({
      network: "mainnet",
      signer,
      spendingPolicy: {
        allowedAssets: ["sbtc"],
        maxPerTransaction: { sbtc: 50_000n },
        maxPerSession: { sbtc: 75_000n },
      },
    });

    const receipt = await client.fundJob({
      asset: "sbtc",
      jobId: 7n,
      amount: "25000",
    });

    expect(seen[0]?.intent.sender).toBe(CLIENT);
    expect(seen[0]?.postConditions[0]).toMatchObject({
      address: CLIENT,
      amount: "25000",
    });
    expect(receipt).toMatchObject({
      txid: BROADCAST_TXID,
      operation: "fund-job",
      asset: "sbtc",
      amount: 25_000n,
      jobId: 7n,
      status: "broadcast",
    });
    expect(client.policy.spentThisSession("sbtc")).toBe(25_000n);
  });

  it("reads current escrow before signing settlement", async () => {
    const transport: ReadOnlyTransport = async (call) =>
      call.functionName === "get-job"
        ? jobResponse()
        : Cl.ok(Cl.uint(25_000n));
    let signedPlan: ContractCallPlan | undefined;
    const signer: PerkOSSigner = {
      getAddress: async () => EVALUATOR,
      signAndBroadcast: async (plan) => {
        signedPlan = plan;
        return { txid: SETTLED_TXID };
      },
    };
    const client = new PerkOSClient({
      network: "mainnet",
      signer,
      readOnlyTransport: transport,
    });

    await client.completeJob("sbtc", 7n);

    expect(signedPlan?.intent.recipient).toBe(PROVIDER);
    expect(signedPlan?.postConditions[0]).toMatchObject({
      address: client.config.contracts.sbtcCommerce,
      amount: "25000",
    });
  });

  it("can execute and wait for a normalized confirmation receipt", async () => {
    const signer: PerkOSSigner = {
      getAddress: async () => CLIENT,
      signAndBroadcast: async () => ({ txid: BROADCAST_TXID }),
    };
    const waitForConfirmation = vi.fn(async (txid: string) => ({
      txid,
      network: "mainnet" as const,
      status: "success" as const,
      observedAt: "2026-08-05T00:00:00.000Z",
      blockHeight: 12,
    }));
    const tracker: TransactionTrackerLike = {
      getStatus: waitForConfirmation,
      waitForConfirmation,
    };
    const client = new PerkOSClient({
      network: "mainnet",
      signer,
      transactionTracker: tracker,
    });
    const plan = client.transactions.registerAgent({
      name: "Research Agent",
      description: "Produces cited reports",
      wallet: CLIENT,
    });

    const receipt = await client.executeAndConfirm(plan, { timeoutMs: 30_000 });

    expect(receipt.broadcast.txid).toBe(BROADCAST_TXID);
    expect(receipt.confirmation).toMatchObject({
      txid: BROADCAST_TXID,
      status: "success",
      blockHeight: 12,
    });
    expect(waitForConfirmation).toHaveBeenCalledWith(BROADCAST_TXID, {
      timeoutMs: 30_000,
    });
  });
});
