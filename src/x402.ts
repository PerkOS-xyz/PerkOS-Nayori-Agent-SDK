import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import {
  validatePaymentPayload,
  validatePaymentRequired,
  validatePaymentRequirements,
} from "@x402/core/schemas";
import type {
  PaymentPayload,
  PaymentPayloadResult,
  PaymentRequired,
  PaymentRequirements,
  ResourceInfo,
  SchemeNetworkClient,
  SettleResponse,
} from "@x402/core/types";
import { PerkOSError } from "./errors.js";
import { normalizeTxid } from "./txid.js";
import type {
  AmountLike,
  ConfirmationOptions,
  ContractId,
  FundJobInput,
  JobRecord,
  PaymentAsset,
  PerkOSNetwork,
  ResolvedPerkOSConfig,
  TransactionConfirmation,
  TransactionReceipt,
} from "./types.js";
import { assertPrincipal, toUint } from "./validation.js";

export const X402_VERSION = 2;
export const PERKOS_X402_SCHEME = "exact";
export const PERKOS_X402_ASSET_TRANSFER_METHOD = "perkos-escrow-v1";
export const PERKOS_X402_PAYMENT_FLOW = "upfront";
export const STACKS_X402_NETWORKS = {
  mainnet: "stacks:1",
  testnet: "stacks:2147483648",
} as const;

const X402_NETWORK_TO_PERKOS: Readonly<Record<string, PerkOSNetwork>> = {
  "stacks:1": "mainnet",
  "stacks:2147483648": "testnet",
};
const DEFAULT_TIMEOUT_SECONDS = 600;
const MAX_TIMEOUT_SECONDS = 3_600;

export interface PerkOSX402ClientLike {
  readonly config: ResolvedPerkOSConfig;
  getJob(asset: PaymentAsset, jobId: AmountLike): Promise<JobRecord | null>;
  fundJob(input: FundJobInput): Promise<TransactionReceipt>;
  confirm(
    receiptOrTxid: TransactionReceipt | string,
    options?: ConfirmationOptions
  ): Promise<TransactionConfirmation>;
}

export interface PerkOSX402PaymentRequiredInput {
  readonly resource: ResourceInfo;
  readonly asset: PaymentAsset;
  readonly jobId: AmountLike;
  readonly amount: AmountLike;
  readonly maxTimeoutSeconds?: number;
  readonly error?: string;
}

export interface ParsedPerkOSX402Requirement {
  readonly network: PerkOSNetwork;
  readonly asset: PaymentAsset;
  readonly jobId: bigint;
  readonly amount: bigint;
  readonly commerceContract: ContractId;
  readonly assetIdentifier: string;
  readonly maxTimeoutSeconds: number;
}

export interface PerkOSX402PaymentProof extends ParsedPerkOSX402Requirement {
  readonly transaction: string;
  readonly payer: string;
  readonly blockHeight?: number;
  readonly blockHash?: string;
}

export interface PerkOSX402SchemeClientOptions {
  readonly client: PerkOSX402ClientLike;
  readonly confirmation?: ConfirmationOptions;
}

function x402Error(message: string, details?: Record<string, unknown>): PerkOSError {
  return new PerkOSError("X402_INVALID", message, details);
}

function commerceContract(config: ResolvedPerkOSConfig, asset: PaymentAsset): ContractId {
  return asset === "sbtc" ? config.contracts.sbtcCommerce : config.contracts.stxCommerce;
}

function assetIdentifier(config: ResolvedPerkOSConfig, asset: PaymentAsset): string {
  return asset === "sbtc"
    ? `${config.contracts.sbtcToken}::${config.contracts.sbtcAssetName}`
    : "STX";
}

function parseProtocolObject<T>(label: string, parser: () => T): T {
  try {
    return parser();
  } catch (cause) {
    throw x402Error(`${label} is not a valid x402 v2 object.`, { cause });
  }
}

function requireExtraString(
  extra: Record<string, unknown>,
  field: string
): string {
  const value = extra[field];
  if (typeof value !== "string" || value.length === 0) {
    throw x402Error(`paymentRequirements.extra.${field} must be a non-empty string.`, {
      field,
      value,
    });
  }
  return value;
}

function parseTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMEOUT_SECONDS) {
    throw x402Error(
      `maxTimeoutSeconds must be an integer between 1 and ${MAX_TIMEOUT_SECONDS}.`,
      { value }
    );
  }
  return value;
}

function parseResource(resource: ResourceInfo): ResourceInfo {
  let url: URL;
  try {
    url = new URL(resource.url);
  } catch (cause) {
    throw x402Error("resource.url must be a valid HTTP or HTTPS URL.", { cause });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw x402Error("resource.url must use HTTP or HTTPS.", { protocol: url.protocol });
  }
  return resource;
}

export function toStacksX402Network(network: PerkOSNetwork): (typeof STACKS_X402_NETWORKS)[PerkOSNetwork] {
  return STACKS_X402_NETWORKS[network];
}

export function fromStacksX402Network(network: string): PerkOSNetwork {
  const resolved = X402_NETWORK_TO_PERKOS[network];
  if (!resolved) {
    throw x402Error("network must be a supported Stacks CAIP-2 identifier.", { network });
  }
  return resolved;
}

export function createPerkOSX402PaymentRequired(
  config: ResolvedPerkOSConfig,
  input: PerkOSX402PaymentRequiredInput
): PaymentRequired {
  const jobId = toUint(input.jobId, "jobId");
  const amount = toUint(input.amount, "amount");
  const contract = commerceContract(config, input.asset);
  const timeout = parseTimeout(input.maxTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS);
  const paymentRequired: PaymentRequired = {
    x402Version: X402_VERSION,
    ...(input.error ? { error: input.error } : {}),
    resource: parseResource(input.resource),
    accepts: [
      {
        scheme: PERKOS_X402_SCHEME,
        network: toStacksX402Network(config.network),
        amount: amount.toString(),
        asset: assetIdentifier(config, input.asset),
        payTo: contract,
        maxTimeoutSeconds: timeout,
        extra: {
          assetTransferMethod: PERKOS_X402_ASSET_TRANSFER_METHOD,
          paymentFlow: PERKOS_X402_PAYMENT_FLOW,
          paymentAsset: input.asset,
          jobId: jobId.toString(),
          commerceContract: contract,
        },
      },
    ],
    extensions: {},
  };
  return parseProtocolObject("paymentRequired", () => {
    validatePaymentRequired(paymentRequired);
    return paymentRequired;
  });
}

export function parsePerkOSX402Requirement(
  config: ResolvedPerkOSConfig,
  paymentRequirements: PaymentRequirements
): ParsedPerkOSX402Requirement {
  const requirements = parseProtocolObject("paymentRequirements", () => {
    validatePaymentRequirements(paymentRequirements);
    return paymentRequirements;
  });
  if (requirements.scheme !== PERKOS_X402_SCHEME) {
    throw x402Error(`scheme must be ${PERKOS_X402_SCHEME}.`, {
      scheme: requirements.scheme,
    });
  }
  const network = fromStacksX402Network(requirements.network);
  if (network !== config.network) {
    throw x402Error("The x402 requirement network does not match the SDK client network.", {
      requirementNetwork: network,
      clientNetwork: config.network,
    });
  }
  const extra = requirements.extra ?? {};
  if (requireExtraString(extra, "assetTransferMethod") !== PERKOS_X402_ASSET_TRANSFER_METHOD) {
    throw x402Error(
      `assetTransferMethod must be ${PERKOS_X402_ASSET_TRANSFER_METHOD}.`
    );
  }
  if (requireExtraString(extra, "paymentFlow") !== PERKOS_X402_PAYMENT_FLOW) {
    throw x402Error(`paymentFlow must be ${PERKOS_X402_PAYMENT_FLOW}.`);
  }
  const paymentAsset = requireExtraString(extra, "paymentAsset");
  if (paymentAsset !== "sbtc" && paymentAsset !== "stx") {
    throw x402Error('paymentAsset must be "sbtc" or "stx".', { paymentAsset });
  }
  const asset = paymentAsset;
  const expectedContract = commerceContract(config, asset);
  const declaredContract = requireExtraString(extra, "commerceContract");
  if (requirements.payTo !== expectedContract || declaredContract !== expectedContract) {
    throw x402Error("payTo and commerceContract must match the configured escrow contract.", {
      payTo: requirements.payTo,
      declaredContract,
      expectedContract,
    });
  }
  const expectedAsset = assetIdentifier(config, asset);
  if (requirements.asset !== expectedAsset) {
    throw x402Error("The x402 asset does not match the configured settlement asset.", {
      asset: requirements.asset,
      expectedAsset,
    });
  }
  const jobId = toUint(requireExtraString(extra, "jobId"), "jobId");
  const amount = toUint(requirements.amount, "amount");
  return {
    network,
    asset,
    jobId,
    amount,
    commerceContract: expectedContract,
    assetIdentifier: expectedAsset,
    maxTimeoutSeconds: parseTimeout(requirements.maxTimeoutSeconds),
  };
}

export function parsePerkOSX402PaymentPayload(
  config: ResolvedPerkOSConfig,
  paymentPayload: PaymentPayload
): PerkOSX402PaymentProof {
  const parsed = parseProtocolObject("paymentPayload", () => {
    validatePaymentPayload(paymentPayload);
    return paymentPayload;
  });
  if (parsed.x402Version !== X402_VERSION) {
    throw x402Error(`x402Version must be ${X402_VERSION}.`, {
      x402Version: parsed.x402Version,
    });
  }
  const requirement = parsePerkOSX402Requirement(config, parsed.accepted);
  const transactionValue = parsed.payload.transaction;
  const payer = parsed.payload.payer;
  const jobId = parsed.payload.jobId;
  const amount = parsed.payload.amount;
  const paymentAsset = parsed.payload.asset;
  const contract = parsed.payload.commerceContract;
  if (typeof transactionValue !== "string") {
    throw x402Error("payload.transaction must be a Stacks transaction ID.");
  }
  const transaction = normalizeTxid(transactionValue);
  if (typeof payer !== "string") {
    throw x402Error("payload.payer must be a Stacks principal.");
  }
  assertPrincipal(payer, "payload.payer", config.network);
  if (jobId !== requirement.jobId.toString()) {
    throw x402Error("payload.jobId does not match the accepted requirement.", {
      jobId,
      expectedJobId: requirement.jobId.toString(),
    });
  }
  if (amount !== requirement.amount.toString()) {
    throw x402Error("payload.amount does not match the accepted requirement.", {
      amount,
      expectedAmount: requirement.amount.toString(),
    });
  }
  if (paymentAsset !== requirement.asset || contract !== requirement.commerceContract) {
    throw x402Error("The payment proof asset or contract does not match the requirement.", {
      paymentAsset,
      contract,
    });
  }
  const blockHeight = parsed.payload.blockHeight;
  const blockHash = parsed.payload.blockHash;
  if (
    blockHeight !== undefined &&
    (typeof blockHeight !== "number" ||
      !Number.isSafeInteger(blockHeight) ||
      blockHeight < 0)
  ) {
    throw x402Error("payload.blockHeight must be a non-negative safe integer.");
  }
  if (blockHash !== undefined && typeof blockHash !== "string") {
    throw x402Error("payload.blockHash must be a string.");
  }
  return {
    ...requirement,
    transaction,
    payer,
    ...(typeof blockHeight === "number" ? { blockHeight } : {}),
    ...(typeof blockHash === "string" ? { blockHash } : {}),
  };
}

export class PerkOSX402SchemeClient implements SchemeNetworkClient {
  readonly scheme = PERKOS_X402_SCHEME;
  private readonly client: PerkOSX402ClientLike;
  private readonly confirmation: ConfirmationOptions;

  constructor(options: PerkOSX402SchemeClientOptions) {
    this.client = options.client;
    this.confirmation = options.confirmation ?? {};
  }

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements
  ): Promise<PaymentPayloadResult> {
    if (x402Version !== X402_VERSION) {
      throw x402Error(`x402Version must be ${X402_VERSION}.`, { x402Version });
    }
    const requirement = parsePerkOSX402Requirement(
      this.client.config,
      paymentRequirements
    );
    const job = await this.client.getJob(requirement.asset, requirement.jobId);
    if (!job) {
      throw x402Error(`Job ${requirement.jobId} does not exist.`, {
        jobId: requirement.jobId,
        asset: requirement.asset,
      });
    }
    if (job.status !== "open") {
      throw x402Error(`Job ${requirement.jobId} must be open before x402 funding.`, {
        status: job.status,
      });
    }
    if (job.budget !== requirement.amount) {
      throw x402Error("The on-chain job budget does not match the x402 amount.", {
        jobBudget: job.budget,
        requirementAmount: requirement.amount,
      });
    }

    const receipt = await this.client.fundJob({
      asset: requirement.asset,
      jobId: requirement.jobId,
      amount: requirement.amount,
      sender: job.client,
    });
    this.assertReceipt(receipt, requirement);
    const confirmation = await this.client.confirm(receipt, this.confirmation);
    if (confirmation.txid !== receipt.txid || confirmation.status !== "success") {
      throw new PerkOSError(
        "X402_PAYMENT_FAILED",
        "The Stacks escrow funding transaction did not confirm successfully.",
        {
          receiptTxid: receipt.txid,
          confirmationTxid: confirmation.txid,
          status: confirmation.status,
        }
      );
    }

    return {
      x402Version: X402_VERSION,
      payload: {
        transaction: receipt.txid,
        payer: job.client,
        jobId: requirement.jobId.toString(),
        amount: requirement.amount.toString(),
        asset: requirement.asset,
        commerceContract: requirement.commerceContract,
        ...(confirmation.blockHeight !== undefined
          ? { blockHeight: confirmation.blockHeight }
          : {}),
        ...(confirmation.blockHash ? { blockHash: confirmation.blockHash } : {}),
      },
    };
  }

  private assertReceipt(
    receipt: TransactionReceipt,
    requirement: ParsedPerkOSX402Requirement
  ): void {
    const valid =
      receipt.operation === "fund-job" &&
      receipt.network === requirement.network &&
      receipt.contract === requirement.commerceContract &&
      receipt.asset === requirement.asset &&
      receipt.amount === requirement.amount &&
      receipt.jobId === requirement.jobId;
    if (!valid) {
      throw new PerkOSError(
        "X402_PAYMENT_FAILED",
        "The SDK funding receipt does not match the accepted x402 requirement.",
        { receipt, requirement }
      );
    }
    normalizeTxid(receipt.txid);
  }
}

export {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  encodePaymentSignatureHeader,
};

export type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  ResourceInfo,
  SettleResponse,
};
