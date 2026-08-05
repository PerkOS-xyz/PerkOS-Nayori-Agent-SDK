import { describe, expect, it, vi } from "vitest";
import {
  HeadlessSigner,
  PerkOSClient,
  PerkOSError,
  StacksConnectSigner,
} from "../src/index.js";

const PRIVATE_KEY =
  "000000000000000000000000000000000000000000000000000000000000000101";
const TESTNET_ADDRESS = "ST1THWXQ8368SDN2MJGE4BMDKMCHZ2GSVTSQDA7QF";
const TXID = `0x${"12".repeat(32)}`;

function registrationPlan() {
  const client = new PerkOSClient({ network: "testnet" });
  return client.transactions.registerAgent({
    name: "Research Agent",
    description: "Produces cited research",
    wallet: TESTNET_ADDRESS,
  });
}

describe("HeadlessSigner", () => {
  it("derives and caches the public address without retaining key material", async () => {
    const privateKeyProvider = vi.fn(async () => PRIVATE_KEY);
    const signer = new HeadlessSigner({ network: "testnet", privateKeyProvider });

    await expect(signer.getAddress()).resolves.toBe(TESTNET_ADDRESS);
    await expect(signer.getAddress()).resolves.toBe(TESTNET_ADDRESS);
    expect(privateKeyProvider).toHaveBeenCalledTimes(1);
  });

  it("uses an injected executor and zeroes its local binary key copy", async () => {
    const source = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    let executorKey: Uint8Array | undefined;
    const transactionExecutor = vi.fn(async ({ privateKey }) => {
      expect(privateKey).toBeInstanceOf(Uint8Array);
      executorKey = privateKey as Uint8Array;
      expect(executorKey.some((byte) => byte !== 0)).toBe(true);
      return { txid: TXID };
    });
    const signer = new HeadlessSigner({
      network: "testnet",
      privateKeyProvider: () => source,
      transactionExecutor,
    });

    await expect(signer.signAndBroadcast(registrationPlan())).resolves.toEqual({
      txid: TXID,
    });
    expect(executorKey?.every((byte) => byte === 0)).toBe(true);
    expect(source.some((byte) => byte !== 0)).toBe(true);
  });

  it("rejects a plan from another network before requesting a key", async () => {
    const privateKeyProvider = vi.fn(async () => PRIVATE_KEY);
    const signer = new HeadlessSigner({ network: "mainnet", privateKeyProvider });

    await expect(signer.signAndBroadcast(registrationPlan())).rejects.toMatchObject({
      code: "SIGNER_MISMATCH",
    });
    expect(privateKeyProvider).not.toHaveBeenCalled();
  });

  it("validates custom API URLs", () => {
    expect(
      () =>
        new HeadlessSigner({
          network: "testnet",
          privateKeyProvider: () => PRIVATE_KEY,
          apiUrl: "file:///tmp/node",
        })
    ).toThrowError(PerkOSError);
  });

  it("wraps failures from the external key provider", async () => {
    const signer = new HeadlessSigner({
      network: "testnet",
      privateKeyProvider: async () => {
        throw new Error("secret manager unavailable");
      },
    });

    await expect(signer.getAddress()).rejects.toMatchObject({
      code: "SIGNING_FAILED",
    });
  });
});

describe("StacksConnectSigner", () => {
  it("forwards the complete contract-call plan to Stacks Connect", async () => {
    const request = vi.fn(async () => ({ txId: TXID.slice(2).toUpperCase() }));
    const signer = new StacksConnectSigner({
      network: "testnet",
      address: TESTNET_ADDRESS,
      request,
    });
    const plan = registrationPlan();

    await expect(signer.signAndBroadcast(plan)).resolves.toMatchObject({ txid: TXID });
    expect(request).toHaveBeenCalledWith("stx_callContract", {
      contract: plan.contract,
      functionName: plan.functionName,
      functionArgs: [...plan.functionArgs],
      network: "testnet",
      postConditions: [...plan.postConditions],
      postConditionMode: "deny",
      sponsored: false,
    });
  });

  it("surfaces wallet cancellation without inventing a transaction ID", async () => {
    const signer = new StacksConnectSigner({
      network: "testnet",
      address: TESTNET_ADDRESS,
      request: async () => {
        throw new Error("User cancelled");
      },
    });

    await expect(signer.signAndBroadcast(registrationPlan())).rejects.toMatchObject({
      code: "SIGNING_FAILED",
    });
  });

  it("rejects successful-looking wallet responses without a transaction ID", async () => {
    const signer = new StacksConnectSigner({
      network: "testnet",
      address: TESTNET_ADDRESS,
      request: async () => ({ result: {} }),
    });

    await expect(signer.signAndBroadcast(registrationPlan())).rejects.toMatchObject({
      code: "BROADCAST_REJECTED",
    });
  });
});
