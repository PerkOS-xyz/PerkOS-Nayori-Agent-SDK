import {
  AnchorMode,
  TransactionSigner,
  bufferCVFromString,
  deserializeTransaction,
  getAddressFromPrivateKey,
  makeUnsignedContractCall,
  privateKeyToPublic,
  publicKeyToHex,
  someCV,
  standardPrincipalCV,
  transactionToHex,
  uintCV,
} from "@stacks/transactions";
import { describe, expect, it } from "vitest";
import {
  NAYORI_MPP_CREDENTIAL_HEADER,
  NAYORI_MPP_TRANSACTION_FORMAT,
  NayoriMppVerificationError,
  buildNayoriMppUnsignedPaymentTransaction,
  canonicalizeNayoriMppJson,
  createNayoriMppUsdcStacksChallenge,
  createNayoriMppUsdcStacksCredential,
  createNayoriMppUsdcStacksReceipt,
  createNayoriX402PaymentIntent,
  createNayoriX402PaymentRequirements,
  createNayoriX402Quote,
  createNayoriX402QuoteFingerprint,
  decodeNayoriMppChallengeHeader,
  decodeNayoriMppCredentialHeader,
  decodeNayoriMppJson,
  decodeNayoriMppReceiptHeader,
  decodeNayoriMppUsdcStacksRequest,
  encodeNayoriMppCredentialHeader,
  encodeNayoriMppJson,
  encodeNayoriMppReceiptHeader,
  getNayoriX402Asset,
  nayoriMppStacksReplayKey,
  verifyNayoriMppUsdcStacksPayment,
  type NayoriMppChallenge,
  type NayoriMppUsdcStacksCredential,
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
  url: "https://api.nayori.ai/api/mpp/v1/weather?city=Miami",
  body: JSON.stringify({ units: "metric" }),
} as const;

async function buildQuote(): Promise<NayoriX402Quote> {
  return createNayoriX402Quote({
    quoteId: "nq_mpp_usdcx_001",
    merchantId: "merchant-weather",
    network: "testnet",
    asset: "usdcx",
    amount: 25_000n,
    payTo: PAY_TO,
    ...REQUEST,
    issuedAt: NOW - 30,
    expiresAt: NOW + 300,
  });
}

async function buildTransaction(
  quote: NayoriX402Quote,
  options: {
    readonly anchorMode?: AnchorMode;
    readonly sponsored?: boolean;
    readonly senderKey?: string;
  } = {}
): Promise<string> {
  const definition = getNayoriX402Asset("testnet", "usdcx");
  const [contractAddress, contractName] = definition.contract!.split(".");
  if (!contractAddress || !contractName) throw new Error("Invalid USDCx test contract.");
  const senderKey = options.senderKey ?? PAYER_PRIVATE_KEY;
  const sender = getAddressFromPrivateKey(senderKey, "testnet");
  const fingerprint = await createNayoriX402QuoteFingerprint(quote);
  const transaction = await makeUnsignedContractCall({
    contractAddress,
    contractName,
    functionName: "transfer",
    functionArgs: [
      uintCV(BigInt(quote.amount)),
      standardPrincipalCV(sender),
      standardPrincipalCV(quote.payTo),
      someCV(bufferCVFromString(fingerprint)),
    ],
    publicKey: publicKeyToHex(privateKeyToPublic(senderKey)),
    network: "testnet",
    fee: 300n,
    nonce: 7n,
    sponsored: options.sponsored ?? false,
    postConditionMode: "deny",
    postConditions: [
      {
        type: "ft-postcondition",
        address: sender,
        condition: "eq",
        amount: BigInt(quote.amount),
        asset: definition.postConditionAsset as `${string}.${string}::${string}`,
      },
    ],
  });
  transaction.anchorMode = options.anchorMode ?? AnchorMode.OnChainOnly;
  new TransactionSigner(transaction).signOrigin(senderKey);
  return transactionToHex(transaction);
}

async function fixture(options: {
  readonly anchorMode?: AnchorMode;
  readonly sponsored?: boolean;
} = {}) {
  const quote = await buildQuote();
  const bundle = await createNayoriMppUsdcStacksChallenge({
    quote,
    realm: "api.nayori.ai",
    description: "Nayori weather report",
  });
  const transaction = await buildTransaction(quote, options);
  const credential = createNayoriMppUsdcStacksCredential({
    challenge: bundle.challenge,
    source: `stacks:2147483648:${PAYER}`,
    transaction,
  });
  return { quote, bundle, transaction, credential };
}

describe("MPP PaymentAuth USDCx on Stacks", () => {
  it("canonicalizes and round-trips RFC 8785 JSON envelopes", () => {
    const value = { z: 2, a: { beta: true, alpha: "Nayori" }, list: [3, null] };
    expect(canonicalizeNayoriMppJson(value)).toBe(
      '{"a":{"alpha":"Nayori","beta":true},"list":[3,null],"z":2}'
    );
    expect(decodeNayoriMppJson(encodeNayoriMppJson(value))).toEqual(value);
  });

  it("rejects syntactically valid but non-canonical JSON envelopes", () => {
    const nonCanonical = btoa('{"z":2,"a":1}')
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(() => decodeNayoriMppJson(nonCanonical)).toThrowError(
      expect.objectContaining({ reason: "non_canonical_json" })
    );
  });

  it("rejects lone Unicode surrogates while preserving valid emoji", () => {
    expect(canonicalizeNayoriMppJson({ agent: "Nayori 🌸" })).toBe(
      '{"agent":"Nayori 🌸"}'
    );
    expect(() => canonicalizeNayoriMppJson({ agent: "\ud800" })).toThrowError(
      expect.objectContaining({ reason: "invalid_jcs" })
    );
  });

  it("creates the official Stacks USDC profile and selects Payment-Authorization", async () => {
    const { quote, bundle } = await fixture();
    const request = decodeNayoriMppUsdcStacksRequest(bundle.challenge.request);

    expect(bundle.challenge).toMatchObject({
      id: quote.quoteId,
      realm: "api.nayori.ai",
      method: "usdc",
      intent: "charge",
      header: NAYORI_MPP_CREDENTIAL_HEADER,
    });
    expect(bundle.wwwAuthenticate).toMatch(/^Payment id=/);
    expect(decodeNayoriMppChallengeHeader(bundle.wwwAuthenticate)).toEqual(bundle.challenge);
    expect(request).toMatchObject({
      amount: "25000",
      currency:
        "ST2WK9SGBJ15RHZ33KK0KYVSXBEBHM1XDM8C96EC4.usdcx::usdcx-token",
      recipient: PAY_TO,
      externalId: quote.quoteId,
      methodDetails: {
        type: "stacks",
        stacks: {
          network: "testnet",
          chainId: "2147483648",
          decimals: 6,
          functionName: "transfer",
          feePayer: false,
        },
      },
    });
  });

  it("uses the official mainnet USDCx identity", async () => {
    const mainnetPayTo = getAddressFromPrivateKey(PAY_TO_PRIVATE_KEY, "mainnet");
    const quote = await createNayoriX402Quote({
      quoteId: "nq_mpp_mainnet_identity",
      merchantId: "merchant-weather",
      network: "mainnet",
      asset: "usdcx",
      amount: 1_000_000n,
      payTo: mainnetPayTo,
      ...REQUEST,
      issuedAt: NOW - 30,
      expiresAt: NOW + 300,
    });
    const bundle = await createNayoriMppUsdcStacksChallenge({
      quote,
      realm: "api.nayori.ai",
    });
    expect(bundle.paymentRequest).toMatchObject({
      currency: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx::usdcx-token",
      methodDetails: {
        stacks: {
          network: "mainnet",
          chainId: "1",
          contractAddress: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE",
        },
      },
    });
  });

  it("builds an unsigned OnChainOnly transaction for wallet signing", async () => {
    const quote = await buildQuote();
    const paymentRequirements = await createNayoriX402PaymentRequirements(quote);
    const intent = await createNayoriX402PaymentIntent({
      quote,
      paymentRequirements,
      request: REQUEST,
      payer: PAYER,
      publicKey: publicKeyToHex(privateKeyToPublic(PAYER_PRIVATE_KEY)),
      fee: 300n,
      nonce: 0n,
      nowSeconds: NOW,
    });
    const unsigned = await buildNayoriMppUnsignedPaymentTransaction(intent);
    expect(deserializeTransaction(unsigned).anchorMode).toBe(AnchorMode.OnChainOnly);
  });

  it("ignores unknown challenge auth-params as required by PaymentAuth", async () => {
    const { bundle } = await fixture();
    expect(
      decodeNayoriMppChallengeHeader(`${bundle.wwwAuthenticate}, future="ignored"`)
    ).toEqual(bundle.challenge);
  });

  it("encodes the signed transaction as base64 in a canonical Payment credential", async () => {
    const { credential, transaction } = await fixture();
    const header = encodeNayoriMppCredentialHeader(credential);
    const decoded = decodeNayoriMppCredentialHeader(header);

    expect(header).toMatch(/^Payment [A-Za-z0-9_-]+$/);
    expect(decoded).toEqual(credential);
    expect(decoded.payload).toMatchObject({
      type: "transaction",
      transactionFormat: NAYORI_MPP_TRANSACTION_FORMAT,
    });
    expect(Buffer.from(decoded.payload.transaction, "base64").toString("hex")).toBe(
      transaction.toLowerCase()
    );
  });

  it("accepts an omitted optional Stacks transactionFormat", async () => {
    const { quote, bundle, credential } = await fixture();
    const compatible = {
      ...credential,
      payload: {
        type: "transaction" as const,
        transaction: credential.payload.transaction,
      },
    };
    const verified = await verifyNayoriMppUsdcStacksPayment({
      credential: compatible,
      expectedChallenge: bundle.challenge,
      trustedQuote: quote,
      request: REQUEST,
      nowSeconds: NOW,
    });
    expect(verified.payer).toBe(PAYER);
  });

  it("verifies a challenge-bound, low-s, OnChainOnly USDCx payment", async () => {
    const { quote, bundle, credential } = await fixture();
    const verified = await verifyNayoriMppUsdcStacksPayment({
      credential,
      expectedChallenge: bundle.challenge,
      trustedQuote: quote,
      request: REQUEST,
      nowSeconds: NOW,
    });

    expect(verified).toMatchObject({
      protocol: "mpp",
      method: "usdc",
      intent: "charge",
      profile: "stacks",
      challengeId: quote.quoteId,
      source: `stacks:2147483648:${PAYER}`,
      asset: "usdcx",
      payer: PAYER,
      payTo: PAY_TO,
      amount: 25_000n,
      originNonce: 7n,
      sponsored: false,
    });
    expect(nayoriMppStacksReplayKey(verified)).toContain(
      `mpp:testnet:${PAYER}:7:0x`
    );
  });

  it("rejects a credential that does not echo the challenge exactly", async () => {
    const { quote, bundle, credential } = await fixture();
    const altered: NayoriMppUsdcStacksCredential = {
      ...credential,
      challenge: { ...credential.challenge, realm: "evil.example" },
    };
    await expect(
      verifyNayoriMppUsdcStacksPayment({
        credential: altered,
        expectedChallenge: bundle.challenge,
        trustedQuote: quote,
        request: REQUEST,
        nowSeconds: NOW,
      })
    ).rejects.toMatchObject({ reason: "invalid_challenge" });
  });

  it("rejects a source principal that differs from the signed origin", async () => {
    const { quote, bundle, transaction } = await fixture();
    const credential = createNayoriMppUsdcStacksCredential({
      challenge: bundle.challenge,
      source: `stacks:2147483648:${OTHER}`,
      transaction,
    });
    await expect(
      verifyNayoriMppUsdcStacksPayment({
        credential,
        expectedChallenge: bundle.challenge,
        trustedQuote: quote,
        request: REQUEST,
        nowSeconds: NOW,
      })
    ).rejects.toMatchObject({ reason: "payer_mismatch" });
  });

  it("requires the MPP OnChainOnly anchor mode", async () => {
    const { quote, bundle, credential } = await fixture({ anchorMode: AnchorMode.Any });
    await expect(
      verifyNayoriMppUsdcStacksPayment({
        credential,
        expectedChallenge: bundle.challenge,
        trustedQuote: quote,
        request: REQUEST,
        nowSeconds: NOW,
      })
    ).rejects.toMatchObject({ reason: "anchor_mode_mismatch" });
  });

  it("keeps sponsorship disabled in the initial profile", async () => {
    const { quote, bundle, credential } = await fixture({ sponsored: true });
    await expect(
      verifyNayoriMppUsdcStacksPayment({
        credential,
        expectedChallenge: bundle.challenge,
        trustedQuote: quote,
        request: REQUEST,
        nowSeconds: NOW,
      })
    ).rejects.toMatchObject({ reason: "sponsorship_not_enabled" });
  });

  it("rejects expired challenges", async () => {
    const { quote, bundle, credential } = await fixture();
    await expect(
      verifyNayoriMppUsdcStacksPayment({
        credential,
        expectedChallenge: bundle.challenge,
        trustedQuote: quote,
        request: REQUEST,
        nowSeconds: NOW + 400,
        clockSkewSeconds: 0,
      })
    ).rejects.toMatchObject({ reason: "payment_expired" });
  });

  it("rejects unsupported extra fields in the method profile", async () => {
    const { bundle } = await fixture();
    const request = decodeNayoriMppJson(bundle.challenge.request) as Record<string, unknown>;
    const methodDetails = request.methodDetails as Record<string, unknown>;
    methodDetails.evm = {};
    expect(() => decodeNayoriMppUsdcStacksRequest(encodeNayoriMppJson(request))).toThrowError(
      expect.objectContaining({ reason: "invalid_envelope" })
    );
  });

  it("round-trips a successful Stacks settlement receipt", () => {
    const receipt = createNayoriMppUsdcStacksReceipt({
      challengeId: "nq_mpp_usdcx_001",
      reference: `0x${"ab".repeat(32)}`,
      network: "testnet",
      settledAt: "2026-08-28T18:00:00Z",
      externalId: "nq_mpp_usdcx_001",
    });
    expect(decodeNayoriMppReceiptHeader(encodeNayoriMppReceiptHeader(receipt))).toEqual(
      receipt
    );
    expect(receipt).toMatchObject({
      method: "usdc",
      type: "stacks",
      status: "success",
      network: "stacks:2147483648",
    });
  });

  it("uses typed verification failures", async () => {
    const { quote } = await fixture();
    const invalidChallenge = {
      id: quote.quoteId,
      realm: "api.nayori.ai",
      method: "usdc",
      intent: "charge",
      request: "bad!",
      expires: "2026-08-28T18:00:00Z",
      digest: "sha-256=:bad:",
      header: NAYORI_MPP_CREDENTIAL_HEADER,
    } as NayoriMppChallenge;
    expect(() => createNayoriMppUsdcStacksCredential({
      challenge: invalidChallenge,
      source: `stacks:2147483648:${PAYER}`,
      transaction: "00",
    })).toThrow(NayoriMppVerificationError);
  });
});
