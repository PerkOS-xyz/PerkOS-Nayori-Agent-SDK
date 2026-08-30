import {
  bufferCVFromString,
  getAddressFromPrivateKey,
  makeContractCall,
  makeSTXTokenTransfer,
  makeUnsignedSTXTokenTransfer,
  noneCV,
  someCV,
  standardPrincipalCV,
  transactionToHex,
  uintCV,
} from "@stacks/transactions";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { describe, expect, it } from "vitest";
import {
  NAYORI_X402_DIRECT_ASSETS,
  NAYORI_X402_DIRECT_ASSET_TRANSFER_METHOD,
  NAYORI_X402_DIRECT_PAYMENT_FLOW,
  NayoriX402DirectVerificationError,
  canonicalizeNayoriX402Quote,
  createNayoriX402DirectPaymentPayload,
  createNayoriX402PaymentRequirements,
  createNayoriX402Quote,
  createNayoriX402QuoteFingerprint,
  getNayoriX402Asset,
  hashNayoriX402RequestBody,
  verifyNayoriX402DirectPayment,
  type NayoriX402PaymentAsset,
  type NayoriX402ProtectedRequest,
  type NayoriX402Quote,
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
const NOW = 1_800_000_000;
const REQUEST = {
  method: "POST",
  url: "https://api.example.com/v1/weather?city=Miami",
  body: JSON.stringify({ units: "metric" }),
} as const;

interface TransactionOverrides {
  readonly amount?: bigint;
  readonly recipient?: string;
  readonly memo?: string;
  readonly contract?: string;
  readonly functionName?: string;
  readonly sender?: string;
  readonly postConditionMode?: "allow" | "deny";
  readonly postConditionAsset?: string;
  readonly postConditionAmount?: bigint;
  readonly sponsored?: boolean;
  readonly unsigned?: boolean;
  readonly noMemo?: boolean;
}

interface Fixture {
  readonly asset: NayoriX402PaymentAsset;
  readonly quote: NayoriX402Quote;
  readonly requirements: PaymentRequirements;
  readonly fingerprint: string;
  readonly transaction: string;
  readonly payload: PaymentPayload;
}

async function buildQuote(
  asset: NayoriX402PaymentAsset,
  overrides: Partial<{
    method: string;
    url: string;
    body: string;
    amount: bigint;
    payTo: string;
    issuedAt: number;
    expiresAt: number;
  }> = {}
): Promise<NayoriX402Quote> {
  return createNayoriX402Quote({
    quoteId: `quote-${asset}-001`,
    merchantId: "merchant-weather",
    network: "testnet",
    asset,
    amount: overrides.amount ?? (asset === "stx" ? 1_500n : 10_000n),
    payTo: overrides.payTo ?? PAY_TO,
    method: overrides.method ?? REQUEST.method,
    url: overrides.url ?? REQUEST.url,
    body: overrides.body ?? REQUEST.body,
    issuedAt: overrides.issuedAt ?? NOW - 30,
    expiresAt: overrides.expiresAt ?? NOW + 300,
  });
}

async function buildTransaction(
  quote: NayoriX402Quote,
  fingerprint: string,
  overrides: TransactionOverrides = {}
): Promise<string> {
  const definition = getNayoriX402Asset("testnet", quote.paymentAsset);
  const amount = overrides.amount ?? BigInt(quote.amount);
  const recipient = overrides.recipient ?? quote.payTo;
  const memo = overrides.memo ?? fingerprint;
  if (definition.kind === "stx") {
    const options = {
      recipient,
      amount,
      memo,
      network: "testnet" as const,
      fee: 200n,
      nonce: 7n,
      sponsored: overrides.sponsored ?? false,
    };
    const transaction = overrides.unsigned
      ? await makeUnsignedSTXTokenTransfer({
          ...options,
          publicKey:
            "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
        })
      : await makeSTXTokenTransfer({ ...options, senderKey: PAYER_PRIVATE_KEY });
    return transactionToHex(transaction);
  }

  const contract = overrides.contract ?? definition.contract!;
  const [contractAddress, contractName] = contract.split(".");
  if (!contractAddress || !contractName) throw new Error("Invalid test contract");
  const postConditionAsset =
    overrides.postConditionAsset ?? definition.postConditionAsset!;
  const transaction = await makeContractCall({
    contractAddress,
    contractName,
    functionName: overrides.functionName ?? "transfer",
    functionArgs: [
      uintCV(amount),
      standardPrincipalCV(overrides.sender ?? PAYER),
      standardPrincipalCV(recipient),
      overrides.noMemo ? noneCV() : someCV(bufferCVFromString(memo)),
    ],
    senderKey: PAYER_PRIVATE_KEY,
    network: "testnet",
    fee: 300n,
    nonce: 7n,
    sponsored: overrides.sponsored ?? false,
    postConditionMode: overrides.postConditionMode ?? "deny",
    postConditions: [
      {
        type: "ft-postcondition",
        address: PAYER,
        condition: "eq",
        amount: overrides.postConditionAmount ?? amount,
        asset: postConditionAsset as `${string}.${string}::${string}`,
      },
    ],
  });
  return transactionToHex(transaction);
}

async function fixture(
  asset: NayoriX402PaymentAsset,
  transactionOverrides: TransactionOverrides = {}
): Promise<Fixture> {
  const quote = await buildQuote(asset);
  const requirements = await createNayoriX402PaymentRequirements(quote);
  const fingerprint = await createNayoriX402QuoteFingerprint(quote);
  const transaction = await buildTransaction(quote, fingerprint, transactionOverrides);
  const payload = createNayoriX402DirectPaymentPayload({
    paymentRequirements: requirements,
    transaction,
    resource: { url: quote.url },
  });
  return { asset, quote, requirements, fingerprint, transaction, payload };
}

async function verify(value: Fixture, overrides: Partial<{
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  quote: NayoriX402Quote;
  request: NayoriX402ProtectedRequest;
  nowSeconds: number;
}> = {}) {
  return verifyNayoriX402DirectPayment({
    paymentPayload: overrides.payload ?? value.payload,
    paymentRequirements: overrides.requirements ?? value.requirements,
    trustedQuote: overrides.quote ?? value.quote,
    request: overrides.request ?? REQUEST,
    nowSeconds: overrides.nowSeconds ?? NOW,
    clockSkewSeconds: 0,
  });
}

describe("Nayori direct x402 asset registry", () => {
  it("publishes compatibility-first STX, sBTC, and USDCx identifiers", () => {
    expect(NAYORI_X402_DIRECT_ASSETS.mainnet.stx).toMatchObject({
      wireAsset: "STX",
      canonicalAssetId: "stacks:1/slip44:5757",
      decimals: 6,
    });
    expect(NAYORI_X402_DIRECT_ASSETS.mainnet.sbtc).toMatchObject({
      wireAsset: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
      canonicalAssetId:
        "stacks:1/sip010:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token.sbtc-token",
      decimals: 8,
    });
    expect(NAYORI_X402_DIRECT_ASSETS.mainnet.usdcx).toMatchObject({
      wireAsset: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx",
      canonicalAssetId:
        "stacks:1/sip010:SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx.usdcx-token",
      decimals: 6,
    });
    expect(NAYORI_X402_DIRECT_ASSETS.testnet.usdcx.wireAsset).toBe(
      "ST2WK9SGBJ15RHZ33KK0KYVSXBEBHM1XDM8C96EC4.usdcx"
    );
  });

  it("rejects unknown assets instead of falling back to STX", () => {
    expect(() =>
      getNayoriX402Asset("testnet", "unknown" as NayoriX402PaymentAsset)
    ).toThrowError(NayoriX402DirectVerificationError);
  });
});

describe("Nayori direct x402 quote binding", () => {
  it("normalizes the method, URL, body digest, and exact atomic amount", async () => {
    const quote = await buildQuote("sbtc", {
      method: "post",
      url: "https://api.example.com:443/v1/weather?city=Miami",
    });
    expect(quote.method).toBe("POST");
    expect(quote.url).toBe(REQUEST.url);
    expect(quote.amount).toBe("10000");
    expect(quote.bodySha256).toBe(await hashNayoriX402RequestBody(REQUEST.body));
  });

  it("produces a deterministic 31-byte quote fingerprint and canonical form", async () => {
    const quote = await buildQuote("sbtc");
    const canonical = canonicalizeNayoriX402Quote(quote);
    const fingerprint = await createNayoriX402QuoteFingerprint(quote);
    expect(JSON.parse(canonical)).toEqual(quote);
    expect(quote.bodySha256).toBe(
      "97b09ced6af0c2a313986d6f6eb9a096e726e10c6aeb3f34f049fbeddbb1d712"
    );
    expect(fingerprint).toBe("ny1_Do4PrCmeo_hVKPXNkfZNJphbrN8");
    expect(new TextEncoder().encode(fingerprint)).toHaveLength(31);
  });

  it("rejects zero amounts, oversized lifetimes, credentials, and fragments", async () => {
    await expect(buildQuote("stx", { amount: 0n })).rejects.toThrow("greater than zero");
    await expect(
      buildQuote("stx", { issuedAt: NOW, expiresAt: NOW + 3_601 })
    ).rejects.toMatchObject({ reason: "invalid_quote" });
    await expect(
      buildQuote("stx", { url: "https://user:pass@example.com/private" })
    ).rejects.toMatchObject({ reason: "invalid_request" });
    await expect(
      buildQuote("stx", { url: "https://api.example.com/data#fragment" })
    ).rejects.toMatchObject({ reason: "invalid_request" });
  });

  it("emits the approved x402 v2 compatibility profile", async () => {
    const quote = await buildQuote("usdcx");
    const requirements = await createNayoriX402PaymentRequirements(quote);
    expect(requirements).toMatchObject({
      scheme: "exact",
      network: "stacks:2147483648",
      amount: "10000",
      asset: "ST2WK9SGBJ15RHZ33KK0KYVSXBEBHM1XDM8C96EC4.usdcx",
      payTo: PAY_TO,
      extra: {
        assetTransferMethod: NAYORI_X402_DIRECT_ASSET_TRANSFER_METHOD,
        paymentFlow: NAYORI_X402_DIRECT_PAYMENT_FLOW,
        paymentAsset: "usdcx",
        nayoriAssetId:
          "stacks:2147483648/sip010:ST2WK9SGBJ15RHZ33KK0KYVSXBEBHM1XDM8C96EC4.usdcx.usdcx-token",
        quoteVersion: "1",
      },
    });
  });
});

describe("Nayori direct x402 pure verifier", () => {
  it.each(["stx", "sbtc", "usdcx"] as const)(
    "verifies a signed exact %s payment without network or state",
    async (asset) => {
      const value = await fixture(asset);
      await expect(verify(value)).resolves.toMatchObject({
        network: "testnet",
        x402Network: "stacks:2147483648",
        asset,
        amount: BigInt(value.quote.amount),
        payer: PAYER,
        payTo: PAY_TO,
        originNonce: 7n,
        sponsored: false,
        quoteId: value.quote.quoteId,
        quoteFingerprint: value.fingerprint,
        transactionId: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      });
    }
  );

  it("accepts an origin-signed sponsored transaction without claiming sponsor settlement", async () => {
    const value = await fixture("sbtc", { sponsored: true });
    const result = await verify(value);
    expect(result).toMatchObject({
      asset: "sbtc",
      sponsored: true,
      payer: PAYER,
      transactionHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
    expect(result.transactionId).toBeUndefined();
  });

  it("rejects expired and not-yet-valid quotes", async () => {
    const value = await fixture("stx");
    await expect(verify(value, { nowSeconds: value.quote.expiresAt + 1 })).rejects.toMatchObject({
      reason: "quote_expired",
    });
    await expect(verify(value, { nowSeconds: value.quote.issuedAt - 1 })).rejects.toMatchObject({
      reason: "quote_not_yet_valid",
    });
  });

  it("binds method, canonical URL, and body bytes", async () => {
    const value = await fixture("usdcx");
    await expect(
      verify(value, { request: { ...REQUEST, method: "GET" } })
    ).rejects.toMatchObject({ reason: "request_mismatch" });
    await expect(
      verify(value, {
        request: { ...REQUEST, url: "https://api.example.com/v1/weather?city=Boston" },
      })
    ).rejects.toMatchObject({ reason: "request_mismatch" });
    await expect(
      verify(value, { request: { ...REQUEST, body: JSON.stringify({ units: "imperial" }) } })
    ).rejects.toMatchObject({ reason: "request_mismatch" });
  });

  it("rejects accepted requirements that differ from the server requirement", async () => {
    const value = await fixture("stx");
    const requirements = { ...value.requirements, amount: "1501" };
    await expect(verify(value, { requirements })).rejects.toMatchObject({
      reason: "requirement_mismatch",
    });
  });

  it("rejects a transaction encoded for another Stacks network before signature use", async () => {
    const value = await fixture("stx");
    const mainnetEncoding = `0000000001${value.transaction.slice(10)}`;
    const payload = createNayoriX402DirectPaymentPayload({
      paymentRequirements: value.requirements,
      transaction: mainnetEncoding,
    });
    await expect(verify(value, { payload })).rejects.toMatchObject({
      reason: "network_mismatch",
    });
  });

  it("rejects a requirement that changes the asset or mechanism", async () => {
    const value = await fixture("sbtc");
    const requirements: PaymentRequirements = {
      ...value.requirements,
      asset: "STX",
      extra: { ...value.requirements.extra, paymentFlow: "authorization" },
    };
    const payload = createNayoriX402DirectPaymentPayload({
      paymentRequirements: requirements,
      transaction: value.transaction,
    });
    await expect(verify(value, { requirements, payload })).rejects.toMatchObject({
      reason: "requirement_mismatch",
    });
  });

  it("rejects a different recipient even when the transaction has a valid signature", async () => {
    const value = await fixture("sbtc", { recipient: OTHER });
    await expect(verify(value)).rejects.toMatchObject({ reason: "recipient_mismatch" });
  });

  it("rejects lower and higher amounts instead of using minimum semantics", async () => {
    const lower = await fixture("usdcx", { amount: 9_999n });
    const higher = await fixture("usdcx", { amount: 10_001n });
    await expect(verify(lower)).rejects.toMatchObject({ reason: "amount_mismatch" });
    await expect(verify(higher)).rejects.toMatchObject({ reason: "amount_mismatch" });
  });

  it("rejects an unbound or missing memo", async () => {
    const wrong = await fixture("stx", { memo: "ny1_wrong" });
    const missing = await fixture("sbtc", { noMemo: true });
    await expect(verify(wrong)).rejects.toMatchObject({ reason: "memo_mismatch" });
    await expect(verify(missing)).rejects.toMatchObject({ reason: "memo_mismatch" });
  });

  it("rejects the wrong SIP-010 contract, function, or declared sender", async () => {
    const wrongContract = await fixture("usdcx", {
      contract: NAYORI_X402_DIRECT_ASSETS.testnet.sbtc.contract!,
    });
    const wrongFunction = await fixture("usdcx", { functionName: "protocol-transfer" });
    const wrongSender = await fixture("usdcx", { sender: OTHER });
    await expect(verify(wrongContract)).rejects.toMatchObject({ reason: "asset_mismatch" });
    await expect(verify(wrongFunction)).rejects.toMatchObject({ reason: "asset_mismatch" });
    await expect(verify(wrongSender)).rejects.toMatchObject({ reason: "payer_mismatch" });
  });

  it("requires deny mode and the exact canonical SIP-010 post-condition", async () => {
    const allow = await fixture("sbtc", { postConditionMode: "allow" });
    const wrongAmount = await fixture("sbtc", { postConditionAmount: 9_999n });
    const wrongAsset = await fixture("sbtc", {
      postConditionAsset: NAYORI_X402_DIRECT_ASSETS.testnet.usdcx.postConditionAsset!,
    });
    await expect(verify(allow)).rejects.toMatchObject({ reason: "post_condition_mismatch" });
    await expect(verify(wrongAmount)).rejects.toMatchObject({
      reason: "post_condition_mismatch",
    });
    await expect(verify(wrongAsset)).rejects.toMatchObject({
      reason: "post_condition_mismatch",
    });
  });

  it("rejects an unsigned origin", async () => {
    const value = await fixture("stx", { unsigned: true });
    await expect(verify(value)).rejects.toMatchObject({ reason: "invalid_origin_signature" });
  });

  it("rejects non-canonical serialized transactions with trailing bytes", async () => {
    const value = await fixture("stx");
    const payload = createNayoriX402DirectPaymentPayload({
      paymentRequirements: value.requirements,
      transaction: `${value.transaction}00`,
    });
    await expect(verify(value, { payload })).rejects.toMatchObject({
      reason: "invalid_transaction",
    });
  });
});
