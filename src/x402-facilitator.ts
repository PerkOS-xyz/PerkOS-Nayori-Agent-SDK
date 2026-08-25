import { deepEqual } from "@x402/core/utils";
import { deserializeCV } from "@stacks/transactions";
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { PerkOSError } from "./errors.js";
import {
  expectPrincipal,
  expectString,
  expectTuple,
  expectUint,
} from "./clarity.js";
import { normalizeTxid } from "./txid.js";
import type {
  PaymentAsset,
  PerkOSNetwork,
  ResolvedPerkOSConfig,
} from "./types.js";
import { normalizeApiUrl } from "./validation.js";
import {
  PERKOS_X402_ASSET_TRANSFER_METHOD,
  PERKOS_X402_PAYMENT_FLOW,
  PERKOS_X402_SCHEME,
  fromStacksX402Network,
  parsePerkOSX402PaymentPayload,
  parsePerkOSX402Requirement,
  toStacksX402Network,
  type PerkOSX402PaymentProof,
} from "./x402.js";

const DEFAULT_API_URL: Readonly<Record<PerkOSNetwork, string>> = {
  mainnet: "https://api.hiro.so",
  testnet: "https://api.testnet.hiro.so",
};
const DEFAULT_MIN_CONFIRMATIONS = 1;
const DEFAULT_CLOCK_SKEW_SECONDS = 30;

export type X402VerifierFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface PerkOSX402TransactionSource {
  getTransaction(txid: string): Promise<unknown | null>;
  getChainTip(): Promise<number>;
}

export interface HiroX402TransactionSourceOptions {
  readonly network: PerkOSNetwork;
  readonly apiUrl?: string;
  readonly fetch?: X402VerifierFetch;
}

export interface PerkOSX402ReplayRecord {
  readonly key: string;
  readonly network: PerkOSNetwork;
  readonly transaction: string;
  readonly payer: string;
  readonly asset: PaymentAsset;
  readonly jobId: string;
  readonly amount: string;
  readonly resource?: string;
  readonly consumedAt: string;
}

export interface PerkOSX402ReplayStore {
  has(key: string): Promise<boolean>;
  consume(key: string, record: PerkOSX402ReplayRecord): Promise<boolean>;
}

export interface PerkOSX402VerifiedPayment {
  readonly network: PerkOSNetwork;
  readonly transaction: string;
  readonly payer: string;
  readonly asset: PaymentAsset;
  readonly jobId: bigint;
  readonly amount: bigint;
  readonly commerceContract: string;
  readonly blockHeight: number;
  readonly blockHash: string;
  readonly blockTime: number;
  readonly confirmations: number;
  readonly replayKey: string;
}

export interface PerkOSX402FacilitatorOptions {
  readonly config: ResolvedPerkOSConfig;
  readonly replayStore: PerkOSX402ReplayStore;
  readonly transactionSource?: PerkOSX402TransactionSource;
  readonly minConfirmations?: number;
  readonly clockSkewSeconds?: number;
  readonly now?: () => number;
}

export class PerkOSX402VerificationError extends Error {
  readonly reason: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    reason: string,
    message: string,
    details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = "PerkOSX402VerificationError";
    this.reason = reason;
    this.details = details;
  }
}

function verificationError(
  reason: string,
  message: string,
  details?: Readonly<Record<string, unknown>>
): PerkOSX402VerificationError {
  return new PerkOSX402VerificationError(reason, message, details);
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new PerkOSError("CONFIG_INVALID", `${field} must be a positive safe integer.`, {
      field,
      value: resolved,
    });
  }
  return resolved;
}

function nonNegativeInteger(
  value: number | undefined,
  fallback: number,
  field: string
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new PerkOSError(
      "CONFIG_INVALID",
      `${field} must be a non-negative safe integer.`,
      { field, value: resolved }
    );
  }
  return resolved;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw verificationError(
      "verification_unavailable",
      `The Stacks API returned an invalid ${label}.`
    );
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw verificationError(
      "verification_unavailable",
      `The Stacks API response is missing ${field}.`
    );
  }
  return value;
}

function requiredInteger(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw verificationError(
      "verification_unavailable",
      `The Stacks API response has an invalid ${field}.`
    );
  }
  return value as number;
}

function optionalPayloadString(payload: PaymentPayload, field: string): string | undefined {
  const value = payload.payload[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizePayloadTxid(payload: PaymentPayload): string {
  const transaction = optionalPayloadString(payload, "transaction");
  if (!transaction) return "";
  try {
    return normalizeTxid(transaction);
  } catch {
    return "";
  }
}

function payloadPayer(payload: PaymentPayload): string | undefined {
  return optionalPayloadString(payload, "payer");
}

function transferMatches(value: unknown, proof: PerkOSX402PaymentProof): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const expectedType = proof.asset === "sbtc" ? "ft_asset" : "stx_asset";
  if (event.type !== expectedType) return false;
  const assetKey = proof.asset === "sbtc" ? "ft_asset" : "stx_asset";
  const assetValue = event[assetKey];
  if (!assetValue || typeof assetValue !== "object" || Array.isArray(assetValue)) {
    return false;
  }
  const asset = assetValue as Record<string, unknown>;
  if (
    asset.type !== "transfer" ||
    asset.sender !== proof.payer ||
    asset.recipient !== proof.commerceContract ||
    asset.amount !== proof.amount.toString()
  ) {
    return false;
  }
  return proof.asset === "stx" || asset.asset_identifier === proof.assetIdentifier;
}

function fundingLogMatches(
  value: unknown,
  proof: PerkOSX402PaymentProof,
  sbtcToken: string
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (event.type !== "contract_log") return false;
  if (
    !event.contract_log ||
    typeof event.contract_log !== "object" ||
    Array.isArray(event.contract_log)
  ) {
    return false;
  }
  const log = event.contract_log as Record<string, unknown>;
  if (log.contract_id !== proof.commerceContract || log.topic !== "print") {
    return false;
  }
  if (!log.value || typeof log.value !== "object" || Array.isArray(log.value)) {
    return false;
  }
  const hex = (log.value as Record<string, unknown>).hex;
  if (typeof hex !== "string" || hex.length === 0) return false;
  try {
    const tuple = expectTuple(deserializeCV(hex), "x402 funding event");
    if (
      expectString(tuple.event, "x402 funding event.event") !== "job-funded" ||
      expectUint(tuple["job-id"], "x402 funding event.job-id") !== proof.jobId ||
      expectUint(tuple.amount, "x402 funding event.amount") !== proof.amount
    ) {
      return false;
    }
    return (
      proof.asset === "stx" ||
      expectPrincipal(tuple.token, "x402 funding event.token") === sbtcToken
    );
  } catch {
    return false;
  }
}

function requirementFailure(cause: unknown): PerkOSX402VerificationError {
  return verificationError(
    "invalid_payment_requirements",
    "The payment requirements are not valid for the configured PerkOS deployment.",
    { cause }
  );
}

function payloadFailure(cause: unknown): PerkOSX402VerificationError {
  return verificationError(
    "invalid_payload",
    "The payment payload is not a valid PerkOS Stacks proof.",
    { cause }
  );
}

export function perkosX402ReplayKey(
  network: PerkOSNetwork,
  txid: string
): string {
  return `${network}:${normalizeTxid(txid)}`;
}

export class HiroX402TransactionSource implements PerkOSX402TransactionSource {
  private readonly apiUrl: string;
  private readonly fetch: X402VerifierFetch;

  constructor(options: HiroX402TransactionSourceOptions) {
    this.apiUrl = normalizeApiUrl(
      options.apiUrl ?? DEFAULT_API_URL[options.network],
      "HiroX402TransactionSource apiUrl"
    );
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async getTransaction(txidInput: string): Promise<unknown | null> {
    const txid = normalizeTxid(txidInput);
    let response: Response;
    try {
      response = await this.fetch(
        `${this.apiUrl}/extended/v3/transactions/${encodeURIComponent(txid)}`,
        { headers: { accept: "application/json" } }
      );
    } catch (cause) {
      throw new PerkOSError(
        "X402_PAYMENT_FAILED",
        "Could not reach the Stacks transaction API.",
        { cause, txid }
      );
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new PerkOSError(
        "X402_PAYMENT_FAILED",
        `Stacks transaction API returned HTTP ${response.status}.`,
        { txid, status: response.status, body: body.slice(0, 500) }
      );
    }
    let transaction: unknown;
    try {
      transaction = await response.json();
    } catch (cause) {
      throw new PerkOSError(
        "X402_PAYMENT_FAILED",
        "Stacks transaction API returned invalid JSON.",
        { cause, txid }
      );
    }

    let eventsResponse: Response;
    try {
      eventsResponse = await this.fetch(
        `${this.apiUrl}/extended/v3/transactions/${encodeURIComponent(txid)}/events?limit=50`,
        { headers: { accept: "application/json" } }
      );
    } catch (cause) {
      throw new PerkOSError(
        "X402_PAYMENT_FAILED",
        "Could not reach the Stacks transaction events API.",
        { cause, txid }
      );
    }
    if (!eventsResponse.ok) {
      const body = await eventsResponse.text().catch(() => "");
      throw new PerkOSError(
        "X402_PAYMENT_FAILED",
        `Stacks transaction events API returned HTTP ${eventsResponse.status}.`,
        { txid, status: eventsResponse.status, body: body.slice(0, 500) }
      );
    }
    let events: unknown;
    try {
      events = await eventsResponse.json();
    } catch (cause) {
      throw new PerkOSError(
        "X402_PAYMENT_FAILED",
        "Stacks transaction events API returned invalid JSON.",
        { cause, txid }
      );
    }
    return { transaction, events };
  }

  async getChainTip(): Promise<number> {
    let response: Response;
    try {
      response = await this.fetch(`${this.apiUrl}/v2/info`, {
        headers: { accept: "application/json" },
      });
    } catch (cause) {
      throw new PerkOSError(
        "X402_PAYMENT_FAILED",
        "Could not read the Stacks chain tip.",
        { cause }
      );
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new PerkOSError(
        "X402_PAYMENT_FAILED",
        `Stacks chain info API returned HTTP ${response.status}.`,
        { status: response.status, body: body.slice(0, 500) }
      );
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (cause) {
      throw new PerkOSError(
        "X402_PAYMENT_FAILED",
        "Stacks chain info API returned invalid JSON.",
        { cause }
      );
    }
    const record = asRecord(raw, "chain info response");
    return requiredInteger(record, "stacks_tip_height");
  }
}

export class InMemoryX402ReplayStore implements PerkOSX402ReplayStore {
  private readonly records = new Map<string, PerkOSX402ReplayRecord>();

  async has(key: string): Promise<boolean> {
    return this.records.has(key);
  }

  async consume(key: string, record: PerkOSX402ReplayRecord): Promise<boolean> {
    if (this.records.has(key)) return false;
    this.records.set(key, record);
    return true;
  }

  get(key: string): PerkOSX402ReplayRecord | undefined {
    return this.records.get(key);
  }
}

export class PerkOSX402Facilitator implements SchemeNetworkFacilitator {
  readonly scheme = PERKOS_X402_SCHEME;
  readonly caipFamily = "stacks:*";
  private readonly config: ResolvedPerkOSConfig;
  private readonly replayStore: PerkOSX402ReplayStore;
  private readonly transactionSource: PerkOSX402TransactionSource;
  private readonly minConfirmations: number;
  private readonly clockSkewSeconds: number;
  private readonly now: () => number;

  constructor(options: PerkOSX402FacilitatorOptions) {
    this.config = options.config;
    this.replayStore = options.replayStore;
    this.transactionSource =
      options.transactionSource ??
      new HiroX402TransactionSource({
        network: options.config.network,
        ...(options.config.apiUrl ? { apiUrl: options.config.apiUrl } : {}),
      });
    this.minConfirmations = positiveInteger(
      options.minConfirmations,
      DEFAULT_MIN_CONFIRMATIONS,
      "minConfirmations"
    );
    this.clockSkewSeconds = nonNegativeInteger(
      options.clockSkewSeconds,
      DEFAULT_CLOCK_SKEW_SECONDS,
      "clockSkewSeconds"
    );
    this.now = options.now ?? Date.now;
  }

  getExtra(network: string): Record<string, unknown> | undefined {
    try {
      if (fromStacksX402Network(network) !== this.config.network) return undefined;
    } catch {
      return undefined;
    }
    return {
      assetTransferMethod: PERKOS_X402_ASSET_TRANSFER_METHOD,
      paymentFlow: PERKOS_X402_PAYMENT_FLOW,
    };
  }

  getSigners(_network: string): string[] {
    return [];
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    try {
      const verified = await this.inspect(payload, requirements);
      return {
        isValid: true,
        payer: verified.payer,
        extra: {
          transaction: verified.transaction,
          blockHeight: verified.blockHeight,
          confirmations: verified.confirmations,
        },
      };
    } catch (cause) {
      const failure = this.asVerificationError(cause);
      const payer = payloadPayer(payload);
      return {
        isValid: false,
        invalidReason: failure.reason,
        invalidMessage: failure.message,
        ...(payer ? { payer } : {}),
      };
    }
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    const network = toStacksX402Network(this.config.network);
    const claimedTransaction = normalizePayloadTxid(payload);
    const claimedPayer = payloadPayer(payload);
    try {
      const verified = await this.inspect(payload, requirements);
      const record: PerkOSX402ReplayRecord = {
        key: verified.replayKey,
        network: verified.network,
        transaction: verified.transaction,
        payer: verified.payer,
        asset: verified.asset,
        jobId: verified.jobId.toString(),
        amount: verified.amount.toString(),
        ...(payload.resource?.url ? { resource: payload.resource.url } : {}),
        consumedAt: new Date(this.now()).toISOString(),
      };
      let consumed: boolean;
      try {
        consumed = await this.replayStore.consume(verified.replayKey, record);
      } catch (cause) {
        throw verificationError(
          "replay_store_unavailable",
          "The replay store could not consume the payment proof.",
          { cause }
        );
      }
      if (!consumed) {
        throw verificationError(
          "payment_already_used",
          "The Stacks funding transaction was already consumed."
        );
      }
      return {
        success: true,
        payer: verified.payer,
        transaction: verified.transaction,
        network,
        amount: verified.amount.toString(),
        extra: {
          asset: verified.asset,
          jobId: verified.jobId.toString(),
          blockHeight: verified.blockHeight,
          confirmations: verified.confirmations,
        },
      };
    } catch (cause) {
      const failure = this.asVerificationError(cause);
      return {
        success: false,
        errorReason: failure.reason,
        errorMessage: failure.message,
        ...(claimedPayer ? { payer: claimedPayer } : {}),
        transaction: claimedTransaction,
        network,
      };
    }
  }

  async inspect(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<PerkOSX402VerifiedPayment> {
    if (!deepEqual(payload.accepted, requirements)) {
      throw verificationError(
        "payment_requirements_mismatch",
        "The payload accepted requirements do not match the server requirements."
      );
    }

    try {
      parsePerkOSX402Requirement(this.config, requirements);
    } catch (cause) {
      throw requirementFailure(cause);
    }

    let proof: PerkOSX402PaymentProof;
    try {
      proof = parsePerkOSX402PaymentPayload(this.config, payload);
    } catch (cause) {
      throw payloadFailure(cause);
    }

    let raw: unknown | null;
    try {
      raw = await this.transactionSource.getTransaction(proof.transaction);
    } catch (cause) {
      throw verificationError(
        "verification_unavailable",
        "The Stacks transaction could not be loaded.",
        { cause }
      );
    }
    if (raw === null) {
      throw verificationError(
        "transaction_not_found",
        "The Stacks funding transaction was not found."
      );
    }

    const evidence = asRecord(raw, "transaction evidence");
    const transaction = asRecord(evidence.transaction, "transaction");
    const apiTxid = normalizeTxid(requiredString(transaction, "tx_id"));
    if (apiTxid !== proof.transaction) {
      throw verificationError(
        "transaction_mismatch",
        "The Stacks API returned a different transaction ID."
      );
    }
    if (requiredString(transaction, "status") !== "success") {
      throw verificationError(
        "invalid_transaction_state",
        "The Stacks funding transaction did not execute successfully."
      );
    }
    if (requiredString(transaction, "type") !== "contract_call") {
      throw verificationError(
        "invalid_transaction_type",
        "The payment proof is not a Stacks contract call."
      );
    }
    const sender = asRecord(transaction.sender, "transaction sender");
    if (requiredString(sender, "address") !== proof.payer) {
      throw verificationError(
        "payer_mismatch",
        "The Stacks transaction sender does not match the payment payer."
      );
    }

    const call = asRecord(transaction.contract_call, "contract call");
    if (requiredString(call, "contract_id") !== proof.commerceContract) {
      throw verificationError(
        "contract_mismatch",
        "The funding call contract does not match the payment requirement."
      );
    }
    if (requiredString(call, "function_name") !== "fund-job") {
      throw verificationError(
        "function_mismatch",
        "The Stacks transaction did not call fund-job."
      );
    }
    const eventsPage = asRecord(evidence.events, "transaction events page");
    if (!Array.isArray(eventsPage.results)) {
      throw verificationError(
        "verification_unavailable",
        "The Stacks API response has no transaction events."
      );
    }
    const eventTotal = requiredInteger(eventsPage, "total");
    if (eventTotal !== eventsPage.results.length) {
      throw verificationError(
        "verification_unavailable",
        "The Stacks transaction event page is incomplete."
      );
    }
    if (
      !eventsPage.results.some((event) =>
        fundingLogMatches(event, proof, this.config.contracts.sbtcToken)
      )
    ) {
      throw verificationError(
        "funding_event_mismatch",
        "No exact job-funded contract event matches the payment requirement."
      );
    }
    if (!eventsPage.results.some((event) => transferMatches(event, proof))) {
      throw verificationError(
        "transfer_mismatch",
        "No exact escrow transfer event matches the payment requirement."
      );
    }

    const block = asRecord(transaction.block, "transaction block");
    const blockHeight = requiredInteger(block, "height");
    const blockHash = requiredString(block, "hash");
    const blockTime = requiredInteger(block, "time");
    if (
      (proof.blockHeight !== undefined && proof.blockHeight !== blockHeight) ||
      (proof.blockHash !== undefined && proof.blockHash !== blockHash)
    ) {
      throw verificationError(
        "proof_block_mismatch",
        "The client proof block metadata does not match the Stacks API."
      );
    }

    let chainTip: number;
    try {
      chainTip = await this.transactionSource.getChainTip();
    } catch (cause) {
      throw verificationError(
        "verification_unavailable",
        "The Stacks chain tip could not be loaded.",
        { cause }
      );
    }
    if (!Number.isSafeInteger(chainTip) || chainTip < blockHeight) {
      throw verificationError(
        "verification_unavailable",
        "The Stacks chain tip is inconsistent with the transaction block."
      );
    }
    const confirmations = chainTip - blockHeight + 1;
    if (confirmations < this.minConfirmations) {
      throw verificationError(
        "insufficient_confirmations",
        "The Stacks funding transaction has insufficient confirmations.",
        { confirmations, required: this.minConfirmations }
      );
    }

    const nowSeconds = Math.floor(this.now() / 1_000);
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      throw verificationError(
        "verification_unavailable",
        "The verifier clock returned an invalid time."
      );
    }
    if (blockTime > nowSeconds + this.clockSkewSeconds) {
      throw verificationError(
        "transaction_time_in_future",
        "The Stacks funding transaction time is in the future."
      );
    }
    if (
      nowSeconds - blockTime >
      proof.maxTimeoutSeconds + this.clockSkewSeconds
    ) {
      throw verificationError(
        "payment_expired",
        "The Stacks funding transaction is older than the x402 payment window."
      );
    }

    const replayKey = perkosX402ReplayKey(proof.network, proof.transaction);
    let alreadyUsed: boolean;
    try {
      alreadyUsed = await this.replayStore.has(replayKey);
    } catch (cause) {
      throw verificationError(
        "replay_store_unavailable",
        "The replay store could not check the payment proof.",
        { cause }
      );
    }
    if (alreadyUsed) {
      throw verificationError(
        "payment_already_used",
        "The Stacks funding transaction was already consumed."
      );
    }

    return {
      network: proof.network,
      transaction: proof.transaction,
      payer: proof.payer,
      asset: proof.asset,
      jobId: proof.jobId,
      amount: proof.amount,
      commerceContract: proof.commerceContract,
      blockHeight,
      blockHash,
      blockTime,
      confirmations,
      replayKey,
    };
  }

  private asVerificationError(cause: unknown): PerkOSX402VerificationError {
    if (cause instanceof PerkOSX402VerificationError) return cause;
    return verificationError(
      "unexpected_verify_error",
      "The Stacks payment proof could not be verified.",
      { cause }
    );
  }
}
