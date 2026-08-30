import {
  AuthType,
  PostConditionMode,
  addressFromVersionHash,
  addressHashModeToVersion,
  addressToString,
  deserializeTransaction,
  isContractCallPayload,
  isTokenTransferPayload,
  transactionToHex,
  wireToPostCondition,
} from "@stacks/transactions";
import { validatePaymentPayload, validatePaymentRequirements } from "@x402/core/schemas";
import type {
  PaymentPayload,
  PaymentRequirements,
  ResourceInfo,
} from "@x402/core/types";
import { deepEqual } from "@x402/core/utils";
import { expectPrincipal, expectUint, optionalBuffer } from "./clarity.js";
import { PerkOSError } from "./errors.js";
import { normalizeTxid } from "./txid.js";
import type { AmountLike, PerkOSNetwork } from "./types.js";
import { assertPrincipal, toUint } from "./validation.js";
import {
  PERKOS_X402_SCHEME,
  STACKS_X402_NETWORKS,
  X402_VERSION,
  fromStacksX402Network,
  toStacksX402Network,
} from "./x402.js";

export const NAYORI_X402_DIRECT_ASSET_TRANSFER_METHOD = "stacks-signed-tx-v1";
export const NAYORI_X402_DIRECT_PAYMENT_FLOW = "upfront";
export const NAYORI_X402_QUOTE_VERSION = 1;
export const NAYORI_X402_QUOTE_FINGERPRINT_PREFIX = "ny1_";

const MAX_QUOTE_LIFETIME_SECONDS = 3_600;
const DEFAULT_CLOCK_SKEW_SECONDS = 30;
const MAX_SERIALIZED_TRANSACTION_BYTES = 16_384;
const MAX_PROTECTED_REQUEST_BODY_BYTES = 1_048_576;
const QUOTE_DIGEST_BYTES = 20;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const METHOD_PATTERN = /^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]{0,31}$/;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export type NayoriX402PaymentAsset = "stx" | "sbtc" | "usdcx";
export type NayoriStacksX402Network =
  (typeof STACKS_X402_NETWORKS)[keyof typeof STACKS_X402_NETWORKS];

export interface NayoriX402AssetDefinition {
  readonly network: PerkOSNetwork;
  readonly x402Network: NayoriStacksX402Network;
  readonly paymentAsset: NayoriX402PaymentAsset;
  readonly symbol: "STX" | "sBTC" | "USDCx";
  readonly decimals: 6 | 8;
  readonly wireAsset: string;
  readonly canonicalAssetId: string;
  readonly kind: "stx" | "sip010";
  readonly contract?: string;
  readonly tokenName?: string;
  readonly postConditionAsset?: string;
}

const MAINNET_SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const TESTNET_SBTC = "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT.sbtc-token";
const MAINNET_USDCX = "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx";
const TESTNET_USDCX = "ST2WK9SGBJ15RHZ33KK0KYVSXBEBHM1XDM8C96EC4.usdcx";

function stxAsset(network: PerkOSNetwork): NayoriX402AssetDefinition {
  const x402Network = toStacksX402Network(network);
  return Object.freeze({
    network,
    x402Network,
    paymentAsset: "stx",
    symbol: "STX",
    decimals: 6,
    wireAsset: "STX",
    canonicalAssetId: `${x402Network}/slip44:5757`,
    kind: "stx",
  });
}

function sip010Asset(
  network: PerkOSNetwork,
  paymentAsset: "sbtc" | "usdcx",
  symbol: "sBTC" | "USDCx",
  decimals: 6 | 8,
  contract: string,
  tokenName: string
): NayoriX402AssetDefinition {
  const x402Network = toStacksX402Network(network);
  return Object.freeze({
    network,
    x402Network,
    paymentAsset,
    symbol,
    decimals,
    wireAsset: contract,
    canonicalAssetId: `${x402Network}/sip010:${contract}.${tokenName}`,
    kind: "sip010",
    contract,
    tokenName,
    postConditionAsset: `${contract}::${tokenName}`,
  });
}

export const NAYORI_X402_DIRECT_ASSETS: Readonly<
  Record<PerkOSNetwork, Readonly<Record<NayoriX402PaymentAsset, NayoriX402AssetDefinition>>>
> = Object.freeze({
  mainnet: Object.freeze({
    stx: stxAsset("mainnet"),
    sbtc: sip010Asset("mainnet", "sbtc", "sBTC", 8, MAINNET_SBTC, "sbtc-token"),
    usdcx: sip010Asset("mainnet", "usdcx", "USDCx", 6, MAINNET_USDCX, "usdcx-token"),
  }),
  testnet: Object.freeze({
    stx: stxAsset("testnet"),
    sbtc: sip010Asset("testnet", "sbtc", "sBTC", 8, TESTNET_SBTC, "sbtc-token"),
    usdcx: sip010Asset("testnet", "usdcx", "USDCx", 6, TESTNET_USDCX, "usdcx-token"),
  }),
});

export interface NayoriX402ProtectedRequest {
  readonly method: string;
  readonly url: string;
  readonly body?: string | Uint8Array;
}

export interface NayoriX402QuoteInput extends NayoriX402ProtectedRequest {
  readonly quoteId: string;
  readonly merchantId: string;
  readonly network: PerkOSNetwork;
  readonly asset: NayoriX402PaymentAsset;
  readonly amount: AmountLike;
  readonly payTo: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface NayoriX402Quote {
  readonly version: typeof NAYORI_X402_QUOTE_VERSION;
  readonly quoteId: string;
  readonly merchantId: string;
  readonly method: string;
  readonly url: string;
  readonly bodySha256: string;
  readonly network: NayoriStacksX402Network;
  readonly paymentAsset: NayoriX402PaymentAsset;
  readonly asset: string;
  readonly amount: string;
  readonly payTo: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface NayoriX402DirectPaymentPayloadInput {
  readonly paymentRequirements: PaymentRequirements;
  readonly transaction: string;
  readonly resource?: ResourceInfo;
}

export interface VerifyNayoriX402DirectPaymentInput {
  readonly paymentPayload: PaymentPayload;
  readonly paymentRequirements: PaymentRequirements;
  /** The hosted layer must authenticate the merchant and validate the quote signature first. */
  readonly trustedQuote: NayoriX402Quote;
  readonly request: NayoriX402ProtectedRequest;
  readonly nowSeconds?: number;
  readonly clockSkewSeconds?: number;
}

export interface ValidateNayoriX402PaymentContextInput {
  readonly paymentRequirements: PaymentRequirements;
  /** The hosted layer must authenticate the merchant and validate the quote signature first. */
  readonly trustedQuote: NayoriX402Quote;
  readonly request: NayoriX402ProtectedRequest;
  readonly nowSeconds?: number;
  readonly clockSkewSeconds?: number;
}

export interface NayoriX402ValidatedPaymentContext {
  readonly quote: NayoriX402Quote;
  readonly network: PerkOSNetwork;
  readonly assetDefinition: NayoriX402AssetDefinition;
  readonly quoteFingerprint: string;
}

export interface NayoriX402VerifiedDirectPayment {
  readonly network: PerkOSNetwork;
  readonly x402Network: NayoriStacksX402Network;
  readonly asset: NayoriX402PaymentAsset;
  readonly assetDefinition: NayoriX402AssetDefinition;
  readonly amount: bigint;
  readonly payer: string;
  readonly payTo: string;
  readonly transaction: string;
  /** Hash of the supplied serialization; sponsor signing changes it for sponsored payments. */
  readonly transactionHash: string;
  /** Final network transaction ID for standard payments; omitted until a sponsor signs. */
  readonly transactionId?: string;
  readonly originNonce: bigint;
  readonly originFee: bigint;
  readonly sponsored: boolean;
  readonly quoteId: string;
  readonly quoteFingerprint: string;
}

export class NayoriX402DirectVerificationError extends Error {
  readonly reason: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    reason: string,
    message: string,
    details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = "NayoriX402DirectVerificationError";
    this.reason = reason;
    this.details = details;
  }
}

function verificationError(
  reason: string,
  message: string,
  details?: Readonly<Record<string, unknown>>
): NayoriX402DirectVerificationError {
  return new NayoriX402DirectVerificationError(reason, message, details);
}

function requireSafeTimestamp(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw verificationError("invalid_quote", `${field} must be a non-negative safe integer.`);
  }
  return value;
}

function requireId(value: string, field: string): string {
  if (!ID_PATTERN.test(value)) {
    throw verificationError(
      "invalid_quote",
      `${field} must use 1-128 URL-safe identifier characters.`
    );
  }
  return value;
}

function normalizeMethod(value: string): string {
  const method = value.trim().toUpperCase();
  if (!METHOD_PATTERN.test(method)) {
    throw verificationError("invalid_request", "The protected request method is invalid.");
  }
  return method;
}

export function canonicalizeNayoriX402ResourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw verificationError("invalid_request", "The protected resource URL is invalid.", {
      cause,
    });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw verificationError("invalid_request", "The protected resource must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.hash) {
    throw verificationError(
      "invalid_request",
      "The protected resource URL cannot include credentials or a fragment."
    );
  }
  return url.href;
}

function bytesFromBody(body: string | Uint8Array | undefined): Uint8Array {
  const bytes =
    body === undefined
      ? new Uint8Array()
      : typeof body === "string"
        ? new TextEncoder().encode(body)
        : Uint8Array.from(body);
  if (bytes.byteLength > MAX_PROTECTED_REQUEST_BODY_BYTES) {
    throw verificationError(
      "invalid_request",
      `The protected request body exceeds ${MAX_PROTECTED_REQUEST_BODY_BYTES} bytes.`
    );
  }
  return bytes;
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(value));
  return new Uint8Array(digest);
}

function hexFromBytes(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(value: Uint8Array): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 3) {
    const first = value[index] ?? 0;
    const hasSecond = index + 1 < value.length;
    const hasThird = index + 2 < value.length;
    const second = hasSecond ? (value[index + 1] ?? 0) : 0;
    const third = hasThird ? (value[index + 2] ?? 0) : 0;
    encoded += BASE64URL_ALPHABET[first >> 2];
    encoded += BASE64URL_ALPHABET[((first & 0x03) << 4) | (second >> 4)];
    if (hasSecond) {
      encoded += BASE64URL_ALPHABET[((second & 0x0f) << 2) | (third >> 6)];
    }
    if (hasThird) encoded += BASE64URL_ALPHABET[third & 0x3f];
  }
  return encoded;
}

export async function hashNayoriX402RequestBody(
  body?: string | Uint8Array
): Promise<string> {
  return hexFromBytes(await sha256(bytesFromBody(body)));
}

export function getNayoriX402Asset(
  network: PerkOSNetwork,
  asset: NayoriX402PaymentAsset
): NayoriX402AssetDefinition {
  const definition = NAYORI_X402_DIRECT_ASSETS[network]?.[asset];
  if (!definition) {
    throw verificationError("unsupported_asset", "The Stacks x402 asset is not supported.", {
      network,
      asset,
    });
  }
  return definition;
}

function normalizeQuote(quote: NayoriX402Quote): NayoriX402Quote {
  if (quote.version !== NAYORI_X402_QUOTE_VERSION) {
    throw verificationError("invalid_quote", "The Nayori quote version is not supported.");
  }
  const quoteId = requireId(quote.quoteId, "quoteId");
  const merchantId = requireId(quote.merchantId, "merchantId");
  const method = normalizeMethod(quote.method);
  if (method !== quote.method) {
    throw verificationError("invalid_quote", "The quote method is not canonical.");
  }
  const url = canonicalizeNayoriX402ResourceUrl(quote.url);
  if (url !== quote.url) {
    throw verificationError("invalid_quote", "The quote URL is not canonical.");
  }
  if (!SHA256_PATTERN.test(quote.bodySha256)) {
    throw verificationError("invalid_quote", "The quote bodySha256 must be lowercase SHA-256.");
  }
  let network: PerkOSNetwork;
  try {
    network = fromStacksX402Network(quote.network);
  } catch (cause) {
    throw verificationError("invalid_quote", "The quote network is unsupported.", { cause });
  }
  const definition = getNayoriX402Asset(network, quote.paymentAsset);
  if (quote.asset !== definition.canonicalAssetId) {
    throw verificationError("invalid_quote", "The quote asset is not canonical for the network.");
  }
  let amount: bigint;
  try {
    amount = toUint(quote.amount, "quote.amount");
  } catch (cause) {
    throw verificationError("invalid_quote", "The quote amount is invalid.", { cause });
  }
  if (amount === 0n || amount.toString() !== quote.amount) {
    throw verificationError("invalid_quote", "The quote amount must be a positive canonical uint.");
  }
  try {
    assertPrincipal(quote.payTo, "quote.payTo", network);
  } catch (cause) {
    throw verificationError("invalid_quote", "The quote recipient is invalid.", { cause });
  }
  const issuedAt = requireSafeTimestamp(quote.issuedAt, "issuedAt");
  const expiresAt = requireSafeTimestamp(quote.expiresAt, "expiresAt");
  const lifetime = expiresAt - issuedAt;
  if (lifetime < 1 || lifetime > MAX_QUOTE_LIFETIME_SECONDS) {
    throw verificationError(
      "invalid_quote",
      `The quote lifetime must be between 1 and ${MAX_QUOTE_LIFETIME_SECONDS} seconds.`
    );
  }
  return {
    version: NAYORI_X402_QUOTE_VERSION,
    quoteId,
    merchantId,
    method,
    url,
    bodySha256: quote.bodySha256,
    network: definition.x402Network,
    paymentAsset: definition.paymentAsset,
    asset: definition.canonicalAssetId,
    amount: amount.toString(),
    payTo: quote.payTo,
    issuedAt,
    expiresAt,
  };
}

export async function createNayoriX402Quote(
  input: NayoriX402QuoteInput
): Promise<NayoriX402Quote> {
  const definition = getNayoriX402Asset(input.network, input.asset);
  const amount = toUint(input.amount, "amount");
  if (amount === 0n) {
    throw new PerkOSError("X402_INVALID", "amount must be greater than zero.");
  }
  const quote: NayoriX402Quote = {
    version: NAYORI_X402_QUOTE_VERSION,
    quoteId: input.quoteId,
    merchantId: input.merchantId,
    method: normalizeMethod(input.method),
    url: canonicalizeNayoriX402ResourceUrl(input.url),
    bodySha256: await hashNayoriX402RequestBody(input.body),
    network: definition.x402Network,
    paymentAsset: definition.paymentAsset,
    asset: definition.canonicalAssetId,
    amount: amount.toString(),
    payTo: input.payTo,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };
  return normalizeQuote(quote);
}

export function canonicalizeNayoriX402Quote(quote: NayoriX402Quote): string {
  const normalized = normalizeQuote(quote);
  return JSON.stringify({
    version: normalized.version,
    quoteId: normalized.quoteId,
    merchantId: normalized.merchantId,
    method: normalized.method,
    url: normalized.url,
    bodySha256: normalized.bodySha256,
    network: normalized.network,
    paymentAsset: normalized.paymentAsset,
    asset: normalized.asset,
    amount: normalized.amount,
    payTo: normalized.payTo,
    issuedAt: normalized.issuedAt,
    expiresAt: normalized.expiresAt,
  });
}

export async function createNayoriX402QuoteFingerprint(
  quote: NayoriX402Quote
): Promise<string> {
  const canonical = canonicalizeNayoriX402Quote(quote);
  const digest = await sha256(new TextEncoder().encode(canonical));
  const fingerprint = `${NAYORI_X402_QUOTE_FINGERPRINT_PREFIX}${base64Url(
    digest.slice(0, QUOTE_DIGEST_BYTES)
  )}`;
  if (new TextEncoder().encode(fingerprint).length > 34) {
    throw verificationError("invalid_quote", "The quote fingerprint exceeds the memo limit.");
  }
  return fingerprint;
}

export async function createNayoriX402PaymentRequirements(
  quoteInput: NayoriX402Quote
): Promise<PaymentRequirements> {
  const quote = normalizeQuote(quoteInput);
  const network = fromStacksX402Network(quote.network);
  const definition = getNayoriX402Asset(network, quote.paymentAsset);
  const requirement: PaymentRequirements = {
    scheme: PERKOS_X402_SCHEME,
    network: quote.network,
    amount: quote.amount,
    asset: definition.wireAsset,
    payTo: quote.payTo,
    maxTimeoutSeconds: quote.expiresAt - quote.issuedAt,
    extra: {
      assetTransferMethod: NAYORI_X402_DIRECT_ASSET_TRANSFER_METHOD,
      paymentFlow: NAYORI_X402_DIRECT_PAYMENT_FLOW,
      paymentAsset: definition.paymentAsset,
      nayoriAssetId: definition.canonicalAssetId,
      quoteVersion: String(NAYORI_X402_QUOTE_VERSION),
      quoteFingerprint: await createNayoriX402QuoteFingerprint(quote),
    },
  };
  try {
    validatePaymentRequirements(requirement);
  } catch (cause) {
    throw verificationError("invalid_payment_requirements", "The x402 requirement is invalid.", {
      cause,
    });
  }
  return requirement;
}

export function createNayoriX402DirectPaymentPayload(
  input: NayoriX402DirectPaymentPayloadInput
): PaymentPayload {
  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    ...(input.resource ? { resource: input.resource } : {}),
    accepted: input.paymentRequirements,
    payload: { transaction: input.transaction },
    extensions: {},
  };
  try {
    validatePaymentPayload(payload);
  } catch (cause) {
    throw verificationError("invalid_payload", "The direct Stacks payment payload is invalid.", {
      cause,
    });
  }
  return payload;
}

function requiredExtraString(
  requirement: PaymentRequirements,
  field: string
): string {
  const value = requirement.extra?.[field];
  if (typeof value !== "string" || value.length === 0) {
    throw verificationError(
      "invalid_payment_requirements",
      `paymentRequirements.extra.${field} must be a non-empty string.`
    );
  }
  return value;
}

async function validateRequirement(
  requirement: PaymentRequirements,
  quote: NayoriX402Quote
): Promise<NayoriX402AssetDefinition> {
  try {
    validatePaymentRequirements(requirement);
  } catch (cause) {
    throw verificationError("invalid_payment_requirements", "The x402 requirement is invalid.", {
      cause,
    });
  }
  const network = fromStacksX402Network(quote.network);
  const definition = getNayoriX402Asset(network, quote.paymentAsset);
  if (
    requirement.scheme !== PERKOS_X402_SCHEME ||
    requirement.network !== quote.network ||
    requirement.amount !== quote.amount ||
    requirement.asset !== definition.wireAsset ||
    requirement.payTo !== quote.payTo ||
    requirement.maxTimeoutSeconds !== quote.expiresAt - quote.issuedAt
  ) {
    throw verificationError(
      "requirement_mismatch",
      "The x402 requirement does not match the trusted quote."
    );
  }
  if (
    requiredExtraString(requirement, "assetTransferMethod") !==
      NAYORI_X402_DIRECT_ASSET_TRANSFER_METHOD ||
    requiredExtraString(requirement, "paymentFlow") !== NAYORI_X402_DIRECT_PAYMENT_FLOW ||
    requiredExtraString(requirement, "paymentAsset") !== definition.paymentAsset ||
    requiredExtraString(requirement, "nayoriAssetId") !== definition.canonicalAssetId ||
    requiredExtraString(requirement, "quoteVersion") !==
      String(NAYORI_X402_QUOTE_VERSION) ||
    requiredExtraString(requirement, "quoteFingerprint") !==
      (await createNayoriX402QuoteFingerprint(quote))
  ) {
    throw verificationError(
      "requirement_mismatch",
      "The x402 mechanism or quote metadata does not match the trusted quote."
    );
  }
  return definition;
}

export async function validateNayoriX402PaymentContext(
  input: ValidateNayoriX402PaymentContextInput
): Promise<NayoriX402ValidatedPaymentContext> {
  const quote = normalizeQuote(input.trustedQuote);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const clockSkewSeconds = input.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw verificationError("invalid_verifier_config", "nowSeconds must be a safe timestamp.");
  }
  if (!Number.isSafeInteger(clockSkewSeconds) || clockSkewSeconds < 0) {
    throw verificationError(
      "invalid_verifier_config",
      "clockSkewSeconds must be a non-negative safe integer."
    );
  }
  if (nowSeconds < quote.issuedAt - clockSkewSeconds) {
    throw verificationError("quote_not_yet_valid", "The trusted quote is not valid yet.");
  }
  if (nowSeconds > quote.expiresAt + clockSkewSeconds) {
    throw verificationError("quote_expired", "The trusted quote has expired.");
  }

  const requestMethod = normalizeMethod(input.request.method);
  const requestUrl = canonicalizeNayoriX402ResourceUrl(input.request.url);
  const requestBodySha256 = await hashNayoriX402RequestBody(input.request.body);
  if (
    requestMethod !== quote.method ||
    requestUrl !== quote.url ||
    requestBodySha256 !== quote.bodySha256
  ) {
    throw verificationError(
      "request_mismatch",
      "The protected request does not match the trusted quote."
    );
  }

  const assetDefinition = await validateRequirement(input.paymentRequirements, quote);
  return {
    quote,
    network: fromStacksX402Network(quote.network),
    assetDefinition,
    quoteFingerprint: await createNayoriX402QuoteFingerprint(quote),
  };
}

function parseTransaction(transactionValue: unknown) {
  if (typeof transactionValue !== "string") {
    throw verificationError("invalid_transaction", "payload.transaction must be hex.");
  }
  const hex = transactionValue.startsWith("0x")
    ? transactionValue.slice(2)
    : transactionValue;
  if (
    hex.length === 0 ||
    hex.length % 2 !== 0 ||
    hex.length > MAX_SERIALIZED_TRANSACTION_BYTES * 2 ||
    !/^[0-9a-fA-F]+$/.test(hex)
  ) {
    throw verificationError("invalid_transaction", "The serialized Stacks transaction is invalid.");
  }
  try {
    const transaction = deserializeTransaction(hex);
    if (transactionToHex(transaction).toLowerCase() !== hex.toLowerCase()) {
      throw verificationError(
        "invalid_transaction",
        "The serialized Stacks transaction is non-canonical or has trailing bytes."
      );
    }
    return { transaction, serialized: hex.toLowerCase() };
  } catch (cause) {
    if (cause instanceof NayoriX402DirectVerificationError) throw cause;
    throw verificationError("invalid_transaction", "The Stacks transaction cannot be decoded.", {
      cause,
    });
  }
}

function expectedNetworkEncoding(network: PerkOSNetwork): {
  transactionVersion: number;
  chainId: number;
} {
  return network === "mainnet"
    ? { transactionVersion: 0x00, chainId: 0x00000001 }
    : { transactionVersion: 0x80, chainId: 0x80000000 };
}

function originPayer(
  transaction: ReturnType<typeof deserializeTransaction>,
  network: PerkOSNetwork
): string {
  try {
    transaction.verifyOrigin();
  } catch (cause) {
    throw verificationError(
      "invalid_origin_signature",
      "The transaction origin signature is invalid.",
      { cause }
    );
  }
  const condition = transaction.auth.spendingCondition;
  const version = addressHashModeToVersion(condition.hashMode, network);
  return addressToString(addressFromVersionHash(version, condition.signer));
}

function asciiHex(value: string): string {
  return hexFromBytes(new TextEncoder().encode(value));
}

function verifyStxTransfer(
  transaction: ReturnType<typeof deserializeTransaction>,
  amount: bigint,
  payer: string,
  payTo: string,
  fingerprint: string
): void {
  if (!isTokenTransferPayload(transaction.payload)) {
    throw verificationError(
      "unsupported_transaction",
      "The quote requires an STX token-transfer transaction."
    );
  }
  let recipient: string;
  try {
    recipient = expectPrincipal(transaction.payload.recipient, "STX transfer recipient");
  } catch (cause) {
    throw verificationError("recipient_mismatch", "The STX recipient is invalid.", { cause });
  }
  if (transaction.payload.amount !== amount) {
    throw verificationError("amount_mismatch", "The STX transfer amount does not match the quote.");
  }
  if (recipient !== payTo) {
    throw verificationError("recipient_mismatch", "The STX recipient does not match the quote.");
  }
  if (transaction.payload.memo.content !== fingerprint) {
    throw verificationError("memo_mismatch", "The STX memo does not bind to the quote.");
  }
  if (
    transaction.postConditionMode !== PostConditionMode.Deny ||
    transaction.postConditions.values.length !== 0
  ) {
    throw verificationError(
      "post_condition_mismatch",
      "Direct STX transfers require deny mode and no redundant post-conditions.",
      { payer }
    );
  }
}

function verifySip010Transfer(
  transaction: ReturnType<typeof deserializeTransaction>,
  definition: NayoriX402AssetDefinition,
  amount: bigint,
  payer: string,
  payTo: string,
  fingerprint: string
): void {
  if (!isContractCallPayload(transaction.payload)) {
    throw verificationError(
      "unsupported_transaction",
      `The quote requires a canonical ${definition.symbol} SIP-010 transfer.`
    );
  }
  const contract = `${addressToString(transaction.payload.contractAddress)}.${
    transaction.payload.contractName.content
  }`;
  if (contract !== definition.contract || transaction.payload.functionName.content !== "transfer") {
    throw verificationError(
      "asset_mismatch",
      `The transaction is not a transfer through the canonical ${definition.symbol} contract.`
    );
  }
  const args = transaction.payload.functionArgs;
  if (args.length !== 4) {
    throw verificationError("unsupported_transaction", "SIP-010 transfer requires four arguments.");
  }
  let transferAmount: bigint;
  let sender: string;
  let recipient: string;
  let memo: string | undefined;
  try {
    transferAmount = expectUint(args[0], "SIP-010 transfer amount");
    sender = expectPrincipal(args[1], "SIP-010 transfer sender");
    recipient = expectPrincipal(args[2], "SIP-010 transfer recipient");
    memo = optionalBuffer(args[3], "SIP-010 transfer memo");
  } catch (cause) {
    throw verificationError("unsupported_transaction", "The SIP-010 transfer arguments are invalid.", {
      cause,
    });
  }
  if (transferAmount !== amount) {
    throw verificationError("amount_mismatch", "The SIP-010 amount does not match the quote.");
  }
  if (sender !== payer) {
    throw verificationError("payer_mismatch", "The SIP-010 sender is not the signed origin.");
  }
  if (recipient !== payTo) {
    throw verificationError("recipient_mismatch", "The SIP-010 recipient does not match the quote.");
  }
  if (memo !== asciiHex(fingerprint)) {
    throw verificationError("memo_mismatch", "The SIP-010 memo does not bind to the quote.");
  }
  if (
    transaction.postConditionMode !== PostConditionMode.Deny ||
    transaction.postConditions.values.length !== 1
  ) {
    throw verificationError(
      "post_condition_mismatch",
      "SIP-010 payments require deny mode and exactly one post-condition."
    );
  }
  const postCondition = wireToPostCondition(transaction.postConditions.values[0]!);
  if (
    postCondition.type !== "ft-postcondition" ||
    postCondition.address !== payer ||
    postCondition.condition !== "eq" ||
    BigInt(postCondition.amount) !== amount ||
    postCondition.asset !== definition.postConditionAsset
  ) {
    throw verificationError(
      "post_condition_mismatch",
      `The ${definition.symbol} post-condition is not exact and canonical.`
    );
  }
}

export async function verifyNayoriX402DirectPayment(
  input: VerifyNayoriX402DirectPaymentInput
): Promise<NayoriX402VerifiedDirectPayment> {
  const context = await validateNayoriX402PaymentContext({
    paymentRequirements: input.paymentRequirements,
    trustedQuote: input.trustedQuote,
    request: input.request,
    ...(input.nowSeconds === undefined ? {} : { nowSeconds: input.nowSeconds }),
    ...(input.clockSkewSeconds === undefined
      ? {}
      : { clockSkewSeconds: input.clockSkewSeconds }),
  });
  const { quote, network, assetDefinition: definition, quoteFingerprint: fingerprint } = context;

  try {
    validatePaymentPayload(input.paymentPayload);
  } catch (cause) {
    throw verificationError("invalid_payload", "The direct Stacks payment payload is invalid.", {
      cause,
    });
  }
  if (input.paymentPayload.x402Version !== X402_VERSION) {
    throw verificationError("invalid_payload", `x402Version must be ${X402_VERSION}.`);
  }
  if (!deepEqual(input.paymentPayload.accepted, input.paymentRequirements)) {
    throw verificationError(
      "requirement_mismatch",
      "The payment payload accepted field differs from the server requirement."
    );
  }
  if (
    input.paymentPayload.resource &&
    canonicalizeNayoriX402ResourceUrl(input.paymentPayload.resource.url) !== quote.url
  ) {
    throw verificationError(
      "request_mismatch",
      "The payment payload resource differs from the trusted quote."
    );
  }

  const parsed = parseTransaction(input.paymentPayload.payload.transaction);
  const expectedEncoding = expectedNetworkEncoding(network);
  if (
    parsed.transaction.transactionVersion !== expectedEncoding.transactionVersion ||
    parsed.transaction.chainId !== expectedEncoding.chainId
  ) {
    throw verificationError(
      "network_mismatch",
      "The signed transaction network does not match the quote."
    );
  }
  if (
    parsed.transaction.auth.authType !== AuthType.Standard &&
    parsed.transaction.auth.authType !== AuthType.Sponsored
  ) {
    throw verificationError("unsupported_transaction", "The transaction authorization is unsupported.");
  }

  const payer = originPayer(parsed.transaction, network);
  const amount = BigInt(quote.amount);
  if (definition.kind === "stx") {
    verifyStxTransfer(parsed.transaction, amount, payer, quote.payTo, fingerprint);
  } else {
    verifySip010Transfer(
      parsed.transaction,
      definition,
      amount,
      payer,
      quote.payTo,
      fingerprint
    );
  }

  const transactionHash = normalizeTxid(parsed.transaction.txid());
  return {
    network,
    x402Network: definition.x402Network,
    asset: definition.paymentAsset,
    assetDefinition: definition,
    amount,
    payer,
    payTo: quote.payTo,
    transaction: parsed.serialized,
    transactionHash,
    ...(parsed.transaction.auth.authType === AuthType.Standard
      ? { transactionId: transactionHash }
      : {}),
    originNonce: parsed.transaction.auth.spendingCondition.nonce,
    originFee: parsed.transaction.auth.spendingCondition.fee,
    sponsored: parsed.transaction.auth.authType === AuthType.Sponsored,
    quoteId: quote.quoteId,
    quoteFingerprint: fingerprint,
  };
}
