import { Cl, type ClarityValue } from "@stacks/transactions";
import { describe, expect, it, vi } from "vitest";
import {
  PerkOSClient,
  PerkOSTransactionBuilder,
  quoteServiceFee,
  resolveConfig,
  SpendingPolicy,
  supportsServiceFees,
} from "../src/index.js";
import type {
  ContractCallPlan,
  PaymentAsset,
  ReadOnlyCall,
} from "../src/index.js";
import {
  parseJobServiceFee,
  parseServiceFeePolicy,
} from "../src/service-fees.js";

// Public fixtures only; no signing material and no RPC requests.
const CLIENT = "SP1VY24ADP27HERH4XMQTK44XB9QX4ZASPMPJKPVF";
const PROVIDER = "SP3DQCVZ26XCDGZFYB4TXJC6TMMZAVXZTER1DP8HV";
const EVALUATOR = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const AUTHORITY = "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH";
const TREASURY = "SP000000000000000000002Q6VF78";
const TOKEN = `${AUTHORITY}.historical-sbtc` as const;
const contracts = {
  stxCommerce: `${AUTHORITY}.agentic-commerce-v6`,
  sbtcCommerce: `${AUTHORITY}.sbtc-commerce-v5`,
} as const;
const config = resolveConfig({ network: "mainnet", contracts });
const builder = new PerkOSTransactionBuilder(config);
const hash = "11".repeat(32);
const acceptance = {
  gross: 1000n,
  basisPoints: 200,
  treasury: TREASURY,
  rejectionRefund: "net-after-evaluation",
} as const;
const split = { ...quoteServiceFee(1000n), treasury: TREASURY, waived: false };
type Fields = Record<string, ClarityValue>;

function policy(fields: Fields = {}) {
  return Cl.ok(
    Cl.tuple({
      configured: Cl.bool(true),
      "service-fee-bps": Cl.uint(200),
      treasury: Cl.principal(TREASURY),
      "review-window": Cl.uint(12),
      "appeal-window": Cl.uint(144),
      "appeal-authority": Cl.principal(AUTHORITY),
      ...fields,
    })
  );
}
function fee(fields: Fields = {}) {
  return Cl.ok(
    Cl.tuple({
      "basis-points": Cl.uint(200),
      treasury: Cl.principal(TREASURY),
      "fee-amount": Cl.uint(20),
      "service-recorded": Cl.bool(true),
      waiver: Cl.none(),
      settlement: Cl.none(),
      ...fields,
    })
  );
}
function settlement(fields: Fields = {}) {
  return Cl.some(
    Cl.tuple({
      gross: Cl.uint(1000),
      recipient: Cl.principal(PROVIDER),
      net: Cl.uint(980),
      "charged-fee": Cl.uint(20),
      "refunded-fee": Cl.uint(0),
      ...fields,
    })
  );
}
function job(fields: Fields = {}) {
  return Cl.ok(
    Cl.tuple({
      client: Cl.principal(CLIENT),
      provider: Cl.some(Cl.principal(PROVIDER)),
      evaluator: Cl.principal(EVALUATOR),
      "appeal-authority": Cl.principal(AUTHORITY),
      treasury: Cl.principal(TREASURY),
      description: Cl.stringAscii("Fee test"),
      budget: Cl.uint(1000),
      "expired-at": Cl.uint(9000000),
      status: Cl.uint(7),
      deliverable: Cl.none(),
      ...fields,
    })
  );
}
function decision() {
  return Cl.ok(
    Cl.tuple({
      "original-decision": Cl.uint(1),
      "final-decision": Cl.none(),
      "evidence-hash": Cl.bufferFromHex(hash),
      "explanation-hash": Cl.bufferFromHex(hash),
      "decided-at-burn": Cl.uint(900000),
      "appeal-deadline": Cl.uint(900144),
      "appealed-by": Cl.none(),
      "appeal-evidence-hash": Cl.none(),
      "resolution-deadline": Cl.none(),
      "resolution-hash": Cl.none(),
      "finalized-by": Cl.none(),
      "finalized-at-burn": Cl.none(),
    })
  );
}
function client(
  overrides: Record<string, ClarityValue> = {},
  address = CLIENT,
  limits = true
) {
  const getAddress = vi.fn(async () => address);
  const signAndBroadcast = vi.fn(async (_plan: ContractCallPlan) => ({
    txid: "ab".repeat(32),
  }));
  const readOnlyTransport = vi.fn(async (call: ReadOnlyCall) => {
    if (call.functionName in overrides) return overrides[call.functionName]!;
    switch (call.functionName) {
      case "get-protocol-config":
        return policy();
      case "get-job-service-fee":
        return fee();
      case "get-job":
        return job();
      case "get-escrow-balance":
        return Cl.ok(Cl.uint(1000));
      case "get-job-payment-token":
        return Cl.ok(Cl.principal(TOKEN));
      case "get-decision":
        return decision();
      default:
        throw new Error(`Unexpected read ${call.functionName}`);
    }
  });
  return {
    sdk: new PerkOSClient({
      network: "mainnet",
      contracts,
      signer: { getAddress, signAndBroadcast },
      readOnlyTransport,
      ...(limits
        ? {
            spendingPolicy: {
              maxPerTransaction: { stx: 1000, sbtc: 1000 },
              maxPerSession: { stx: 1000, sbtc: 1000 },
            },
          }
        : {}),
    }),
    getAddress,
    signAndBroadcast,
    readOnlyTransport,
  };
}

describe("earned fee accounting", () => {
  it.each([
    [0n, 0n],
    [1n, 0n],
    [49n, 0n],
    [50n, 1n],
    [51n, 1n],
    [999n, 19n],
    [1000n, 20n],
    [(1n << 128n) - 1n, ((1n << 128n) - 1n) / 50n],
  ])("quotes %s exactly", (gross, expected) => {
    const q = quoteServiceFee(gross);
    expect(q.fee).toBe(expected);
    expect(q.net + q.fee).toBe(gross);
  });
  it.each([-1n, 1n << 128n, Number.MAX_SAFE_INTEGER + 1, "1.1"])(
    "rejects invalid gross %s",
    (gross) => expect(() => quoteServiceFee(gross)).toThrow()
  );
  it("leaves default deployments fee-free", () => {
    const sdk = new PerkOSClient({ network: "mainnet" });
    expect(sdk.supportsServiceFees("stx")).toBe(false);
    expect(sdk.supportsServiceFees("sbtc")).toBe(false);
    expect(supportsServiceFees(contracts.stxCommerce, "sbtc")).toBe(false);
  });
  it("distinguishes quote, charged fee, waiver and real refund", () => {
    expect(parseJobServiceFee(fee(), 1n, "mainnet").settlement).toBeUndefined();
    const waived = { waiver: Cl.some(Cl.bufferFromHex(hash)) };
    const obligation = parseJobServiceFee(
      fee({ ...waived, settlement: settlement() }),
      1n,
      "mainnet"
    );
    expect(obligation.settlement?.refundedFee).toBe(0n);
    const refunded = parseJobServiceFee(
      fee({
        ...waived,
        settlement: settlement({ "refunded-fee": Cl.uint(20) }),
      }),
      1n,
      "mainnet"
    );
    expect(refunded.settlement?.net).toBe(980n);
    expect(refunded.settlement!.net + refunded.settlement!.refundedFee).toBe(
      1000n
    );
    expect(
      parseJobServiceFee(
        fee({
          ...waived,
          settlement: settlement({
            net: Cl.uint(1000),
            "charged-fee": Cl.uint(0),
          }),
        }),
        1n,
        "mainnet"
      ).settlement?.chargedFee
    ).toBe(0n);
  });
  it.each([
    { "basis-points": Cl.uint(201) },
    { settlement: settlement({ net: Cl.uint(981) }) },
    { settlement: settlement({ "refunded-fee": Cl.uint(20) }) },
    {
      waiver: Cl.some(Cl.bufferFromHex(hash)),
      settlement: settlement({ "refunded-fee": Cl.uint(1) }),
    },
    {
      settlement: settlement({ net: Cl.uint(1000), "charged-fee": Cl.uint(0) }),
    },
    { "service-recorded": Cl.bool(false), settlement: settlement() },
    { waiver: Cl.some(Cl.bufferFromHex("00".repeat(32))) },
    {
      waiver: Cl.some(Cl.bufferFromHex(hash)),
      "service-recorded": Cl.bool(false),
    },
    { treasury: Cl.principal("ST000000000000000000002AMW42H") },
  ])("rejects inconsistent fee state %#", (fields) =>
    expect(() => parseJobServiceFee(fee(fields), 1n, "mainnet")).toThrow()
  );
  it("rejects missing optional fields and unsupported policy", () => {
    expect(() =>
      parseJobServiceFee(Cl.ok(Cl.tuple({})), 1n, "mainnet")
    ).toThrow();
    expect(() =>
      parseServiceFeePolicy(
        policy({ "service-fee-bps": Cl.uint(0) }),
        "mainnet"
      )
    ).toThrow();
  });
});

describe.each<PaymentAsset>(["stx", "sbtc"])(
  "%s candidate integration",
  (asset) => {
    const commerce =
      asset === "stx" ? contracts.stxCommerce : contracts.sbtcCommerce;
    const input = {
      asset,
      jobId: 1n,
      amount: 1000n,
      recipient: PROVIDER,
      sbtcToken: TOKEN,
      serviceFee: split,
    };
    it("requires explicit funding consent, without adding 2% to the debit", () => {
      expect(() =>
        builder.fundJob({ asset, jobId: 1n, amount: 1000, sender: CLIENT })
      ).toThrow(/acceptance/);
      const p = builder.fundJob({
        asset,
        jobId: 1n,
        amount: 1000,
        sender: CLIENT,
        serviceFeeAcceptance: acceptance,
      });
      expect(p.postConditions).toHaveLength(1);
      expect(p.postConditions[0]).toMatchObject({
        address: CLIENT,
        amount: "1000",
        condition: "eq",
      });
      expect(p.intent.serviceFee?.fee).toBe(20n);
    });
    it("constrains gross aggregate outflow, not two competing postconditions", () => {
      for (const p of [
        builder.finalizeDecision(input),
        builder.settleAppealTimeout(input),
        builder.resolveAppeal({
          ...input,
          decision: "reject",
          recipient: CLIENT,
          resolutionHash: hash,
        }),
      ]) {
        expect(p.postConditionMode).toBe("deny");
        expect(p.postConditions).toHaveLength(1);
        expect(p.postConditions[0]).toMatchObject({
          address: commerce,
          amount: "1000",
          condition: "eq",
        });
        expect(p.intent.serviceFee?.net).toBe(980n);
      }
      const { serviceFee: _split, ...noSplit } = input;
      expect(() => builder.finalizeDecision(noSplit)).toThrow();
      expect(() =>
        builder.finalizeDecision({
          ...input,
          serviceFee: { ...split, net: 1000n },
        })
      ).toThrow();
      expect(() => builder.completeJob(input)).toThrow(/recordDecision/);
    });
    it("builds exact treasury-funded refunds and applies spending limits", () => {
      const p = builder.refundServiceFee({
        ...input,
        amount: 20n,
        treasury: TREASURY,
      });
      expect(p.intent.sender).toBe(TREASURY);
      expect(p.postConditions[0]).toMatchObject({
        address: TREASURY,
        amount: "20",
        condition: "eq",
      });
      expect(() => new SpendingPolicy(config).authorize(p)).toThrow(/requires/);
      const spending = new SpendingPolicy(config, {
        maxPerTransaction: { [asset]: 20 },
        maxPerSession: { [asset]: 20 },
      });
      spending.authorize(p);
      spending.record(p);
      expect(spending.spentThisSession(asset)).toBe(20n);
      expect(() => spending.authorize(p)).toThrow(/session/);
    });
    it("fetches and discloses the live settlement split", async () => {
      const c = client();
      await c.sdk.finalizeDecision(asset, 1n);
      const p = c.signAndBroadcast.mock.calls[0]?.[0];
      expect(p?.intent.serviceFee).toEqual(split);
      if (asset === "sbtc")
        expect(p?.postConditions[0]).toMatchObject({
          asset: `${TOKEN}::sbtc-token`,
        });
    });
    it("fails before signer access for wrong budget, treasury, policy or escrow", async () => {
      for (const overrides of [
        { "get-job-service-fee": fee({ treasury: Cl.principal(CLIENT) }) },
        { "get-job": job({ budget: Cl.uint(1001) }) },
        { "get-protocol-config": policy({ configured: Cl.bool(false) }) },
        { "get-protocol-config": policy({ "appeal-window": Cl.uint(3) }) },
        { "get-escrow-balance": Cl.ok(Cl.uint(999)) },
        { "get-job-service-fee": Cl.error(Cl.uint(802)) },
      ]) {
        const c = client(overrides);
        await expect(c.sdk.finalizeDecision(asset, 1n)).rejects.toThrow();
        expect(c.getAddress).not.toHaveBeenCalled();
        expect(c.signAndBroadcast).not.toHaveBeenCalled();
      }
    });
    it("funds only a matching live accepted quote", async () => {
      const c = client({
        "get-job": job({ status: Cl.uint(0) }),
        "get-job-service-fee": fee({ "service-recorded": Cl.bool(false) }),
      });
      await expect(
        c.sdk.fundJob({ asset, jobId: 1, amount: 1000 })
      ).rejects.toThrow(/acceptance/);
      expect(c.getAddress).not.toHaveBeenCalled();
      await c.sdk.fundJob({
        asset,
        jobId: 1,
        amount: 1000,
        serviceFeeAcceptance: acceptance,
      });
      expect(c.signAndBroadcast).toHaveBeenCalledOnce();
    });
    it("requires provider acceptance of the live budget before signer access", async () => {
      const c = client(
        {
          "get-job": job({ status: Cl.uint(1) }),
          "get-job-service-fee": fee({ "service-recorded": Cl.bool(false) }),
        },
        PROVIDER
      );
      await expect(
        c.sdk.submitWork({ asset, jobId: 1, deliverable: "ipfs:work" })
      ).rejects.toThrow(/accept/);
      await expect(
        c.sdk.submitWork({
          asset,
          jobId: 1,
          deliverable: "ipfs:work",
          serviceFeeAcceptance: { ...acceptance, gross: 999n },
        })
      ).rejects.toThrow();
      expect(c.getAddress).not.toHaveBeenCalled();
      await c.sdk.submitWork({
        asset,
        jobId: 1,
        deliverable: "ipfs:work",
        serviceFeeAcceptance: acceptance,
      });
      expect(c.signAndBroadcast).toHaveBeenCalledOnce();
    });
    it("refunds only a recorded waiver with outstanding fee and matching treasury signer", async () => {
      const data = {
        "get-job": job({ status: Cl.uint(3) }),
        "get-job-service-fee": fee({
          waiver: Cl.some(Cl.bufferFromHex(hash)),
          settlement: settlement(),
        }),
      };
      const mismatch = client(data);
      await expect(mismatch.sdk.refundServiceFee(asset, 1)).rejects.toThrow(
        /signer/
      );
      expect(mismatch.signAndBroadcast).not.toHaveBeenCalled();
      const c = client(data, TREASURY);
      await c.sdk.refundServiceFee(asset, 1);
      expect(c.sdk.policy.spentThisSession(asset)).toBe(20n);
      const noLimits = client(data, TREASURY, false);
      await expect(noLimits.sdk.refundServiceFee(asset, 1)).rejects.toThrow(
        /requires/
      );
      expect(noLimits.getAddress).not.toHaveBeenCalled();
      const paid = client(
        {
          ...data,
          "get-job-service-fee": fee({
            waiver: Cl.some(Cl.bufferFromHex(hash)),
            settlement: settlement({ "refunded-fee": Cl.uint(20) }),
          }),
        },
        TREASURY
      );
      await expect(paid.sdk.refundServiceFee(asset, 1)).rejects.toThrow(
        /remains refundable/
      );
    });
    it("allows fee-free timeout and appeal without a payment prerequisite", () => {
      const timeout = builder.settleReviewTimeout(input);
      expect(timeout.intent.serviceFee).toBeUndefined();
      expect(timeout.postConditions[0]).toMatchObject({ amount: "1000" });
      expect(
        builder.appealDecision({ asset, jobId: 1, evidenceHash: hash })
          .postConditions
      ).toEqual([]);
    });
  }
);

it("pins waiver authority and requires evidence; initializes all three arguments explicitly", async () => {
  const c = client({}, AUTHORITY);
  await c.sdk.waiveServiceFee({ asset: "stx", jobId: 1, evidenceHash: hash });
  expect(c.signAndBroadcast).toHaveBeenCalledOnce();
  expect(() =>
    builder.waiveServiceFee({
      asset: "stx",
      jobId: 1,
      authority: AUTHORITY,
      evidenceHash: "00".repeat(32),
    })
  ).toThrow();
  const input = {
    asset: "stx" as const,
    owner: CLIENT,
    treasury: TREASURY,
    appealAuthority: AUTHORITY,
    appealWindow: 144,
  };
  expect(builder.initializeServiceFeeProtocol(input).functionArgs).toEqual([
    Cl.uint(144),
    Cl.principal(AUTHORITY),
    Cl.principal(TREASURY),
  ]);
  expect(() =>
    builder.initializeServiceFeeProtocol({ ...input, appealWindow: 3 })
  ).toThrow();
  expect(() =>
    builder.initializeServiceFeeProtocol({ ...input, treasury: CLIENT })
  ).toThrow();
});
