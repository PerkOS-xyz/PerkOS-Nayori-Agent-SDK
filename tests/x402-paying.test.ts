import {
  TransactionSigner,
  deserializeTransaction,
  getAddressFromPrivateKey,
  makeSTXTokenTransfer,
  privateKeyToPublic,
  publicKeyToHex,
  transactionToHex,
} from "@stacks/transactions";
import type { PaymentRequirements } from "@x402/core/types";
import { describe, expect, it, vi } from "vitest";
import {
  LeatherSigner,
  NayoriX402PaymentClient,
  NayoriX402PaymentPolicy,
  PolicySigner,
  createNayoriX402PaymentIntent,
  createNayoriX402PaymentRequirements,
  createNayoriX402Quote,
  type NayoriX402PaymentAsset,
  type NayoriX402PaymentPolicyInput,
  type NayoriX402PreparePaymentInput,
  type NayoriX402Quote,
  type PolicySignerCallback,
} from "../src/index.js";

const PAYER_PRIVATE_KEY =
  "000000000000000000000000000000000000000000000000000000000000000101";
const PAY_TO_PRIVATE_KEY =
  "000000000000000000000000000000000000000000000000000000000000000201";
const OTHER_PRIVATE_KEY =
  "000000000000000000000000000000000000000000000000000000000000000301";
const PAYER = getAddressFromPrivateKey(PAYER_PRIVATE_KEY, "testnet");
const PAY_TO = getAddressFromPrivateKey(PAY_TO_PRIVATE_KEY, "testnet");
const OTHER = getAddressFromPrivateKey(OTHER_PRIVATE_KEY, "testnet");
const PUBLIC_KEY = publicKeyToHex(privateKeyToPublic(PAYER_PRIVATE_KEY));
const OTHER_PUBLIC_KEY = publicKeyToHex(privateKeyToPublic(OTHER_PRIVATE_KEY));
const NOW = 1_800_000_000;
const REQUEST = {
  method: "POST",
  url: "https://api.example.com/v1/weather?city=Miami",
  body: JSON.stringify({ units: "metric" }),
} as const;

async function quoteFor(
  asset: NayoriX402PaymentAsset,
  overrides: Partial<{ amount: bigint; nonce: bigint; expiresAt: number }> = {}
): Promise<{ quote: NayoriX402Quote; input: NayoriX402PreparePaymentInput }> {
  const quote = await createNayoriX402Quote({
    quoteId: `quote-${asset}-${overrides.nonce ?? 7n}`,
    merchantId: "merchant-weather",
    network: "testnet",
    asset,
    amount: overrides.amount ?? (asset === "stx" ? 1_500n : 10_000n),
    payTo: PAY_TO,
    ...REQUEST,
    issuedAt: NOW - 30,
    expiresAt: overrides.expiresAt ?? NOW + 300,
  });
  return {
    quote,
    input: {
      signedQuote: "header.payload.signature",
      quote,
      paymentRequirements: await createNayoriX402PaymentRequirements(quote),
      request: REQUEST,
      fee: 300n,
      nonce: overrides.nonce ?? 7n,
    },
  };
}

function policyInput(
  overrides: Partial<NayoriX402PaymentPolicyInput> = {}
): NayoriX402PaymentPolicyInput {
  return {
    allowedNetworks: ["testnet"],
    allowedAssets: ["stx", "sbtc", "usdcx"],
    allowedRecipients: [PAY_TO],
    allowedOrigins: ["https://api.example.com"],
    allowedMerchantIds: ["merchant-weather"],
    maxPerTransaction: { stx: 10_000n, sbtc: 50_000n, usdcx: 50_000n },
    maxPerSession: { stx: 20_000n, sbtc: 100_000n, usdcx: 100_000n },
    maxFeePerTransaction: 500n,
    maxFeePerSession: 5_000n,
    minQuoteValiditySeconds: 15,
    ...overrides,
  };
}

function policy(overrides: Partial<NayoriX402PaymentPolicyInput> = {}) {
  return new NayoriX402PaymentPolicy(policyInput(overrides), () => NOW);
}

function signUnsigned(transaction: string): string {
  const parsed = deserializeTransaction(transaction);
  new TransactionSigner(parsed).signOrigin(PAYER_PRIVATE_KEY);
  return transactionToHex(parsed);
}

function remoteSigner(
  sign: PolicySignerCallback = async ({ transaction }) => ({
    transaction: signUnsigned(transaction),
  })
) {
  return new PolicySigner({
    network: "testnet",
    address: PAYER,
    publicKey: PUBLIC_KEY,
    sign,
  });
}

describe("Nayori x402 payment intent", () => {
  it("is deterministic, request-bound, serializable, and contains no private key", async () => {
    const { quote, input } = await quoteFor("sbtc");
    const create = () =>
      createNayoriX402PaymentIntent({
        paymentRequirements: input.paymentRequirements,
        quote,
        request: REQUEST,
        payer: PAYER,
        publicKey: PUBLIC_KEY,
        fee: input.fee,
        nonce: input.nonce,
        nowSeconds: NOW,
        clockSkewSeconds: 0,
      });
    const first = await create();
    const second = await create();

    expect(first).toEqual(second);
    expect(first.intentId).toMatch(/^nyi_[0-9a-f]{64}$/);
    expect(first).toMatchObject({
      asset: "sbtc",
      amount: "10000",
      payer: PAYER,
      publicKey: PUBLIC_KEY,
      fee: "300",
      nonce: "7",
      bodySha256: quote.bodySha256,
    });
    expect(JSON.stringify(first)).not.toContain(PAYER_PRIVATE_KEY.slice(0, -2));
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("rejects request, requirement, expiry, and public-key mismatches before policy use", async () => {
    const { quote, input } = await quoteFor("stx");
    const base = {
      paymentRequirements: input.paymentRequirements,
      quote,
      request: REQUEST,
      payer: PAYER,
      publicKey: PUBLIC_KEY,
      fee: 300n,
      nonce: 7n,
      nowSeconds: NOW,
      clockSkewSeconds: 0,
    };
    await expect(
      createNayoriX402PaymentIntent({
        ...base,
        request: { ...REQUEST, url: "https://api.example.com/v1/other" },
      })
    ).rejects.toMatchObject({ code: "X402_INVALID" });
    await expect(
      createNayoriX402PaymentIntent({
        ...base,
        paymentRequirements: {
          ...input.paymentRequirements,
          amount: "1501",
        } as PaymentRequirements,
      })
    ).rejects.toMatchObject({ code: "X402_INVALID" });
    await expect(
      createNayoriX402PaymentIntent({ ...base, nowSeconds: quote.expiresAt + 1 })
    ).rejects.toMatchObject({ code: "X402_INVALID" });
    await expect(
      createNayoriX402PaymentIntent({ ...base, publicKey: OTHER_PUBLIC_KEY })
    ).rejects.toMatchObject({ code: "SIGNER_MISMATCH" });
  });
});

describe("Nayori x402 payment signers and client", () => {
  it.each(["stx", "sbtc", "usdcx"] as const)(
    "prepares and locally verifies a direct %s settlement request with a remote signer",
    async (asset) => {
      const { input } = await quoteFor(asset);
      const paymentPolicy = policy();
      const sign = vi.fn(async ({ transaction, intent }) => {
        expect(intent).not.toHaveProperty("privateKey");
        return { transaction: signUnsigned(transaction) };
      });
      const client = new NayoriX402PaymentClient({
        signer: remoteSigner(sign),
        policy: paymentPolicy,
        nowSeconds: () => NOW,
        clockSkewSeconds: 0,
      });

      const prepared = await client.preparePayment(input);

      expect(prepared.verifiedPayment).toMatchObject({
        asset,
        payer: PAYER,
        payTo: PAY_TO,
        originNonce: 7n,
        originFee: 300n,
        sponsored: false,
      });
      expect(prepared.settlementRequest).toMatchObject({
        signedQuote: input.signedQuote,
        paymentRequirements: input.paymentRequirements,
        request: REQUEST,
      });
      expect(prepared.settlementRequest.paymentPayload.payload.transaction).toBe(
        prepared.verifiedPayment.transaction
      );
      expect(Object.isFrozen(prepared.settlementRequest.paymentPayload)).toBe(true);
      expect(Object.isFrozen(prepared.settlementRequest.paymentPayload.payload)).toBe(true);
      expect(() => JSON.stringify(prepared.settlementRequest)).not.toThrow();
      expect(sign).toHaveBeenCalledOnce();
      expect(paymentPolicy.usage(asset)).toMatchObject({
        spent: BigInt(input.quote.amount),
        reserved: 0n,
        feeSpent: 300n,
        feeReserved: 0n,
      });
    }
  );

  it("uses Leather stx_signTransaction with broadcast disabled", async () => {
    const { input } = await quoteFor("sbtc");
    const request = vi.fn(async (_method, params: { transaction: string; broadcast: false }) => ({
      transaction: signUnsigned(params.transaction),
    }));
    const signer = new LeatherSigner({
      network: "testnet",
      address: PAYER,
      publicKey: PUBLIC_KEY,
      request,
    });
    const client = new NayoriX402PaymentClient({
      signer,
      policy: policy(),
      nowSeconds: () => NOW,
      clockSkewSeconds: 0,
    });

    await expect(client.preparePayment(input)).resolves.toMatchObject({
      verifiedPayment: { asset: "sbtc", payer: PAYER },
    });
    expect(request).toHaveBeenCalledWith(
      "stx_signTransaction",
      expect.objectContaining({ broadcast: false })
    );
  });

  it("rejects a wallet result that contains only a broadcast txid", async () => {
    const { input } = await quoteFor("stx");
    const signer = new LeatherSigner({
      network: "testnet",
      address: PAYER,
      publicKey: PUBLIC_KEY,
      request: async () => ({ txid: `0x${"1".repeat(64)}` }),
    });
    const client = new NayoriX402PaymentClient({
      signer,
      policy: policy(),
      nowSeconds: () => NOW,
      clockSkewSeconds: 0,
    });

    await expect(client.preparePayment(input)).rejects.toMatchObject({ code: "SIGNING_FAILED" });
  });

  it("rejects an unsigned transaction and releases the reservation", async () => {
    const { input } = await quoteFor("stx");
    const paymentPolicy = policy();
    const signer = remoteSigner(async ({ transaction }) => ({ transaction }));
    const client = new NayoriX402PaymentClient({
      signer,
      policy: paymentPolicy,
      nowSeconds: () => NOW,
      clockSkewSeconds: 0,
    });

    await expect(client.preparePayment(input)).rejects.toMatchObject({
      code: "SIGNING_FAILED",
      details: { reason: "invalid_origin_signature" },
    });
    expect(paymentPolicy.usage("stx")).toMatchObject({
      spent: 0n,
      reserved: 0n,
      feeSpent: 0n,
      feeReserved: 0n,
    });
  });

  it("rejects a signer that mutates the authorized fee", async () => {
    const { input } = await quoteFor("stx");
    const paymentPolicy = policy();
    const signer = remoteSigner(async ({ intent }) => {
      const transaction = await makeSTXTokenTransfer({
        recipient: intent.payTo,
        amount: BigInt(intent.amount),
        memo: intent.quoteFingerprint,
        senderKey: PAYER_PRIVATE_KEY,
        network: intent.network,
        fee: BigInt(intent.fee) + 1n,
        nonce: BigInt(intent.nonce),
        sponsored: false,
      });
      return transactionToHex(transaction);
    });
    const client = new NayoriX402PaymentClient({
      signer,
      policy: paymentPolicy,
      nowSeconds: () => NOW,
      clockSkewSeconds: 0,
    });

    await expect(client.preparePayment(input)).rejects.toMatchObject({ code: "SIGNING_FAILED" });
    expect(paymentPolicy.usage("stx").spent).toBe(0n);
  });

  it("releases policy reservations after remote signer cancellation", async () => {
    const { input } = await quoteFor("stx");
    const paymentPolicy = policy();
    const failing = new NayoriX402PaymentClient({
      signer: remoteSigner(async () => {
        throw new Error("KMS denied");
      }),
      policy: paymentPolicy,
      nowSeconds: () => NOW,
      clockSkewSeconds: 0,
    });
    await expect(failing.preparePayment(input)).rejects.toMatchObject({ code: "SIGNING_FAILED" });
    expect(paymentPolicy.usage("stx").reserved).toBe(0n);

    const succeeding = new NayoriX402PaymentClient({
      signer: remoteSigner(),
      policy: paymentPolicy,
      nowSeconds: () => NOW,
      clockSkewSeconds: 0,
    });
    await expect(succeeding.preparePayment(input)).resolves.toBeDefined();
  });

  it("does not authorize the same committed intent twice", async () => {
    const { input } = await quoteFor("stx");
    const sign = vi.fn(async ({ transaction }: { transaction: string }) =>
      signUnsigned(transaction)
    );
    const client = new NayoriX402PaymentClient({
      signer: remoteSigner(sign),
      policy: policy(),
      nowSeconds: () => NOW,
      clockSkewSeconds: 0,
    });

    await client.preparePayment(input);
    await expect(client.preparePayment({ ...input, nonce: 8n })).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
    expect(sign).toHaveBeenCalledOnce();
  });
});

describe("Nayori x402 payment policy", () => {
  async function intent(nonce: bigint, amount = 600n) {
    const { quote, input } = await quoteFor("stx", { nonce, amount });
    return createNayoriX402PaymentIntent({
      paymentRequirements: input.paymentRequirements,
      quote,
      request: REQUEST,
      payer: PAYER,
      publicKey: PUBLIC_KEY,
      fee: 300n,
      nonce,
      nowSeconds: NOW,
      clockSkewSeconds: 0,
    });
  }

  it("includes active reservations in concurrent session limits", async () => {
    const paymentPolicy = policy({
      maxPerTransaction: { stx: 700n, sbtc: 50_000n, usdcx: 50_000n },
      maxPerSession: { stx: 1_000n, sbtc: 100_000n, usdcx: 100_000n },
    });
    const first = paymentPolicy.reserve(await intent(1n));
    const secondIntent = await intent(2n);
    expect(() => paymentPolicy.reserve(secondIntent)).toThrowError(
      expect.objectContaining({ code: "POLICY_DENIED" })
    );
    expect(paymentPolicy.usage("stx").reserved).toBe(600n);
    first.release();
    const second = paymentPolicy.reserve(secondIntent);
    second.commit();
    expect(paymentPolicy.usage("stx")).toMatchObject({ spent: 600n, reserved: 0n });
  });

  it("denies fee, recipient, origin, merchant, and quote-validity violations", async () => {
    const base = await intent(3n, 500n);
    const cases: Array<[NayoriX402PaymentPolicy, typeof base]> = [
      [policy({ maxFeePerTransaction: 299n }), base],
      [policy({ allowedRecipients: [OTHER] }), base],
      [policy({ allowedOrigins: ["https://other.example.com"] }), base],
      [policy({ allowedMerchantIds: ["other-merchant"] }), base],
      [policy({ minQuoteValiditySeconds: 301 }), base],
    ];
    for (const [paymentPolicy, value] of cases) {
      expect(() => paymentPolicy.reserve(value)).toThrowError(
        expect.objectContaining({ code: "POLICY_DENIED" })
      );
    }
  });

  it("requires explicit limits for every allowed asset", () => {
    expect(
      () =>
        new NayoriX402PaymentPolicy(
          policyInput({ maxPerTransaction: { stx: 10_000n } }),
          () => NOW
        )
    ).toThrowError(expect.objectContaining({ code: "POLICY_LIMIT_REQUIRED" }));
  });
});
