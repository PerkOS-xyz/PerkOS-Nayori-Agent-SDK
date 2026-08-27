import {
  bufferCVFromString,
  getAddressFromPublicKey,
  makeUnsignedContractCall,
  makeUnsignedSTXTokenTransfer,
  noneCV,
  someCV,
  standardPrincipalCV,
  transactionToHex,
  uintCV,
} from "@stacks/transactions";
import type { PaymentPayload, PaymentRequirements, ResourceInfo } from "@x402/core/types";
import { PerkOSError } from "./errors.js";
import type { AmountLike, PerkOSNetwork } from "./types.js";
import { assertPrincipal, toUint } from "./validation.js";
import {
  NayoriX402DirectVerificationError,
  createNayoriX402DirectPaymentPayload,
  getNayoriX402Asset,
  validateNayoriX402PaymentContext,
  verifyNayoriX402DirectPayment,
} from "./x402-direct.js";
import type {
  NayoriX402PaymentAsset,
  NayoriX402ProtectedRequest,
  NayoriX402Quote,
  NayoriX402VerifiedDirectPayment,
} from "./x402-direct.js";

export const NAYORI_X402_PAYMENT_INTENT_VERSION = 1;
export const NAYORI_X402_PAYMENT_INTENT_PREFIX = "nyi_";

const PUBLIC_KEY_PATTERN = /^(02|03)[0-9a-f]{64}$/;
const TRANSACTION_HEX_PATTERN = /^(?:0x)?[0-9a-fA-F]+$/;
const MAX_SIGNED_QUOTE_BYTES = 16_384;
const MAX_TRANSACTION_HEX_CHARACTERS = 32_768;
const PAYMENT_ASSETS = new Set<NayoriX402PaymentAsset>(["stx", "sbtc", "usdcx"]);
const PAYMENT_NETWORKS = new Set<PerkOSNetwork>(["mainnet", "testnet"]);

type AssetLimits = Partial<Record<NayoriX402PaymentAsset, AmountLike>>;
type ResolvedAssetLimits = Partial<Record<NayoriX402PaymentAsset, bigint>>;

export interface NayoriX402PaymentIntentInput {
  readonly paymentRequirements: PaymentRequirements;
  readonly quote: NayoriX402Quote;
  readonly request: NayoriX402ProtectedRequest;
  readonly payer: string;
  readonly publicKey: string;
  readonly fee: AmountLike;
  readonly nonce: AmountLike;
  readonly nowSeconds?: number;
  readonly clockSkewSeconds?: number;
}

export interface NayoriX402PaymentIntent {
  readonly version: typeof NAYORI_X402_PAYMENT_INTENT_VERSION;
  readonly intentId: string;
  readonly quoteId: string;
  readonly merchantId: string;
  readonly network: PerkOSNetwork;
  readonly asset: NayoriX402PaymentAsset;
  readonly amount: string;
  readonly payTo: string;
  readonly payer: string;
  readonly publicKey: string;
  readonly fee: string;
  readonly nonce: string;
  readonly method: string;
  readonly url: string;
  readonly bodySha256: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly quoteFingerprint: string;
}

export interface NayoriX402PaymentPolicyInput {
  readonly allowedNetworks: readonly PerkOSNetwork[];
  readonly allowedAssets: readonly NayoriX402PaymentAsset[];
  readonly allowedRecipients: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly allowedMerchantIds?: readonly string[];
  readonly maxPerTransaction: AssetLimits;
  readonly maxPerSession: AssetLimits;
  readonly maxFeePerTransaction: AmountLike;
  readonly maxFeePerSession: AmountLike;
  readonly minQuoteValiditySeconds?: number;
}

export interface NayoriX402PaymentAuthorization {
  readonly intentId: string;
  readonly asset: NayoriX402PaymentAsset;
  readonly amount: bigint;
  readonly fee: bigint;
  readonly spentThisSession: bigint;
  readonly reservedThisSession: bigint;
  readonly remainingThisSession: bigint;
  commit(): void;
  release(): void;
}

export interface NayoriX402PaymentSessionUsage {
  readonly asset: NayoriX402PaymentAsset;
  readonly spent: bigint;
  readonly reserved: bigint;
  readonly remaining: bigint;
  readonly feeSpent: bigint;
  readonly feeReserved: bigint;
  readonly feeRemaining: bigint;
}

export interface NayoriX402PaymentSignRequest {
  readonly intent: NayoriX402PaymentIntent;
  readonly transaction: string;
}

export interface NayoriX402SignedTransaction {
  readonly transaction: string;
}

export interface NayoriX402PaymentSigner {
  getAddress(): string | Promise<string>;
  getPublicKey(): string | Promise<string>;
  signTransaction(
    request: NayoriX402PaymentSignRequest
  ): Promise<NayoriX402SignedTransaction>;
}

export interface LeatherSignTransactionParams {
  readonly transaction: string;
  readonly broadcast: false;
}

export type LeatherRequest = (
  method: "stx_signTransaction",
  params: LeatherSignTransactionParams
) => Promise<unknown>;

export interface LeatherSignerOptions {
  readonly network: PerkOSNetwork;
  readonly address: string;
  readonly publicKey: string;
  readonly request: LeatherRequest;
}

export interface PolicySignerRequest extends NayoriX402PaymentSignRequest {}

export type PolicySignerCallback = (
  request: PolicySignerRequest
) => Promise<NayoriX402SignedTransaction | string>;

export interface PolicySignerOptions {
  readonly network: PerkOSNetwork;
  readonly address: string;
  readonly publicKey: string;
  readonly sign: PolicySignerCallback;
}

export interface NayoriX402SettlementRequest {
  readonly signedQuote: string;
  readonly paymentRequirements: PaymentRequirements;
  readonly paymentPayload: PaymentPayload;
  readonly request: {
    readonly method: string;
    readonly url: string;
    readonly body?: string;
  };
}

export interface NayoriX402PreparePaymentInput {
  readonly signedQuote: string;
  readonly paymentRequirements: PaymentRequirements;
  readonly quote: NayoriX402Quote;
  readonly request: {
    readonly method: string;
    readonly url: string;
    readonly body?: string;
  };
  readonly fee: AmountLike;
  readonly nonce: AmountLike;
  readonly resource?: ResourceInfo;
}

export interface NayoriX402PreparedPayment {
  readonly intent: NayoriX402PaymentIntent;
  readonly settlementRequest: NayoriX402SettlementRequest;
  readonly verifiedPayment: NayoriX402VerifiedDirectPayment;
}

export interface NayoriX402PaymentClientOptions {
  readonly signer: NayoriX402PaymentSigner;
  readonly policy: NayoriX402PaymentPolicy;
  readonly nowSeconds?: () => number;
  readonly clockSkewSeconds?: number;
}

function nonEmpty<T>(values: readonly T[], field: string): readonly T[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new PerkOSError("CONFIG_INVALID", `${field} must contain at least one value.`);
  }
  return values;
}

function normalizePublicKey(value: string): string {
  const publicKey = value.trim().toLowerCase().replace(/^0x/, "");
  if (!PUBLIC_KEY_PATTERN.test(publicKey)) {
    throw new PerkOSError(
      "CONFIG_INVALID",
      "The x402 payer public key must be a compressed secp256k1 public key."
    );
  }
  return publicKey;
}

function validateSignerIdentity(
  network: PerkOSNetwork,
  addressValue: string,
  publicKeyValue: string
): { address: string; publicKey: string } {
  const address = addressValue.trim();
  assertPrincipal(address, "x402 payer address", network);
  const publicKey = normalizePublicKey(publicKeyValue);
  let derivedAddress: string;
  try {
    derivedAddress = getAddressFromPublicKey(publicKey, network);
  } catch {
    throw new PerkOSError("CONFIG_INVALID", "The x402 payer public key is invalid.");
  }
  if (derivedAddress !== address) {
    throw new PerkOSError(
      "SIGNER_MISMATCH",
      "The x402 payer public key does not derive the configured address."
    );
  }
  return { address, publicKey };
}

function normalizeTransactionHex(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TRANSACTION_HEX_CHARACTERS ||
    value.replace(/^0x/, "").length % 2 !== 0 ||
    !TRANSACTION_HEX_PATTERN.test(value)
  ) {
    throw new PerkOSError("SIGNING_FAILED", "The signer returned an invalid transaction.");
  }
  return value.replace(/^0x/, "").toLowerCase();
}

function signedTransactionFrom(value: unknown): NayoriX402SignedTransaction {
  if (typeof value === "string") {
    return Object.freeze({ transaction: normalizeTransactionHex(value) });
  }
  if (!value || typeof value !== "object") {
    throw new PerkOSError("SIGNING_FAILED", "The signer did not return a signed transaction.");
  }
  const record = value as Record<string, unknown>;
  const nested =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : undefined;
  const transaction =
    record.transaction ?? record.txRaw ?? nested?.transaction ?? nested?.txRaw;
  return Object.freeze({ transaction: normalizeTransactionHex(transaction) });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function freezeRequirements(requirement: PaymentRequirements): PaymentRequirements {
  return Object.freeze({
    ...requirement,
    ...(requirement.extra ? { extra: Object.freeze({ ...requirement.extra }) } : {}),
  });
}

function freezePaymentPayload(paymentPayload: PaymentPayload): PaymentPayload {
  return Object.freeze({
    ...paymentPayload,
    ...(paymentPayload.resource
      ? { resource: Object.freeze({ ...paymentPayload.resource }) }
      : {}),
    accepted: paymentPayload.accepted,
    payload: Object.freeze({ ...paymentPayload.payload }),
    extensions: Object.freeze({ ...paymentPayload.extensions }),
  });
}

function freezeQuote(quote: NayoriX402Quote): NayoriX402Quote {
  return Object.freeze({ ...quote });
}

function contextError(cause: unknown): PerkOSError {
  if (cause instanceof NayoriX402DirectVerificationError) {
    return new PerkOSError("X402_INVALID", cause.message, { reason: cause.reason });
  }
  if (cause instanceof PerkOSError) return cause;
  return new PerkOSError("X402_INVALID", "The x402 payment context is invalid.");
}

function signedPaymentError(cause: unknown): PerkOSError {
  if (cause instanceof NayoriX402DirectVerificationError) {
    return new PerkOSError(
      "SIGNING_FAILED",
      "The signer returned a transaction that failed local x402 verification.",
      { reason: cause.reason }
    );
  }
  if (cause instanceof PerkOSError) return cause;
  return new PerkOSError(
    "SIGNING_FAILED",
    "The signer returned a transaction that could not be verified."
  );
}

export async function createNayoriX402PaymentIntent(
  input: NayoriX402PaymentIntentInput
): Promise<NayoriX402PaymentIntent> {
  const paymentRequirements = freezeRequirements(input.paymentRequirements);
  const quote = freezeQuote(input.quote);
  const request = Object.freeze({
    method: input.request.method,
    url: input.request.url,
    ...(input.request.body === undefined
      ? {}
      : {
          body:
            typeof input.request.body === "string"
              ? input.request.body
              : Uint8Array.from(input.request.body),
        }),
  });
  let context: Awaited<ReturnType<typeof validateNayoriX402PaymentContext>>;
  try {
    context = await validateNayoriX402PaymentContext({
      paymentRequirements,
      trustedQuote: quote,
      request,
      ...(input.nowSeconds === undefined ? {} : { nowSeconds: input.nowSeconds }),
      ...(input.clockSkewSeconds === undefined
        ? {}
        : { clockSkewSeconds: input.clockSkewSeconds }),
    });
  } catch (cause) {
    throw contextError(cause);
  }

  const identity = validateSignerIdentity(context.network, input.payer, input.publicKey);
  const fee = toUint(input.fee, "fee");
  const nonce = toUint(input.nonce, "nonce", true);
  if (fee === 0n) {
    throw new PerkOSError("INPUT_INVALID", "fee must be greater than zero.");
  }
  const canonical = {
    version: NAYORI_X402_PAYMENT_INTENT_VERSION,
    quoteId: context.quote.quoteId,
    merchantId: context.quote.merchantId,
    network: context.network,
    asset: context.quote.paymentAsset,
    amount: context.quote.amount,
    payTo: context.quote.payTo,
    payer: identity.address,
    publicKey: identity.publicKey,
    fee: fee.toString(),
    nonce: nonce.toString(),
    method: context.quote.method,
    url: context.quote.url,
    bodySha256: context.quote.bodySha256,
    issuedAt: context.quote.issuedAt,
    expiresAt: context.quote.expiresAt,
    quoteFingerprint: context.quoteFingerprint,
  } as const;
  const intentId = `${NAYORI_X402_PAYMENT_INTENT_PREFIX}${await sha256Hex(
    `nayori-x402-payment-intent-v1\n${JSON.stringify(canonical)}`
  )}`;
  return Object.freeze({ ...canonical, intentId });
}

function resolveLimits(
  input: AssetLimits,
  allowedAssets: ReadonlySet<NayoriX402PaymentAsset>,
  field: string
): ResolvedAssetLimits {
  const limits: ResolvedAssetLimits = {};
  for (const asset of allowedAssets) {
    const value = input[asset];
    if (value === undefined) {
      throw new PerkOSError(
        "POLICY_LIMIT_REQUIRED",
        `${field}.${asset} is required for an allowed payment asset.`
      );
    }
    const amount = toUint(value, `${field}.${asset}`);
    if (amount === 0n) {
      throw new PerkOSError("CONFIG_INVALID", `${field}.${asset} must be greater than zero.`);
    }
    limits[asset] = amount;
  }
  return limits;
}

function canonicalOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PerkOSError("CONFIG_INVALID", "allowedOrigins contains an invalid URL.");
  }
  if (parsed.protocol !== "https:" || parsed.origin !== value) {
    throw new PerkOSError(
      "CONFIG_INVALID",
      "allowedOrigins must contain canonical HTTPS origins."
    );
  }
  return parsed.origin;
}

type ReservationRecord = {
  readonly intent: NayoriX402PaymentIntent;
  readonly amount: bigint;
  readonly fee: bigint;
};

export class NayoriX402PaymentPolicy {
  private readonly allowedNetworks: ReadonlySet<PerkOSNetwork>;
  private readonly allowedAssets: ReadonlySet<NayoriX402PaymentAsset>;
  private readonly allowedRecipients: ReadonlySet<string>;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly allowedMerchantIds: ReadonlySet<string> | undefined;
  private readonly maxPerTransaction: ResolvedAssetLimits;
  private readonly maxPerSession: ResolvedAssetLimits;
  private readonly maxFeePerTransaction: bigint;
  private readonly maxFeePerSession: bigint;
  private readonly minQuoteValiditySeconds: number;
  private readonly nowSeconds: () => number;
  private readonly spent: Record<NayoriX402PaymentAsset, bigint> = {
    stx: 0n,
    sbtc: 0n,
    usdcx: 0n,
  };
  private readonly reserved: Record<NayoriX402PaymentAsset, bigint> = {
    stx: 0n,
    sbtc: 0n,
    usdcx: 0n,
  };
  private feeSpent = 0n;
  private feeReserved = 0n;
  private readonly active = new Map<string, ReservationRecord>();
  private readonly committed = new Set<string>();
  private readonly activeQuotes = new Set<string>();
  private readonly committedQuotes = new Set<string>();

  constructor(input: NayoriX402PaymentPolicyInput, nowSeconds?: () => number) {
    this.allowedNetworks = new Set(nonEmpty(input.allowedNetworks, "allowedNetworks"));
    this.allowedAssets = new Set(nonEmpty(input.allowedAssets, "allowedAssets"));
    if ([...this.allowedNetworks].some((network) => !PAYMENT_NETWORKS.has(network))) {
      throw new PerkOSError("CONFIG_INVALID", "allowedNetworks contains an unsupported network.");
    }
    if ([...this.allowedAssets].some((asset) => !PAYMENT_ASSETS.has(asset))) {
      throw new PerkOSError("CONFIG_INVALID", "allowedAssets contains an unsupported asset.");
    }
    this.allowedRecipients = new Set(nonEmpty(input.allowedRecipients, "allowedRecipients"));
    this.allowedOrigins = new Set(
      nonEmpty(input.allowedOrigins, "allowedOrigins").map(canonicalOrigin)
    );
    this.allowedMerchantIds = input.allowedMerchantIds
      ? new Set(nonEmpty(input.allowedMerchantIds, "allowedMerchantIds"))
      : undefined;
    this.maxPerTransaction = resolveLimits(
      input.maxPerTransaction,
      this.allowedAssets,
      "maxPerTransaction"
    );
    this.maxPerSession = resolveLimits(
      input.maxPerSession,
      this.allowedAssets,
      "maxPerSession"
    );
    this.maxFeePerTransaction = toUint(
      input.maxFeePerTransaction,
      "maxFeePerTransaction"
    );
    this.maxFeePerSession = toUint(input.maxFeePerSession, "maxFeePerSession");
    if (this.maxFeePerTransaction === 0n || this.maxFeePerSession === 0n) {
      throw new PerkOSError("CONFIG_INVALID", "Fee limits must be greater than zero.");
    }
    if (this.maxFeePerTransaction > this.maxFeePerSession) {
      throw new PerkOSError(
        "CONFIG_INVALID",
        "maxFeePerTransaction cannot exceed maxFeePerSession."
      );
    }
    for (const asset of this.allowedAssets) {
      if (this.maxPerTransaction[asset]! > this.maxPerSession[asset]!) {
        throw new PerkOSError(
          "CONFIG_INVALID",
          `maxPerTransaction.${asset} cannot exceed maxPerSession.${asset}.`
        );
      }
    }
    this.minQuoteValiditySeconds = input.minQuoteValiditySeconds ?? 15;
    if (
      !Number.isSafeInteger(this.minQuoteValiditySeconds) ||
      this.minQuoteValiditySeconds < 0
    ) {
      throw new PerkOSError(
        "CONFIG_INVALID",
        "minQuoteValiditySeconds must be a non-negative safe integer."
      );
    }
    if (nowSeconds !== undefined && typeof nowSeconds !== "function") {
      throw new PerkOSError("CONFIG_INVALID", "The payment policy clock must be a function.");
    }
    this.nowSeconds = nowSeconds ?? (() => Math.floor(Date.now() / 1_000));
  }

  reserve(intent: NayoriX402PaymentIntent): NayoriX402PaymentAuthorization {
    if (
      this.committed.has(intent.intentId) ||
      this.active.has(intent.intentId) ||
      this.committedQuotes.has(intent.quoteFingerprint) ||
      this.activeQuotes.has(intent.quoteFingerprint)
    ) {
      throw new PerkOSError("POLICY_DENIED", "The payment quote was already authorized.", {
        intentId: intent.intentId,
      });
    }
    if (!this.allowedNetworks.has(intent.network)) {
      throw new PerkOSError("POLICY_DENIED", `Network ${intent.network} is not allowed.`);
    }
    if (!this.allowedAssets.has(intent.asset)) {
      throw new PerkOSError("POLICY_DENIED", `Asset ${intent.asset} is not allowed.`);
    }
    if (!this.allowedRecipients.has(intent.payTo)) {
      throw new PerkOSError("POLICY_DENIED", "The payment recipient is not allowed.");
    }
    const origin = new URL(intent.url).origin;
    if (!this.allowedOrigins.has(origin)) {
      throw new PerkOSError("POLICY_DENIED", `Origin ${origin} is not allowed.`);
    }
    if (this.allowedMerchantIds && !this.allowedMerchantIds.has(intent.merchantId)) {
      throw new PerkOSError("POLICY_DENIED", "The quote merchant is not allowed.");
    }
    const now = this.nowSeconds();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new PerkOSError("CONFIG_INVALID", "The payment policy clock is invalid.");
    }
    if (intent.expiresAt - now < this.minQuoteValiditySeconds) {
      throw new PerkOSError(
        "POLICY_DENIED",
        "The quote does not have enough validity remaining for safe signing."
      );
    }

    const amount = BigInt(intent.amount);
    const fee = BigInt(intent.fee);
    const transactionLimit = this.maxPerTransaction[intent.asset]!;
    const sessionLimit = this.maxPerSession[intent.asset]!;
    if (amount > transactionLimit) {
      throw new PerkOSError(
        "POLICY_DENIED",
        `Payment amount exceeds the ${intent.asset} per-transaction limit.`
      );
    }
    const nextAmount = this.spent[intent.asset] + this.reserved[intent.asset] + amount;
    if (nextAmount > sessionLimit) {
      throw new PerkOSError(
        "POLICY_DENIED",
        `Payment would exceed the ${intent.asset} session limit.`
      );
    }
    if (fee > this.maxFeePerTransaction) {
      throw new PerkOSError("POLICY_DENIED", "Payment fee exceeds the per-transaction limit.");
    }
    const nextFee = this.feeSpent + this.feeReserved + fee;
    if (nextFee > this.maxFeePerSession) {
      throw new PerkOSError("POLICY_DENIED", "Payment fee would exceed the session limit.");
    }

    const spentThisSession = this.spent[intent.asset];
    const reservedThisSession = this.reserved[intent.asset];
    this.reserved[intent.asset] += amount;
    this.feeReserved += fee;
    this.active.set(intent.intentId, { intent, amount, fee });
    this.activeQuotes.add(intent.quoteFingerprint);
    let finished = false;
    const finish = (commit: boolean): void => {
      if (finished) return;
      finished = true;
      this.finish(intent.intentId, commit);
    };
    return Object.freeze({
      intentId: intent.intentId,
      asset: intent.asset,
      amount,
      fee,
      spentThisSession,
      reservedThisSession,
      remainingThisSession: sessionLimit - nextAmount,
      commit: () => finish(true),
      release: () => finish(false),
    });
  }

  usage(asset: NayoriX402PaymentAsset): NayoriX402PaymentSessionUsage {
    const maximum = this.maxPerSession[asset] ?? 0n;
    return Object.freeze({
      asset,
      spent: this.spent[asset],
      reserved: this.reserved[asset],
      remaining: maximum - this.spent[asset] - this.reserved[asset],
      feeSpent: this.feeSpent,
      feeReserved: this.feeReserved,
      feeRemaining: this.maxFeePerSession - this.feeSpent - this.feeReserved,
    });
  }

  private finish(intentId: string, commit: boolean): void {
    const record = this.active.get(intentId);
    if (!record) return;
    this.active.delete(intentId);
    this.activeQuotes.delete(record.intent.quoteFingerprint);
    this.reserved[record.intent.asset] -= record.amount;
    this.feeReserved -= record.fee;
    if (commit) {
      this.spent[record.intent.asset] += record.amount;
      this.feeSpent += record.fee;
      this.committed.add(intentId);
      this.committedQuotes.add(record.intent.quoteFingerprint);
    }
  }
}

export class LeatherSigner implements NayoriX402PaymentSigner {
  private readonly network: PerkOSNetwork;
  private readonly address: string;
  private readonly publicKey: string;
  private readonly request: LeatherRequest;

  constructor(options: LeatherSignerOptions) {
    if (typeof options.request !== "function") {
      throw new PerkOSError("CONFIG_INVALID", "LeatherSigner requires a request callback.");
    }
    const identity = validateSignerIdentity(
      options.network,
      options.address,
      options.publicKey
    );
    this.network = options.network;
    this.address = identity.address;
    this.publicKey = identity.publicKey;
    this.request = options.request;
  }

  getAddress(): string {
    return this.address;
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  async signTransaction(
    request: NayoriX402PaymentSignRequest
  ): Promise<NayoriX402SignedTransaction> {
    this.assertIntent(request.intent);
    try {
      const result = await this.request("stx_signTransaction", {
        transaction: request.transaction,
        broadcast: false,
      });
      return signedTransactionFrom(result);
    } catch (cause) {
      if (cause instanceof PerkOSError) throw cause;
      throw new PerkOSError(
        "SIGNING_FAILED",
        "Leather rejected or cancelled the x402 payment signature.",
        { intentId: request.intent.intentId }
      );
    }
  }

  private assertIntent(intent: NayoriX402PaymentIntent): void {
    if (
      intent.network !== this.network ||
      intent.payer !== this.address ||
      intent.publicKey !== this.publicKey
    ) {
      throw new PerkOSError("SIGNER_MISMATCH", "LeatherSigner does not match the payment intent.");
    }
  }
}

export class PolicySigner implements NayoriX402PaymentSigner {
  private readonly network: PerkOSNetwork;
  private readonly address: string;
  private readonly publicKey: string;
  private readonly sign: PolicySignerCallback;

  constructor(options: PolicySignerOptions) {
    if (typeof options.sign !== "function") {
      throw new PerkOSError("CONFIG_INVALID", "PolicySigner requires a signing callback.");
    }
    const identity = validateSignerIdentity(
      options.network,
      options.address,
      options.publicKey
    );
    this.network = options.network;
    this.address = identity.address;
    this.publicKey = identity.publicKey;
    this.sign = options.sign;
  }

  getAddress(): string {
    return this.address;
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  async signTransaction(
    request: NayoriX402PaymentSignRequest
  ): Promise<NayoriX402SignedTransaction> {
    if (
      request.intent.network !== this.network ||
      request.intent.payer !== this.address ||
      request.intent.publicKey !== this.publicKey
    ) {
      throw new PerkOSError("SIGNER_MISMATCH", "PolicySigner does not match the payment intent.");
    }
    try {
      return signedTransactionFrom(await this.sign(request));
    } catch (cause) {
      if (cause instanceof PerkOSError) throw cause;
      throw new PerkOSError(
        "SIGNING_FAILED",
        "The remote policy signer rejected the x402 payment signature.",
        { intentId: request.intent.intentId }
      );
    }
  }
}

export async function buildNayoriX402UnsignedPaymentTransaction(
  intent: NayoriX402PaymentIntent
): Promise<string> {
  const definition = getNayoriX402Asset(intent.network, intent.asset);
  const amount = BigInt(intent.amount);
  const fee = BigInt(intent.fee);
  const nonce = BigInt(intent.nonce);
  if (definition.kind === "stx") {
    const transaction = await makeUnsignedSTXTokenTransfer({
      recipient: intent.payTo,
      amount,
      memo: intent.quoteFingerprint,
      publicKey: intent.publicKey,
      network: intent.network,
      fee,
      nonce,
      sponsored: false,
    });
    return transactionToHex(transaction).toLowerCase();
  }

  const [contractAddress, contractName] = definition.contract!.split(".");
  if (!contractAddress || !contractName) {
    throw new PerkOSError("X402_INVALID", "The canonical SIP-010 contract is invalid.");
  }
  const transaction = await makeUnsignedContractCall({
    contractAddress,
    contractName,
    functionName: "transfer",
    functionArgs: [
      uintCV(amount),
      standardPrincipalCV(intent.payer),
      standardPrincipalCV(intent.payTo),
      intent.quoteFingerprint
        ? someCV(bufferCVFromString(intent.quoteFingerprint))
        : noneCV(),
    ],
    publicKey: intent.publicKey,
    network: intent.network,
    fee,
    nonce,
    sponsored: false,
    postConditionMode: "deny",
    postConditions: [
      {
        type: "ft-postcondition",
        address: intent.payer,
        condition: "eq",
        amount,
        asset: definition.postConditionAsset as `${string}.${string}::${string}`,
      },
    ],
  });
  return transactionToHex(transaction).toLowerCase();
}

export class NayoriX402PaymentClient {
  private readonly signer: NayoriX402PaymentSigner;
  private readonly policy: NayoriX402PaymentPolicy;
  private readonly nowSeconds: () => number;
  private readonly clockSkewSeconds: number;

  constructor(options: NayoriX402PaymentClientOptions) {
    if (!options.signer || !options.policy) {
      throw new PerkOSError(
        "CONFIG_INVALID",
        "NayoriX402PaymentClient requires a signer and payment policy."
      );
    }
    this.signer = options.signer;
    this.policy = options.policy;
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000));
    this.clockSkewSeconds = options.clockSkewSeconds ?? 30;
    if (!Number.isSafeInteger(this.clockSkewSeconds) || this.clockSkewSeconds < 0) {
      throw new PerkOSError(
        "CONFIG_INVALID",
        "clockSkewSeconds must be a non-negative safe integer."
      );
    }
  }

  async preparePayment(
    input: NayoriX402PreparePaymentInput
  ): Promise<NayoriX402PreparedPayment> {
    if (
      typeof input.signedQuote !== "string" ||
      input.signedQuote.length === 0 ||
      new TextEncoder().encode(input.signedQuote).byteLength > MAX_SIGNED_QUOTE_BYTES
    ) {
      throw new PerkOSError("X402_INVALID", "signedQuote is missing or too large.");
    }
    const nowSeconds = this.nowSeconds();
    const quote = freezeQuote(input.quote);
    const request = Object.freeze({
      method: input.request.method,
      url: input.request.url,
      ...(input.request.body === undefined ? {} : { body: input.request.body }),
    });
    const paymentRequirements = freezeRequirements(input.paymentRequirements);
    const resource = input.resource
      ? Object.freeze({ ...input.resource })
      : Object.freeze({ url: quote.url });
    const [payer, publicKey] = await Promise.all([
      this.signer.getAddress(),
      this.signer.getPublicKey(),
    ]);
    const intent = await createNayoriX402PaymentIntent({
      paymentRequirements,
      quote,
      request,
      payer,
      publicKey,
      fee: input.fee,
      nonce: input.nonce,
      nowSeconds,
      clockSkewSeconds: this.clockSkewSeconds,
    });
    const authorization = this.policy.reserve(intent);
    try {
      const unsignedTransaction = await buildNayoriX402UnsignedPaymentTransaction(intent);
      const signed = await this.signer.signTransaction(
        Object.freeze({ intent, transaction: unsignedTransaction })
      );
      const paymentPayload = freezePaymentPayload(
        createNayoriX402DirectPaymentPayload({
          paymentRequirements,
          transaction: signed.transaction,
          resource,
        })
      );
      let verifiedPayment: NayoriX402VerifiedDirectPayment;
      try {
        verifiedPayment = await verifyNayoriX402DirectPayment({
          paymentPayload,
          paymentRequirements,
          trustedQuote: quote,
          request,
          nowSeconds: this.nowSeconds(),
          clockSkewSeconds: this.clockSkewSeconds,
        });
      } catch (cause) {
        throw signedPaymentError(cause);
      }
      if (
        verifiedPayment.payer !== intent.payer ||
        verifiedPayment.originNonce !== BigInt(intent.nonce) ||
        verifiedPayment.originFee !== BigInt(intent.fee) ||
        verifiedPayment.sponsored
      ) {
        throw new PerkOSError(
          "SIGNING_FAILED",
          "The signed transaction does not match the authorized payment intent.",
          { intentId: intent.intentId }
        );
      }
      authorization.commit();
      const settlementRequest = Object.freeze({
        signedQuote: input.signedQuote,
        paymentRequirements,
        paymentPayload,
        request,
      });
      return Object.freeze({ intent, settlementRequest, verifiedPayment });
    } catch (cause) {
      authorization.release();
      throw cause;
    }
  }
}
