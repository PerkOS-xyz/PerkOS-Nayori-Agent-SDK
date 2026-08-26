import { x402Facilitator } from "@x402/core/facilitator";
import { Cl } from "@stacks/transactions";
import { describe, expect, it, vi } from "vitest";
import {
  HiroX402TransactionSource,
  InMemoryX402ReplayStore,
  PerkOSX402Facilitator,
  STACKS_X402_NETWORKS,
  createPerkOSX402PaymentRequired,
  perkosX402ReplayKey,
  resolveConfig,
  type PaymentAsset,
  type PaymentPayload,
  type PaymentRequired,
  type PerkOSX402ReplayRecord,
  type PerkOSX402ReplayStore,
  type PerkOSX402TransactionSource,
} from "../src/index.js";

const PAYER = "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH";
const TXID = `0x${"42".repeat(32)}`;
const BLOCK_HASH = `0x${"ab".repeat(32)}`;
const BLOCK_HEIGHT = 8_650_821;
const BLOCK_TIME = 1_785_224_107;
const NOW = (BLOCK_TIME + 13) * 1_000;
const config = resolveConfig({ network: "mainnet" });

interface TransferEventFixture {
  type: "ft_asset" | "stx_asset";
  ft_asset?: {
    type: string;
    sender: string;
    recipient: string;
    amount: string;
    asset_identifier: string;
  };
  stx_asset?: {
    type: string;
    sender: string;
    recipient: string;
    amount: string;
  };
}

interface ContractLogFixture {
  type: "contract_log";
  contract_log: {
    contract_id: string;
    topic: string;
    value: { hex: string };
  };
}

interface TransactionFixture {
  tx_id: string;
  sender: { address: string; nonce: number };
  status: string;
  type: string;
  block: {
    height: number;
    hash: string;
    time: number;
  };
  contract_call: {
    contract_id: string;
    function_name: string;
  };
}

interface EvidenceFixture {
  transaction: TransactionFixture;
  events: {
    total: number;
    results: Array<TransferEventFixture | ContractLogFixture>;
  };
}

function required(asset: PaymentAsset = "sbtc"): PaymentRequired {
  return createPerkOSX402PaymentRequired(config, {
    resource: {
      url: "https://nayori.example/jobs/7/resource",
      description: "Protected agent result",
      mimeType: "application/json",
      serviceName: "Nayori",
    },
    asset,
    jobId: 7n,
    amount: 25_000n,
    maxTimeoutSeconds: 600,
  });
}

function payload(asset: PaymentAsset = "sbtc"): PaymentPayload {
  const paymentRequired = required(asset);
  return {
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted: paymentRequired.accepts[0]!,
    payload: {
      transaction: TXID,
      payer: PAYER,
      jobId: "7",
      amount: "25000",
      asset,
      commerceContract:
        asset === "sbtc"
          ? config.contracts.sbtcCommerce
          : config.contracts.stxCommerce,
      blockHeight: BLOCK_HEIGHT,
      blockHash: BLOCK_HASH,
    },
  };
}

function fundingEventHex(
  asset: PaymentAsset,
  overrides: {
    event?: string;
    jobId?: number;
    amount?: number;
    token?: string;
  } = {}
): string {
  return Cl.serialize(
    Cl.tuple({
      event: Cl.stringAscii(overrides.event ?? "job-funded"),
      "job-id": Cl.uint(overrides.jobId ?? 7),
      amount: Cl.uint(overrides.amount ?? 25_000),
      ...(asset === "sbtc"
        ? { token: Cl.principal(overrides.token ?? config.contracts.sbtcToken) }
        : {}),
    })
  );
}

function transaction(asset: PaymentAsset = "sbtc"): EvidenceFixture {
  const contract =
    asset === "sbtc" ? config.contracts.sbtcCommerce : config.contracts.stxCommerce;
  const transfer = {
    type: "transfer",
    sender: PAYER,
    recipient: contract,
    amount: "25000",
  };
  const transferEvent: TransferEventFixture =
    asset === "sbtc"
      ? {
          type: "ft_asset",
          ft_asset: {
            ...transfer,
            asset_identifier: `${config.contracts.sbtcToken}::${config.contracts.sbtcAssetName}`,
          },
        }
      : { type: "stx_asset", stx_asset: transfer };
  const logEvent: ContractLogFixture = {
    type: "contract_log",
    contract_log: {
      contract_id: contract,
      topic: "print",
      value: { hex: fundingEventHex(asset) },
    },
  };
  return {
    transaction: {
      tx_id: TXID,
      sender: { address: PAYER, nonce: 1 },
      status: "success",
      type: "contract_call",
      block: {
        height: BLOCK_HEIGHT,
        hash: BLOCK_HASH,
        time: BLOCK_TIME,
      },
      contract_call: {
        contract_id: contract,
        function_name: "fund-job",
      },
    },
    events: { total: 2, results: [transferEvent, logEvent] },
  };
}

function fundingLog(evidence: EvidenceFixture): ContractLogFixture["contract_log"] {
  const event = evidence.events.results.find(
    (candidate): candidate is ContractLogFixture => candidate.type === "contract_log"
  );
  if (!event) throw new Error("Missing contract log fixture.");
  return event.contract_log;
}

function sbtcTransfer(
  evidence: EvidenceFixture
): NonNullable<TransferEventFixture["ft_asset"]> {
  const event = evidence.events.results.find(
    (candidate): candidate is TransferEventFixture => candidate.type === "ft_asset"
  );
  if (!event?.ft_asset) throw new Error("Missing sBTC transfer fixture.");
  return event.ft_asset;
}

class FakeTransactionSource implements PerkOSX402TransactionSource {
  raw: unknown | null;
  tip = BLOCK_HEIGHT + 1;
  error: Error | undefined;

  constructor(asset: PaymentAsset = "sbtc") {
    this.raw = transaction(asset);
  }

  async getTransaction(): Promise<unknown | null> {
    if (this.error) throw this.error;
    return this.raw;
  }

  async getChainTip(): Promise<number> {
    if (this.error) throw this.error;
    return this.tip;
  }
}

function facilitator(
  source: PerkOSX402TransactionSource = new FakeTransactionSource(),
  replayStore: PerkOSX402ReplayStore = new InMemoryX402ReplayStore(),
  options: { minConfirmations?: number; clockSkewSeconds?: number; now?: () => number } = {}
) {
  return new PerkOSX402Facilitator({
    config,
    transactionSource: source,
    replayStore,
    minConfirmations: options.minConfirmations ?? 2,
    clockSkewSeconds: options.clockSkewSeconds ?? 0,
    now: options.now ?? (() => NOW),
  });
}

async function invalidReason(
  verifier: PerkOSX402Facilitator,
  paymentPayload = payload(),
  paymentRequired = required()
): Promise<string | undefined> {
  const result = await verifier.verify(paymentPayload, paymentRequired.accepts[0]!);
  expect(result.isValid).toBe(false);
  return result.invalidReason;
}

describe("PerkOS x402 Stacks facilitator", () => {
  it.each(["sbtc", "stx"] as const)(
    "independently verifies an exact %s escrow funding transaction",
    async (asset) => {
      const source = new FakeTransactionSource(asset);
      const verified = await facilitator(source).inspect(
        payload(asset),
        required(asset).accepts[0]!
      );

      expect(verified).toMatchObject({
        network: "mainnet",
        transaction: TXID,
        payer: PAYER,
        asset,
        jobId: 7n,
        amount: 25_000n,
        blockHeight: BLOCK_HEIGHT,
        blockHash: BLOCK_HASH,
        confirmations: 2,
        replayKey: `mainnet:${TXID}`,
      });
    }
  );

  it("registers with the official x402 facilitator", async () => {
    const scheme = facilitator();
    const core = new x402Facilitator().register(
      STACKS_X402_NETWORKS.mainnet,
      scheme
    );

    expect(core.getSupported()).toMatchObject({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: STACKS_X402_NETWORKS.mainnet,
          extra: {
            assetTransferMethod: "perkos-escrow-v1",
            paymentFlow: "upfront",
          },
        },
      ],
      signers: { "stacks:*": [] },
    });
    await expect(
      core.verify(payload(), required().accepts[0]!)
    ).resolves.toMatchObject({ isValid: true, payer: PAYER });
  });

  it("atomically consumes a payment during settlement", async () => {
    const replayStore = new InMemoryX402ReplayStore();
    const scheme = facilitator(new FakeTransactionSource(), replayStore);
    const first = await scheme.settle(payload(), required().accepts[0]!);
    const second = await scheme.settle(payload(), required().accepts[0]!);

    expect(first).toMatchObject({
      success: true,
      transaction: TXID,
      network: STACKS_X402_NETWORKS.mainnet,
      payer: PAYER,
      amount: "25000",
    });
    expect(second).toMatchObject({
      success: false,
      errorReason: "payment_already_used",
    });
    expect(replayStore.get(perkosX402ReplayKey("mainnet", TXID))).toMatchObject({
      payer: PAYER,
      asset: "sbtc",
      jobId: "7",
      amount: "25000",
      resource: "https://nayori.example/jobs/7/resource",
    });
  });

  it("allows exactly one concurrent settlement", async () => {
    const scheme = facilitator();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        scheme.settle(payload(), required().accepts[0]!)
      )
    );

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(
      results.filter(
        (result) => !result.success && result.errorReason === "payment_already_used"
      )
    ).toHaveLength(7);
  });

  it("does not consume replay state when verification fails", async () => {
    const replayStore = new InMemoryX402ReplayStore();
    const source = new FakeTransactionSource();
    sbtcTransfer(source.raw as EvidenceFixture).amount = "24999";
    const scheme = facilitator(source, replayStore);

    await expect(
      scheme.settle(payload(), required().accepts[0]!)
    ).resolves.toMatchObject({ success: false, errorReason: "transfer_mismatch" });
    expect(replayStore.get(perkosX402ReplayKey("mainnet", TXID))).toBeUndefined();
  });

  it("fails closed when atomic replay consumption is unavailable", async () => {
    const replayStore: PerkOSX402ReplayStore = {
      has: async () => false,
      consume: async (_key: string, _record: PerkOSX402ReplayRecord) => {
        throw new Error("database offline");
      },
    };

    await expect(
      facilitator(new FakeTransactionSource(), replayStore).settle(
        payload(),
        required().accepts[0]!
      )
    ).resolves.toMatchObject({
      success: false,
      errorReason: "replay_store_unavailable",
    });
  });

  it("rejects requirements that differ from the payload", async () => {
    const changed = required();
    changed.accepts[0]!.amount = "25001";

    expect(await invalidReason(facilitator(), payload(), changed)).toBe(
      "payment_requirements_mismatch"
    );
  });

  it("rejects a missing transaction", async () => {
    const source = new FakeTransactionSource();
    source.raw = null;

    expect(await invalidReason(facilitator(source))).toBe("transaction_not_found");
  });

  it("fails closed when the transaction source is unavailable", async () => {
    const source = new FakeTransactionSource();
    source.error = new Error("offline");

    expect(await invalidReason(facilitator(source))).toBe("verification_unavailable");
  });

  it("rejects an incomplete transaction event page", async () => {
    const source = new FakeTransactionSource();
    (source.raw as EvidenceFixture).events.total = 3;

    expect(await invalidReason(facilitator(source))).toBe("verification_unavailable");
  });

  it.each([
    ["failed status", (tx: EvidenceFixture): void => { tx.transaction.status = "abort_by_response"; }, "invalid_transaction_state"],
    ["wrong transaction type", (tx: EvidenceFixture): void => { tx.transaction.type = "token_transfer"; }, "invalid_transaction_type"],
    ["wrong payer", (tx: EvidenceFixture): void => { tx.transaction.sender.address = "SP000000000000000000002Q6VF78"; }, "payer_mismatch"],
    ["wrong contract", (tx: EvidenceFixture): void => { tx.transaction.contract_call.contract_id = config.contracts.stxCommerce; }, "contract_mismatch"],
    ["wrong function", (tx: EvidenceFixture): void => { tx.transaction.contract_call.function_name = "complete-job"; }, "function_mismatch"],
    ["wrong job event", (tx: EvidenceFixture): void => { fundingLog(tx).value.hex = fundingEventHex("sbtc", { jobId: 8 }); }, "funding_event_mismatch"],
    ["wrong token event", (tx: EvidenceFixture): void => { fundingLog(tx).value.hex = fundingEventHex("sbtc", { token: config.contracts.stxCommerce }); }, "funding_event_mismatch"],
    ["wrong funding amount event", (tx: EvidenceFixture): void => { fundingLog(tx).value.hex = fundingEventHex("sbtc", { amount: 24_999 }); }, "funding_event_mismatch"],
    ["wrong transfer amount", (tx: EvidenceFixture): void => { sbtcTransfer(tx).amount = "24999"; }, "transfer_mismatch"],
    ["wrong transfer asset", (tx: EvidenceFixture): void => { sbtcTransfer(tx).asset_identifier = "SP000000000000000000002Q6VF78.fake::fake"; }, "transfer_mismatch"],
  ] as const)("rejects a %s", async (_label, mutate, reason) => {
    const source = new FakeTransactionSource();
    const tx = source.raw as EvidenceFixture;
    mutate(tx);

    expect(await invalidReason(facilitator(source))).toBe(reason);
  });

  it("rejects mismatched client proof block metadata", async () => {
    const changedPayload = payload();
    changedPayload.payload.blockHash = `0x${"cd".repeat(32)}`;

    expect(await invalidReason(facilitator(), changedPayload)).toBe(
      "proof_block_mismatch"
    );
  });

  it("rejects insufficient confirmation depth", async () => {
    const source = new FakeTransactionSource();
    source.tip = BLOCK_HEIGHT;

    expect(
      await invalidReason(facilitator(source, new InMemoryX402ReplayStore(), {
        minConfirmations: 2,
      }))
    ).toBe("insufficient_confirmations");
  });

  it("rejects an expired public transaction proof", async () => {
    expect(
      await invalidReason(
        facilitator(new FakeTransactionSource(), new InMemoryX402ReplayStore(), {
          now: () => (BLOCK_TIME + 601) * 1_000,
        })
      )
    ).toBe("payment_expired");
  });

  it("rejects a transaction timestamp in the future", async () => {
    expect(
      await invalidReason(
        facilitator(new FakeTransactionSource(), new InMemoryX402ReplayStore(), {
          now: () => (BLOCK_TIME - 1) * 1_000,
        })
      )
    ).toBe("transaction_time_in_future");
  });

  it("validates Hiro transaction and chain-tip HTTP responses", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const evidence = transaction();
      if (url.endsWith("/v2/info")) {
        return new Response(JSON.stringify({ stacks_tip_height: BLOCK_HEIGHT + 1 }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify(url.includes("/events?") ? evidence.events : evidence.transaction),
        { status: 200 }
      );
    });
    const source = new HiroX402TransactionSource({ network: "mainnet", fetch });

    await expect(source.getTransaction(TXID)).resolves.toMatchObject({
      transaction: { tx_id: TXID },
      events: { total: 2 },
    });
    await expect(source.getChainTip()).resolves.toBe(BLOCK_HEIGHT + 1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://api.hiro.so/extended/v3/transactions/${TXID}`
    );
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `https://api.hiro.so/extended/v3/transactions/${TXID}/events?limit=50`
    );
  });

  it("maps Hiro 404 responses to a missing transaction", async () => {
    const source = new HiroX402TransactionSource({
      network: "testnet",
      fetch: vi.fn(async () => new Response("not found", { status: 404 })),
    });

    await expect(source.getTransaction(TXID)).resolves.toBeNull();
  });

  it("rejects unsafe facilitator confirmation configuration", () => {
    expect(
      () =>
        new PerkOSX402Facilitator({
          config,
          replayStore: new InMemoryX402ReplayStore(),
          minConfirmations: 0,
        })
    ).toThrow("minConfirmations must be a positive safe integer");
  });
});
