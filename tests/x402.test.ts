import { x402Client } from "@x402/core/client";
import { describe, expect, it, vi } from "vitest";
import {
  PERKOS_X402_ASSET_TRANSFER_METHOD,
  PerkOSError,
  PerkOSX402SchemeClient,
  STACKS_X402_NETWORKS,
  createPerkOSX402PaymentRequired,
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  encodePaymentSignatureHeader,
  fromStacksX402Network,
  parsePerkOSX402PaymentPayload,
  parsePerkOSX402Requirement,
  resolveConfig,
  toStacksX402Network,
  type FundJobInput,
  type JobRecord,
  type PaymentAsset,
  type PaymentRequired,
  type PerkOSX402ClientLike,
  type TransactionConfirmation,
  type TransactionReceipt,
} from "../src/index.js";

const CLIENT = "SP1VY24ADP27HERH4XMQTK44XB9QX4ZASPMPJKPVF";
const EVALUATOR = "SP3DQCVZ26XCDGZFYB4TXJC6TMMZAVXZTER1DP8HV";
const TXID = `0x${"42".repeat(32)}`;
const config = resolveConfig({ network: "mainnet" });

function resource() {
  return {
    url: "https://agent.example/jobs/7/fund",
    description: "Fund job 7 escrow",
    mimeType: "application/json",
    serviceName: "Nayori",
    tags: ["agents", "escrow"],
  };
}

function paymentRequired(asset: PaymentAsset = "sbtc"): PaymentRequired {
  return createPerkOSX402PaymentRequired(config, {
    resource: resource(),
    asset,
    jobId: 7n,
    amount: 25_000n,
  });
}

function openJob(asset: PaymentAsset = "sbtc"): JobRecord {
  return {
    id: 7n,
    asset,
    client: CLIENT,
    evaluator: EVALUATOR,
    description: "x402 integration test",
    budget: 25_000n,
    expiredAt: 99_999n,
    status: "open",
    statusCode: 0n,
  };
}

class FakeX402Client implements PerkOSX402ClientLike {
  readonly config = config;
  job: JobRecord | null = openJob();
  confirmationStatus: TransactionConfirmation["status"] = "success";
  readonly fundJob = vi.fn(async (input: FundJobInput): Promise<TransactionReceipt> => ({
    txid: TXID,
    status: "broadcast",
    network: this.config.network,
    contract:
      input.asset === "sbtc"
        ? this.config.contracts.sbtcCommerce
        : this.config.contracts.stxCommerce,
    operation: "fund-job",
    asset: input.asset,
    amount: BigInt(input.amount),
    jobId: BigInt(input.jobId),
    explorerUrl: `https://explorer.hiro.so/txid/${TXID}?chain=mainnet`,
  }));
  readonly confirm = vi.fn(
    async (): Promise<TransactionConfirmation> => ({
      txid: TXID,
      network: "mainnet",
      status: this.confirmationStatus,
      observedAt: "2026-08-25T00:00:00.000Z",
      blockHeight: 5_000,
      blockHash: "0xblock",
    })
  );

  async getJob(): Promise<JobRecord | null> {
    return this.job;
  }
}

describe("Stacks x402 v2 foundation", () => {
  it("maps the canonical Stacks CAIP-2 network identifiers", () => {
    expect(toStacksX402Network("mainnet")).toBe("stacks:1");
    expect(toStacksX402Network("testnet")).toBe("stacks:2147483648");
    expect(fromStacksX402Network("stacks:1")).toBe("mainnet");
    expect(fromStacksX402Network("stacks:2147483648")).toBe("testnet");
    expect(() => fromStacksX402Network("eip155:8453")).toThrow(PerkOSError);
  });

  it.each([
    ["sbtc", `${config.contracts.sbtcToken}::${config.contracts.sbtcAssetName}`],
    ["stx", "STX"],
  ] as const)("builds a strict %s escrow payment requirement", (asset, expectedAsset) => {
    const required = paymentRequired(asset);
    const accepted = required.accepts[0]!;

    expect(required).toMatchObject({
      x402Version: 2,
      resource: { url: resource().url, serviceName: "Nayori" },
    });
    expect(accepted).toMatchObject({
      scheme: "exact",
      network: STACKS_X402_NETWORKS.mainnet,
      amount: "25000",
      asset: expectedAsset,
      payTo:
        asset === "sbtc"
          ? config.contracts.sbtcCommerce
          : config.contracts.stxCommerce,
      maxTimeoutSeconds: 600,
      extra: {
        assetTransferMethod: PERKOS_X402_ASSET_TRANSFER_METHOD,
        paymentFlow: "upfront",
        paymentAsset: asset,
        jobId: "7",
      },
    });
    expect(parsePerkOSX402Requirement(config, accepted)).toMatchObject({
      network: "mainnet",
      asset,
      jobId: 7n,
      amount: 25_000n,
    });
  });

  it("round-trips official x402 v2 required and response headers", () => {
    const required = paymentRequired();
    const settlement = {
      success: true,
      payer: CLIENT,
      transaction: TXID,
      network: STACKS_X402_NETWORKS.mainnet,
      amount: "25000",
    } as const;

    expect(decodePaymentRequiredHeader(encodePaymentRequiredHeader(required))).toEqual(
      required
    );
    expect(decodePaymentResponseHeader(encodePaymentResponseHeader(settlement))).toEqual(
      settlement
    );
  });

  it("creates a confirmed funding proof through the official x402 client", async () => {
    const fake = new FakeX402Client();
    const scheme = new PerkOSX402SchemeClient({ client: fake });
    const client = new x402Client()
      .setSpendControls(false)
      .register(STACKS_X402_NETWORKS.mainnet, scheme);

    const payload = await client.createPaymentPayload(paymentRequired());
    const decoded = decodePaymentSignatureHeader(
      encodePaymentSignatureHeader(payload)
    );
    const proof = parsePerkOSX402PaymentPayload(config, decoded);

    expect(proof).toMatchObject({
      network: "mainnet",
      asset: "sbtc",
      jobId: 7n,
      amount: 25_000n,
      transaction: TXID,
      payer: CLIENT,
      blockHeight: 5_000,
    });
    expect(fake.fundJob).toHaveBeenCalledWith({
      asset: "sbtc",
      jobId: 7n,
      amount: 25_000n,
      sender: CLIENT,
    });
    expect(fake.confirm).toHaveBeenCalledTimes(1);
  });

  it("rejects requirements for another network", () => {
    const required = paymentRequired();
    required.accepts[0]!.network = STACKS_X402_NETWORKS.testnet;

    expect(() => parsePerkOSX402Requirement(config, required.accepts[0]!)).toThrow(
      "does not match the SDK client network"
    );
  });

  it("rejects unsupported protocol versions", async () => {
    const fake = new FakeX402Client();
    const scheme = new PerkOSX402SchemeClient({ client: fake });

    await expect(
      scheme.createPaymentPayload(1, paymentRequired().accepts[0]!)
    ).rejects.toThrow("x402Version must be 2");
  });

  it.each([0n, -1n])("rejects a non-positive amount of %s", (amount) => {
    expect(() =>
      createPerkOSX402PaymentRequired(config, {
        resource: resource(),
        asset: "sbtc",
        jobId: 7n,
        amount,
      })
    ).toThrow(PerkOSError);
  });

  it.each([
    ["asset", "not-sbtc"],
    ["payTo", CLIENT],
  ] as const)("rejects a mismatched %s", (field, value) => {
    const required = paymentRequired();
    Object.assign(required.accepts[0]!, { [field]: value });

    expect(() => parsePerkOSX402Requirement(config, required.accepts[0]!)).toThrow(
      PerkOSError
    );
  });

  it("rejects altered transfer metadata", () => {
    const required = paymentRequired();
    required.accepts[0]!.extra.assetTransferMethod = "direct";

    expect(() => parsePerkOSX402Requirement(config, required.accepts[0]!)).toThrow(
      `assetTransferMethod must be ${PERKOS_X402_ASSET_TRANSFER_METHOD}`
    );
  });

  it("refuses to fund when the on-chain job budget differs from the quote", async () => {
    const fake = new FakeX402Client();
    fake.job = { ...openJob(), budget: 30_000n };
    const scheme = new PerkOSX402SchemeClient({ client: fake });

    await expect(
      scheme.createPaymentPayload(2, paymentRequired().accepts[0]!)
    ).rejects.toThrow("budget does not match");
    expect(fake.fundJob).not.toHaveBeenCalled();
  });

  it("does not issue a payment proof for a non-success confirmation", async () => {
    const fake = new FakeX402Client();
    fake.confirmationStatus = "abort";
    const scheme = new PerkOSX402SchemeClient({ client: fake });

    await expect(
      scheme.createPaymentPayload(2, paymentRequired().accepts[0]!)
    ).rejects.toMatchObject({ code: "X402_PAYMENT_FAILED" });
  });

  it("rejects a payment proof that no longer matches its accepted requirement", async () => {
    const fake = new FakeX402Client();
    const scheme = new PerkOSX402SchemeClient({ client: fake });
    const result = await scheme.createPaymentPayload(2, paymentRequired().accepts[0]!);
    const payload = {
      ...result,
      accepted: paymentRequired().accepts[0]!,
    };
    payload.payload.amount = "1";

    expect(() => parsePerkOSX402PaymentPayload(config, payload)).toThrow(
      "payload.amount does not match"
    );
  });
});
