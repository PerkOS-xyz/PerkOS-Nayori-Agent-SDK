import {
  AnchorMode,
  AuthType,
  deserializeTransaction,
  isSingleSig,
  transactionToHex,
  validateStacksAddress,
} from "@stacks/transactions";
import {
  createNayoriX402DirectPaymentPayload,
  createNayoriX402PaymentRequirements,
  getNayoriX402Asset,
  verifyNayoriX402DirectPayment,
} from "./x402-direct.js";
import { buildNayoriX402UnsignedPaymentTransaction } from "./x402-paying.js";
import type { NayoriX402PaymentIntent } from "./x402-paying.js";
import { fromStacksX402Network } from "./x402.js";
import { normalizeTxid } from "./txid.js";
import type {
  NayoriX402ProtectedRequest,
  NayoriX402Quote,
  NayoriX402VerifiedDirectPayment,
} from "./x402-direct.js";

export const MPP_PAYMENT_SCHEME = "Payment";
export const NAYORI_MPP_METHOD = "usdc";
export const NAYORI_MPP_INTENT = "charge";
export const NAYORI_MPP_PROFILE = "stacks";
export const NAYORI_MPP_CREDENTIAL_HEADER = "Payment-Authorization";
export const NAYORI_MPP_TRANSACTION_FORMAT = "stacks_transaction_v1";

const MAX_ENCODED_ENVELOPE_CHARACTERS = 131_072;
const MAX_TRANSACTION_BYTES = 16_384;
const SECP256K1_HALF_ORDER =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const TOKEN_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type JsonPrimitive = string | number | boolean | null;
export type NayoriMppJsonValue =
  | JsonPrimitive
  | readonly NayoriMppJsonValue[]
  | { readonly [key: string]: NayoriMppJsonValue };

export interface NayoriMppUsdcStacksDetails {
  readonly network: "mainnet" | "testnet";
  readonly chainId: "1" | "2147483648";
  readonly contractAddress: string;
  readonly contractName: string;
  readonly assetName: "usdcx-token";
  readonly functionName: "transfer";
  readonly decimals: 6;
  readonly feePayer: false;
}

export interface NayoriMppUsdcStacksRequest {
  readonly amount: string;
  readonly currency: string;
  readonly recipient: string;
  readonly description?: string;
  readonly externalId: string;
  readonly methodDetails: {
    readonly type: typeof NAYORI_MPP_PROFILE;
    readonly stacks: NayoriMppUsdcStacksDetails;
  };
}

export interface NayoriMppChallenge {
  readonly id: string;
  readonly realm: string;
  readonly method: typeof NAYORI_MPP_METHOD;
  readonly intent: typeof NAYORI_MPP_INTENT;
  readonly request: string;
  readonly expires: string;
  readonly digest: string;
  readonly header: typeof NAYORI_MPP_CREDENTIAL_HEADER;
  readonly description?: string;
}

export interface NayoriMppChallengeBundle {
  readonly challenge: NayoriMppChallenge;
  readonly paymentRequest: NayoriMppUsdcStacksRequest;
  readonly wwwAuthenticate: string;
}

export interface NayoriMppUsdcStacksPayload {
  readonly type: "transaction";
  readonly transaction: string;
  readonly transactionFormat?: typeof NAYORI_MPP_TRANSACTION_FORMAT;
}

export interface NayoriMppUsdcStacksCredential {
  readonly challenge: NayoriMppChallenge;
  readonly source: string;
  readonly payload: NayoriMppUsdcStacksPayload;
}

export interface NayoriMppUsdcStacksReceipt {
  readonly method: typeof NAYORI_MPP_METHOD;
  readonly type: typeof NAYORI_MPP_PROFILE;
  readonly challengeId: string;
  readonly reference: string;
  readonly status: "success";
  readonly timestamp: string;
  readonly network: "stacks:1" | "stacks:2147483648";
  readonly externalId?: string;
}

export interface CreateNayoriMppChallengeInput {
  /** Trusted, server-issued Nayori quote. Its quoteId becomes the stateful MPP challenge id. */
  readonly quote: NayoriX402Quote;
  readonly realm: string;
  readonly description?: string;
}

export interface CreateNayoriMppCredentialInput {
  readonly challenge: NayoriMppChallenge;
  /** CAIP-10 account: stacks:<chainId>:<standard-principal>. */
  readonly source: string;
  /** Signed Stacks transaction encoded as hexadecimal consensus bytes. */
  readonly transaction: string;
}

export interface VerifyNayoriMppUsdcStacksPaymentInput {
  readonly credential: unknown;
  readonly expectedChallenge: NayoriMppChallenge;
  /** The hosted layer must authenticate the merchant and validate the quote signature first. */
  readonly trustedQuote: NayoriX402Quote;
  readonly request: NayoriX402ProtectedRequest;
  readonly nowSeconds?: number;
  readonly clockSkewSeconds?: number;
}

export interface NayoriMppVerifiedUsdcStacksPayment
  extends NayoriX402VerifiedDirectPayment {
  readonly protocol: "mpp";
  readonly method: typeof NAYORI_MPP_METHOD;
  readonly intent: typeof NAYORI_MPP_INTENT;
  readonly profile: typeof NAYORI_MPP_PROFILE;
  readonly challengeId: string;
  readonly source: string;
}

export interface CreateNayoriMppReceiptInput {
  readonly challengeId: string;
  readonly reference: string;
  readonly network: "mainnet" | "testnet";
  readonly settledAt?: Date | string;
  readonly externalId?: string;
}

export class NayoriMppVerificationError extends Error {
  readonly reason: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    reason: string,
    message: string,
    details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = "NayoriMppVerificationError";
    this.reason = reason;
    this.details = details;
  }
}

function mppError(
  reason: string,
  message: string,
  details?: Readonly<Record<string, unknown>>
): NayoriMppVerificationError {
  return new NayoriMppVerificationError(reason, message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw mppError("invalid_envelope", `${field} contains unsupported field ${key}.`);
    }
  }
}

function requireString(
  value: unknown,
  field: string,
  options: { readonly max?: number; readonly pattern?: RegExp } = {}
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > (options.max ?? 16_384) ||
    (options.pattern && !options.pattern.test(value))
  ) {
    throw mppError("invalid_envelope", `${field} is invalid.`);
  }
  return value;
}

function requireHttpText(value: unknown, field: string, max: number): string {
  const text = requireString(value, field, { max });
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point < 0x20 || point === 0x7f) {
      throw mppError("invalid_header", `${field} must not contain HTTP control characters.`);
    }
  }
  return text;
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw mppError("invalid_jcs", "JCS strings must not contain lone Unicode surrogates.");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw mppError("invalid_jcs", "JCS strings must not contain lone Unicode surrogates.");
    }
  }
}

function canonicalizeValue(value: unknown, stack: Set<unknown>): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    assertWellFormedUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw mppError("invalid_jcs", "JCS numbers must be finite.");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw mppError("invalid_jcs", "JCS values must be valid JSON values.");
  }
  if (stack.has(value)) {
    throw mppError("invalid_jcs", "JCS values must not contain cycles.");
  }
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map(item => canonicalizeValue(item, stack)).join(",")}]`;
    }
    const object = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      throw mppError("invalid_jcs", "JCS objects must be plain JSON objects.");
    }
    const members = Object.keys(object)
      .sort()
      .map(key => {
        assertWellFormedUnicode(key);
        return `${JSON.stringify(key)}:${canonicalizeValue(object[key], stack)}`;
      });
    return `{${members.join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

/** RFC 8785 JSON Canonicalization Scheme for JSON-compatible values. */
export function canonicalizeNayoriMppJson(value: unknown): string {
  return canonicalizeValue(value, new Set());
}

function bytesToBinary(bytes: Uint8Array): string {
  let result = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    for (const byte of chunk) result += String.fromCharCode(byte);
  }
  return result;
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function bytesFromBase64Url(value: string, field: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length > MAX_ENCODED_ENVELOPE_CHARACTERS ||
    !BASE64URL_PATTERN.test(value) ||
    value.length % 4 === 1
  ) {
    throw mppError("invalid_base64url", `${field} is not canonical base64url without padding.`);
  }
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  try {
    const bytes = binaryToBytes(atob(padded));
    if (base64UrlFromBytes(bytes) !== value) {
      throw mppError("invalid_base64url", `${field} is not canonical base64url without padding.`);
    }
    return bytes;
  } catch (cause) {
    if (cause instanceof NayoriMppVerificationError) throw cause;
    throw mppError("invalid_base64url", `${field} cannot be decoded.`, { cause });
  }
}

export function encodeNayoriMppJson(value: unknown): string {
  return base64UrlFromBytes(new TextEncoder().encode(canonicalizeNayoriMppJson(value)));
}

export function decodeNayoriMppJson(value: string, field = "MPP envelope"): unknown {
  const bytes = bytesFromBase64Url(value, field);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw mppError("invalid_json", `${field} is not valid UTF-8.`, { cause });
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (cause) {
    throw mppError("invalid_json", `${field} is not valid JSON.`, { cause });
  }
  if (canonicalizeNayoriMppJson(decoded) !== text) {
    throw mppError("non_canonical_json", `${field} is not RFC 8785 canonical JSON.`);
  }
  return decoded;
}

function normalizeRfc3339(value: unknown, field: string): string {
  const text = requireString(value, field, { max: 64 });
  const timestamp = Date.parse(text);
  if (
    !Number.isFinite(timestamp) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
  ) {
    throw mppError("invalid_envelope", `${field} must be an RFC3339 timestamp.`);
  }
  return text;
}

function normalizeChallenge(value: unknown): NayoriMppChallenge {
  if (!isRecord(value)) throw mppError("invalid_challenge", "MPP challenge must be an object.");
  exactKeys(
    value,
    ["id", "realm", "method", "intent", "request", "expires", "digest", "header", "description"],
    "challenge"
  );
  const method = requireString(value.method, "challenge.method", { max: 32 });
  const intent = requireString(value.intent, "challenge.intent", { max: 32 });
  const header = requireString(value.header, "challenge.header", { max: 64 });
  if (method !== NAYORI_MPP_METHOD || intent !== NAYORI_MPP_INTENT) {
    throw mppError("unsupported_method", "Nayori supports MPP method=usdc and intent=charge.");
  }
  if (header !== NAYORI_MPP_CREDENTIAL_HEADER) {
    throw mppError(
      "invalid_credential_header",
      "Nayori MPP challenges require Payment-Authorization so Bearer authentication remains separate."
    );
  }
  const challenge: NayoriMppChallenge = {
    id: requireString(value.id, "challenge.id", { max: 128, pattern: CHALLENGE_ID_PATTERN }),
    realm: requireHttpText(value.realm, "challenge.realm", 255),
    method: NAYORI_MPP_METHOD,
    intent: NAYORI_MPP_INTENT,
    request: requireString(value.request, "challenge.request", {
      max: MAX_ENCODED_ENVELOPE_CHARACTERS,
      pattern: BASE64URL_PATTERN,
    }),
    expires: normalizeRfc3339(value.expires, "challenge.expires"),
    digest: requireString(value.digest, "challenge.digest", {
      max: 128,
      pattern: /^sha-256=:[A-Za-z0-9+/]{43}=:$/,
    }),
    header: NAYORI_MPP_CREDENTIAL_HEADER,
    ...(value.description === undefined
      ? {}
      : { description: requireHttpText(value.description, "challenge.description", 512) }),
  };
  decodeNayoriMppJson(challenge.request, "challenge.request");
  return Object.freeze(challenge);
}

function parseCurrency(currency: string): {
  contractAddress: string;
  contractName: string;
  assetName: string;
} {
  const match = /^([^.]+)\.([a-z][a-z0-9-]{0,39})::([a-zA-Z][a-zA-Z0-9-]{0,127})$/.exec(
    currency
  );
  if (!match?.[1] || !match[2] || !match[3]) {
    throw mppError("invalid_payment_request", "MPP currency must be a full SIP-010 asset identifier.");
  }
  return { contractAddress: match[1], contractName: match[2], assetName: match[3] };
}

export function decodeNayoriMppUsdcStacksRequest(
  encoded: string
): NayoriMppUsdcStacksRequest {
  const value = decodeNayoriMppJson(encoded, "MPP payment request");
  if (!isRecord(value)) {
    throw mppError("invalid_payment_request", "MPP payment request must be an object.");
  }
  exactKeys(
    value,
    ["amount", "currency", "recipient", "description", "externalId", "methodDetails"],
    "payment request"
  );
  const amount = requireString(value.amount, "payment request.amount", {
    max: 78,
    pattern: DECIMAL_PATTERN,
  });
  if (amount === "0") {
    throw mppError("invalid_payment_request", "payment request.amount must be greater than zero.");
  }
  const currency = requireString(value.currency, "payment request.currency", { max: 256 });
  const currencyParts = parseCurrency(currency);
  const recipient = requireString(value.recipient, "payment request.recipient", { max: 64 });
  const externalId = requireString(value.externalId, "payment request.externalId", { max: 128 });
  if (!isRecord(value.methodDetails)) {
    throw mppError("invalid_payment_request", "payment request.methodDetails must be an object.");
  }
  exactKeys(value.methodDetails, ["type", "stacks"], "payment request.methodDetails");
  if (value.methodDetails.type !== NAYORI_MPP_PROFILE || !isRecord(value.methodDetails.stacks)) {
    throw mppError("unsupported_profile", "Nayori MPP requires methodDetails.type=stacks.");
  }
  const stacks = value.methodDetails.stacks;
  exactKeys(
    stacks,
    [
      "network",
      "chainId",
      "contractAddress",
      "contractName",
      "assetName",
      "functionName",
      "decimals",
      "feePayer",
    ],
    "payment request.methodDetails.stacks"
  );
  const network = stacks.network;
  const chainId = stacks.chainId;
  if (
    (network !== "mainnet" && network !== "testnet") ||
    (chainId !== "1" && chainId !== "2147483648") ||
    (network === "mainnet" ? chainId !== "1" : chainId !== "2147483648")
  ) {
    throw mppError("network_mismatch", "MPP Stacks network and chainId do not match.");
  }
  const contractAddress = requireString(stacks.contractAddress, "stacks.contractAddress", {
    max: 64,
  });
  const contractName = requireString(stacks.contractName, "stacks.contractName", { max: 40 });
  const assetName = requireString(stacks.assetName, "stacks.assetName", { max: 128 });
  if (
    !validateStacksAddress(contractAddress) ||
    stacks.functionName !== "transfer" ||
    stacks.decimals !== 6 ||
    stacks.feePayer !== false ||
    assetName !== "usdcx-token"
  ) {
    throw mppError("invalid_payment_request", "MPP Stacks USDCx method details are invalid.");
  }
  if (
    currencyParts.contractAddress !== contractAddress ||
    currencyParts.contractName !== contractName ||
    currencyParts.assetName !== assetName
  ) {
    throw mppError("asset_mismatch", "MPP currency and Stacks token tuple do not match.");
  }
  return Object.freeze({
    amount,
    currency,
    recipient,
    ...(value.description === undefined
      ? {}
      : { description: requireString(value.description, "payment request.description", { max: 512 }) }),
    externalId,
    methodDetails: Object.freeze({
      type: NAYORI_MPP_PROFILE,
      stacks: Object.freeze({
        network,
        chainId,
        contractAddress,
        contractName,
        assetName: "usdcx-token",
        functionName: "transfer",
        decimals: 6,
        feePayer: false,
      }),
    }),
  });
}

function digestFromSha256Hex(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw mppError("invalid_quote", "The trusted quote body digest is invalid.");
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return `sha-256=:${btoa(bytesToBinary(bytes))}:`;
}

function quotedHeaderValue(value: string): string {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point < 0x20 || point === 0x7f) {
      throw mppError("invalid_header", "MPP header values must not contain control characters.");
    }
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function encodeNayoriMppChallengeHeader(challengeInput: NayoriMppChallenge): string {
  const challenge = normalizeChallenge(challengeInput);
  const parameters: readonly (readonly [string, string])[] = [
    ["id", challenge.id],
    ["realm", challenge.realm],
    ["method", challenge.method],
    ["intent", challenge.intent],
    ["request", challenge.request],
    ["expires", challenge.expires],
    ["digest", challenge.digest],
    ["header", challenge.header],
    ...(challenge.description ? ([["description", challenge.description]] as const) : []),
  ];
  return `${MPP_PAYMENT_SCHEME} ${parameters
    .map(([name, value]) => `${name}=${quotedHeaderValue(value)}`)
    .join(", ")}`;
}

export function decodeNayoriMppChallengeHeader(value: string): NayoriMppChallenge {
  const prefix = `${MPP_PAYMENT_SCHEME} `;
  if (!value.startsWith(prefix)) {
    throw mppError("invalid_header", "WWW-Authenticate must use the Payment scheme.");
  }
  const input = value.slice(prefix.length);
  const parameters: Record<string, string> = {};
  let index = 0;
  while (index < input.length) {
    while (input[index] === " " || input[index] === "\t") index += 1;
    if (index >= input.length || input[index] === ",") {
      throw mppError("invalid_header", "MPP challenge contains an empty auth-param.");
    }
    const start = index;
    while (index < input.length && TOKEN_PATTERN.test(input[index]!)) index += 1;
    const name = input.slice(start, index);
    if (!name || input[index] !== "=") {
      throw mppError("invalid_header", "MPP challenge auth-param is malformed.");
    }
    index += 1;
    if (input[index] !== '"') {
      throw mppError("invalid_header", "MPP challenge auth-param values must be quoted.");
    }
    index += 1;
    let parsed = "";
    let closed = false;
    while (index < input.length) {
      const character = input[index]!;
      index += 1;
      if (character === '"') {
        closed = true;
        break;
      }
      if (character === "\\") {
        if (index >= input.length) {
          throw mppError("invalid_header", "MPP quoted-pair is truncated.");
        }
        parsed += input[index]!;
        index += 1;
      } else {
        parsed += character;
      }
    }
    if (!closed) throw mppError("invalid_header", "MPP auth-param quote is not closed.");
    if (Object.hasOwn(parameters, name)) {
      throw mppError("invalid_header", `MPP challenge repeats ${name}.`);
    }
    parameters[name] = parsed;
    while (input[index] === " " || input[index] === "\t") index += 1;
    if (index < input.length && input[index] !== ",") {
      throw mppError("invalid_header", "MPP challenge auth-params must be comma separated.");
    }
    if (input[index] === ",") {
      index += 1;
      if (index >= input.length) {
        throw mppError("invalid_header", "MPP challenge must not end with a comma.");
      }
    }
  }
  const supported = Object.fromEntries(
    Object.entries(parameters).filter(([name]) =>
      [
        "id",
        "realm",
        "method",
        "intent",
        "request",
        "expires",
        "digest",
        "header",
        "description",
      ].includes(name)
    )
  );
  return normalizeChallenge(supported);
}

export async function createNayoriMppUsdcStacksChallenge(
  input: CreateNayoriMppChallengeInput
): Promise<NayoriMppChallengeBundle> {
  await createNayoriX402PaymentRequirements(input.quote);
  if (input.quote.paymentAsset !== "usdcx") {
    throw mppError("unsupported_asset", "MPP method=usdc on Stacks requires a USDCx quote.");
  }
  const network = fromStacksX402Network(input.quote.network);
  const definition = getNayoriX402Asset(network, "usdcx");
  const [contractAddress, contractName] = definition.contract!.split(".");
  if (!contractAddress || !contractName || !definition.tokenName) {
    throw mppError("invalid_registry", "The canonical USDCx registry entry is invalid.");
  }
  const paymentRequest: NayoriMppUsdcStacksRequest = Object.freeze({
    amount: input.quote.amount,
    currency: `${definition.contract}::${definition.tokenName}`,
    recipient: input.quote.payTo,
    ...(input.description ? { description: input.description } : {}),
    externalId: input.quote.quoteId,
    methodDetails: Object.freeze({
      type: NAYORI_MPP_PROFILE,
      stacks: Object.freeze({
        network,
        chainId: network === "mainnet" ? "1" : "2147483648",
        contractAddress,
        contractName,
        assetName: "usdcx-token",
        functionName: "transfer",
        decimals: 6,
        feePayer: false,
      }),
    }),
  });
  const expiresAtMilliseconds = input.quote.expiresAt * 1_000;
  if (!Number.isFinite(expiresAtMilliseconds) || expiresAtMilliseconds > 8.64e15) {
    throw mppError("invalid_quote", "The trusted quote expiry is outside the RFC3339 range.");
  }
  const challenge = normalizeChallenge({
    id: input.quote.quoteId,
    realm: requireString(input.realm, "realm", { max: 255 }),
    method: NAYORI_MPP_METHOD,
    intent: NAYORI_MPP_INTENT,
    request: encodeNayoriMppJson(paymentRequest),
    expires: new Date(expiresAtMilliseconds).toISOString(),
    digest: digestFromSha256Hex(input.quote.bodySha256),
    header: NAYORI_MPP_CREDENTIAL_HEADER,
    ...(input.description ? { description: input.description } : {}),
  });
  return Object.freeze({
    challenge,
    paymentRequest,
    wwwAuthenticate: encodeNayoriMppChallengeHeader(challenge),
  });
}

function normalizeHexTransaction(value: unknown): string {
  const transaction = requireString(value, "transaction", { max: MAX_TRANSACTION_BYTES * 2 + 2 });
  const hex = transaction.startsWith("0x") ? transaction.slice(2) : transaction;
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw mppError("invalid_transaction", "Stacks transaction must be hexadecimal consensus bytes.");
  }
  try {
    const decoded = deserializeTransaction(hex);
    if (transactionToHex(decoded).toLowerCase() !== hex.toLowerCase()) {
      throw mppError("invalid_transaction", "Stacks transaction is non-canonical or has trailing bytes.");
    }
  } catch (cause) {
    if (cause instanceof NayoriMppVerificationError) throw cause;
    throw mppError("invalid_transaction", "Stacks transaction cannot be decoded.", { cause });
  }
  return hex.toLowerCase();
}

function transactionBase64FromHex(value: unknown): string {
  const hex = normalizeHexTransaction(value);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return btoa(bytesToBinary(bytes));
}

function transactionHexFromBase64(value: unknown): string {
  const base64 = requireString(value, "credential.payload.transaction", {
    max: Math.ceil(MAX_TRANSACTION_BYTES / 3) * 4,
    pattern: BASE64_PATTERN,
  });
  if (base64.length % 4 !== 0) {
    throw mppError("invalid_transaction", "MPP Stacks transaction must use padded canonical base64.");
  }
  try {
    const bytes = binaryToBytes(atob(base64));
    if (btoa(bytesToBinary(bytes)) !== base64 || bytes.length > MAX_TRANSACTION_BYTES) {
      throw mppError("invalid_transaction", "MPP Stacks transaction base64 is non-canonical.");
    }
    let hex = "";
    for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
    return normalizeHexTransaction(hex);
  } catch (cause) {
    if (cause instanceof NayoriMppVerificationError) throw cause;
    throw mppError("invalid_transaction", "MPP Stacks transaction cannot be decoded.", { cause });
  }
}

function parseSource(value: unknown): {
  source: string;
  chainId: "1" | "2147483648";
  principal: string;
} {
  const source = requireString(value, "credential.source", { max: 96 });
  const match = /^stacks:(1|2147483648):([^.:]+)$/.exec(source);
  if (!match?.[1] || !match[2] || !validateStacksAddress(match[2])) {
    throw mppError(
      "invalid_source",
      "MPP Stacks source must be stacks:<chainId>:<standard-principal>."
    );
  }
  const matchesNetwork =
    match[1] === "1"
      ? match[2].startsWith("SP") || match[2].startsWith("SM")
      : match[2].startsWith("ST") || match[2].startsWith("SN");
  if (!matchesNetwork) {
    throw mppError("network_mismatch", "MPP source principal does not match its Stacks chain id.");
  }
  return {
    source,
    chainId: match[1] as "1" | "2147483648",
    principal: match[2],
  };
}

function normalizeCredential(value: unknown): NayoriMppUsdcStacksCredential {
  if (!isRecord(value)) throw mppError("malformed_credential", "MPP credential must be an object.");
  exactKeys(value, ["challenge", "source", "payload"], "credential");
  const challenge = normalizeChallenge(value.challenge);
  const source = parseSource(value.source).source;
  if (!isRecord(value.payload)) {
    throw mppError("malformed_credential", "MPP credential.payload must be an object.");
  }
  exactKeys(value.payload, ["type", "transaction", "transactionFormat"], "credential.payload");
  if (
    value.payload.type !== "transaction" ||
    (value.payload.transactionFormat !== undefined &&
      value.payload.transactionFormat !== NAYORI_MPP_TRANSACTION_FORMAT)
  ) {
    throw mppError(
      "unsupported_payload",
      "MPP Stacks payload requires transaction and stacks_transaction_v1."
    );
  }
  const transaction = requireString(value.payload.transaction, "credential.payload.transaction", {
    max: Math.ceil(MAX_TRANSACTION_BYTES / 3) * 4,
    pattern: BASE64_PATTERN,
  });
  transactionHexFromBase64(transaction);
  return Object.freeze({
    challenge,
    source,
    payload: Object.freeze({
      type: "transaction",
      transaction,
      ...(value.payload.transactionFormat === undefined
        ? {}
        : { transactionFormat: NAYORI_MPP_TRANSACTION_FORMAT }),
    }),
  });
}

export function createNayoriMppUsdcStacksCredential(
  input: CreateNayoriMppCredentialInput
): NayoriMppUsdcStacksCredential {
  const challenge = normalizeChallenge(input.challenge);
  const source = parseSource(input.source);
  const paymentRequest = decodeNayoriMppUsdcStacksRequest(challenge.request);
  if (source.chainId !== paymentRequest.methodDetails.stacks.chainId) {
    throw mppError("network_mismatch", "MPP source chain does not match the payment request.");
  }
  return normalizeCredential({
    challenge,
    source: source.source,
    payload: {
      type: "transaction",
      transaction: transactionBase64FromHex(input.transaction),
      transactionFormat: NAYORI_MPP_TRANSACTION_FORMAT,
    },
  });
}

/**
 * Builds the canonical Nayori USDCx transfer and selects the OnChainOnly
 * anchor mode required by the MPP USDC Stacks profile. The returned
 * transaction is unsigned and can be passed to Leather or another signer.
 */
export async function buildNayoriMppUnsignedPaymentTransaction(
  intent: NayoriX402PaymentIntent
): Promise<string> {
  if (intent.asset !== "usdcx") {
    throw mppError("unsupported_asset", "MPP method=usdc on Stacks requires a USDCx intent.");
  }
  const transaction = deserializeTransaction(
    await buildNayoriX402UnsignedPaymentTransaction(intent)
  );
  transaction.anchorMode = AnchorMode.OnChainOnly;
  return transactionToHex(transaction).toLowerCase();
}

export function encodeNayoriMppCredentialHeader(
  credentialInput: NayoriMppUsdcStacksCredential
): string {
  const credential = normalizeCredential(credentialInput);
  return `${MPP_PAYMENT_SCHEME} ${encodeNayoriMppJson(credential)}`;
}

export function decodeNayoriMppCredentialHeader(value: string): NayoriMppUsdcStacksCredential {
  const match = /^Payment ([A-Za-z0-9_-]+)$/.exec(value);
  if (!match?.[1]) {
    throw mppError("malformed_credential", "Payment credential header is malformed.");
  }
  return normalizeCredential(decodeNayoriMppJson(match[1], "MPP credential"));
}

function challengesEqual(left: NayoriMppChallenge, right: NayoriMppChallenge): boolean {
  return canonicalizeNayoriMppJson(left) === canonicalizeNayoriMppJson(right);
}

function ensureLowSStandardOnChainTransaction(transactionHex: string): void {
  const transaction = deserializeTransaction(transactionHex);
  if (transaction.anchorMode !== AnchorMode.OnChainOnly) {
    throw mppError("anchor_mode_mismatch", "MPP Stacks transactions require OnChainOnly anchor mode.");
  }
  if (transaction.auth.authType !== AuthType.Standard) {
    throw mppError("sponsorship_not_enabled", "This MPP profile accepts standard transactions only.");
  }
  const condition = transaction.auth.spendingCondition;
  if (!isSingleSig(condition)) {
    throw mppError("unsupported_authorization", "MPP Stacks requires a single origin signature.");
  }
  const signature = condition.signature.data;
  if (!/^(?:0[0-3])[0-9a-f]{128}$/i.test(signature)) {
    throw mppError("invalid_origin_signature", "MPP Stacks origin signature encoding is invalid.");
  }
  const s = BigInt(`0x${signature.slice(66)}`);
  if (s === 0n || s > SECP256K1_HALF_ORDER) {
    throw mppError("non_canonical_signature", "MPP Stacks origin signature must use low-s form.");
  }
}

export async function verifyNayoriMppUsdcStacksPayment(
  input: VerifyNayoriMppUsdcStacksPaymentInput
): Promise<NayoriMppVerifiedUsdcStacksPayment> {
  const credential = normalizeCredential(input.credential);
  const expectedChallenge = normalizeChallenge(input.expectedChallenge);
  if (!challengesEqual(credential.challenge, expectedChallenge)) {
    throw mppError("invalid_challenge", "MPP credential does not echo the selected challenge exactly.");
  }
  const expectedBundle = await createNayoriMppUsdcStacksChallenge({
    quote: input.trustedQuote,
    realm: expectedChallenge.realm,
    ...(expectedChallenge.description ? { description: expectedChallenge.description } : {}),
  });
  if (!challengesEqual(expectedBundle.challenge, expectedChallenge)) {
    throw mppError("invalid_challenge", "MPP challenge is not bound to the trusted Nayori quote.");
  }
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const clockSkewSeconds = input.clockSkewSeconds ?? 30;
  if (
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0 ||
    !Number.isSafeInteger(clockSkewSeconds) ||
    clockSkewSeconds < 0
  ) {
    throw mppError("invalid_verifier_config", "MPP verifier timestamps are invalid.");
  }
  if (nowSeconds * 1_000 > Date.parse(expectedChallenge.expires) + clockSkewSeconds * 1_000) {
    throw mppError("payment_expired", "MPP challenge has expired.");
  }

  const paymentRequest = decodeNayoriMppUsdcStacksRequest(expectedChallenge.request);
  const source = parseSource(credential.source);
  if (source.chainId !== paymentRequest.methodDetails.stacks.chainId) {
    throw mppError("network_mismatch", "MPP payer source is on the wrong Stacks chain.");
  }
  const transaction = transactionHexFromBase64(credential.payload.transaction);
  ensureLowSStandardOnChainTransaction(transaction);

  const requirements = await createNayoriX402PaymentRequirements(input.trustedQuote);
  const verified = await verifyNayoriX402DirectPayment({
    paymentRequirements: requirements,
    paymentPayload: createNayoriX402DirectPaymentPayload({
      paymentRequirements: requirements,
      transaction,
      resource: { url: input.trustedQuote.url },
    }),
    trustedQuote: input.trustedQuote,
    request: input.request,
    nowSeconds,
    clockSkewSeconds,
  });
  if (verified.asset !== "usdcx" || verified.payer !== source.principal) {
    throw mppError("payer_mismatch", "MPP source does not match the signed USDCx transfer origin.");
  }
  if (
    paymentRequest.amount !== verified.amount.toString() ||
    paymentRequest.recipient !== verified.payTo ||
    paymentRequest.externalId !== verified.quoteId
  ) {
    throw mppError("payment_request_mismatch", "MPP request does not match the verified payment.");
  }
  return Object.freeze({
    ...verified,
    protocol: "mpp",
    method: NAYORI_MPP_METHOD,
    intent: NAYORI_MPP_INTENT,
    profile: NAYORI_MPP_PROFILE,
    challengeId: expectedChallenge.id,
    source: source.source,
  });
}

function normalizeReceiptReference(value: unknown): string {
  try {
    return normalizeTxid(requireString(value, "receipt.reference", { max: 128 }));
  } catch (cause) {
    throw mppError("invalid_receipt", "MPP Stacks receipt reference must be a transaction ID.", {
      cause,
    });
  }
}

export function createNayoriMppUsdcStacksReceipt(
  input: CreateNayoriMppReceiptInput
): NayoriMppUsdcStacksReceipt {
  if (input.network !== "mainnet" && input.network !== "testnet") {
    throw mppError("invalid_receipt", "Receipt network must be mainnet or testnet.");
  }
  const settledAt = input.settledAt ?? new Date();
  const timestamp =
    settledAt instanceof Date
      ? settledAt.toISOString()
      : normalizeRfc3339(settledAt, "settledAt");
  return Object.freeze({
    method: NAYORI_MPP_METHOD,
    type: NAYORI_MPP_PROFILE,
    challengeId: requireString(input.challengeId, "challengeId", {
      max: 128,
      pattern: CHALLENGE_ID_PATTERN,
    }),
    reference: normalizeReceiptReference(input.reference),
    status: "success",
    timestamp,
    network: input.network === "mainnet" ? "stacks:1" : "stacks:2147483648",
    ...(input.externalId
      ? { externalId: requireString(input.externalId, "externalId", { max: 128 }) }
      : {}),
  });
}

export function encodeNayoriMppReceiptHeader(receipt: NayoriMppUsdcStacksReceipt): string {
  return encodeNayoriMppJson(receipt);
}

export function decodeNayoriMppReceiptHeader(value: string): NayoriMppUsdcStacksReceipt {
  const decoded = decodeNayoriMppJson(value, "Payment-Receipt");
  if (!isRecord(decoded)) throw mppError("invalid_receipt", "Payment-Receipt must be an object.");
  exactKeys(
    decoded,
    ["method", "type", "challengeId", "reference", "status", "timestamp", "network", "externalId"],
    "Payment-Receipt"
  );
  if (
    decoded.method !== NAYORI_MPP_METHOD ||
    decoded.type !== NAYORI_MPP_PROFILE ||
    decoded.status !== "success" ||
    (decoded.network !== "stacks:1" && decoded.network !== "stacks:2147483648")
  ) {
    throw mppError("invalid_receipt", "Payment-Receipt profile fields are invalid.");
  }
  return Object.freeze({
    method: NAYORI_MPP_METHOD,
    type: NAYORI_MPP_PROFILE,
    challengeId: requireString(decoded.challengeId, "receipt.challengeId", {
      max: 128,
      pattern: CHALLENGE_ID_PATTERN,
    }),
    reference: normalizeReceiptReference(decoded.reference),
    status: "success",
    timestamp: normalizeRfc3339(decoded.timestamp, "receipt.timestamp"),
    network: decoded.network,
    ...(decoded.externalId === undefined
      ? {}
      : { externalId: requireString(decoded.externalId, "receipt.externalId", { max: 128 }) }),
  });
}

export function nayoriMppStacksReplayKey(
  payment: Pick<
    NayoriMppVerifiedUsdcStacksPayment,
    "network" | "payer" | "originNonce" | "transactionHash"
  >
): string {
  return `mpp:${payment.network}:${payment.payer}:${payment.originNonce.toString()}:${payment.transactionHash}`;
}
