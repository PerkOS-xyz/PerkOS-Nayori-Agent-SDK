import {
  broadcastTransaction,
  getAddressFromPrivateKey,
  makeContractCall,
} from "@stacks/transactions";
import type {
  ClarityValue,
  PostCondition,
  PostConditionModeName,
} from "@stacks/transactions";
import { PerkOSError } from "./errors.js";
import { normalizeTxid } from "./txid.js";
import type {
  ContractCallPlan,
  ContractId,
  PerkOSNetwork,
  PerkOSSigner,
  SignerResult,
} from "./types.js";
import {
  assertPrincipal,
  normalizeApiUrl,
  parseContractId,
} from "./validation.js";

export type PrivateKeyMaterial = string | Uint8Array;
export type PrivateKeyProvider = () =>
  | PrivateKeyMaterial
  | Promise<PrivateKeyMaterial>;

export interface HeadlessTransactionRequest {
  readonly plan: ContractCallPlan;
  readonly privateKey: PrivateKeyMaterial;
  readonly apiUrl?: string;
}

export type HeadlessTransactionExecutor = (
  request: HeadlessTransactionRequest
) => Promise<SignerResult>;

export interface HeadlessSignerOptions {
  readonly network: PerkOSNetwork;
  readonly privateKeyProvider: PrivateKeyProvider;
  readonly apiUrl?: string;
  readonly transactionExecutor?: HeadlessTransactionExecutor;
}

async function defaultHeadlessExecutor(
  request: HeadlessTransactionRequest
): Promise<SignerResult> {
  const { address, name } = parseContractId(
    request.plan.contract,
    "plan.contract",
    request.plan.network
  );
  const client = request.apiUrl
    ? { client: { baseUrl: request.apiUrl } }
    : {};
  const transaction = await makeContractCall({
    contractAddress: address,
    contractName: name,
    functionName: request.plan.functionName,
    functionArgs: [...request.plan.functionArgs],
    senderKey: request.privateKey,
    network: request.plan.network,
    postConditions: [...request.plan.postConditions],
    postConditionMode: request.plan.postConditionMode,
    ...client,
  });
  const result = await broadcastTransaction({
    transaction,
    network: request.plan.network,
    ...client,
  });
  if ("error" in result) {
    throw new PerkOSError(
      "BROADCAST_REJECTED",
      `Stacks rejected the transaction: ${result.reason}.`,
      { raw: result, reason: result.reason }
    );
  }
  return { txid: normalizeTxid(result.txid), raw: result };
}

export class HeadlessSigner implements PerkOSSigner {
  private readonly network: PerkOSNetwork;
  private readonly privateKeyProvider: PrivateKeyProvider;
  private readonly apiUrl: string | undefined;
  private readonly transactionExecutor: HeadlessTransactionExecutor;
  private address: string | undefined;

  constructor(options: HeadlessSignerOptions) {
    if (typeof options.privateKeyProvider !== "function") {
      throw new PerkOSError(
        "CONFIG_INVALID",
        "HeadlessSigner requires a privateKeyProvider callback."
      );
    }
    this.network = options.network;
    this.privateKeyProvider = options.privateKeyProvider;
    this.apiUrl = options.apiUrl
      ? normalizeApiUrl(options.apiUrl, "HeadlessSigner apiUrl")
      : undefined;
    this.transactionExecutor =
      options.transactionExecutor ?? defaultHeadlessExecutor;
  }

  async getAddress(): Promise<string> {
    if (this.address) return this.address;
    const address = await this.withPrivateKey((privateKey) =>
      getAddressFromPrivateKey(privateKey, this.network)
    );
    assertPrincipal(address, "headless signer address", this.network);
    this.address = address;
    return address;
  }

  async signAndBroadcast(plan: ContractCallPlan): Promise<SignerResult> {
    if (plan.network !== this.network) {
      throw new PerkOSError(
        "SIGNER_MISMATCH",
        `HeadlessSigner is configured for ${this.network}, not ${plan.network}.`
      );
    }
    const result = await this.withPrivateKey((privateKey) =>
      this.transactionExecutor({
        plan,
        privateKey,
        ...(this.apiUrl ? { apiUrl: this.apiUrl } : {}),
      })
    );
    return { ...result, txid: normalizeTxid(result.txid) };
  }

  private async withPrivateKey<T>(
    operation: (privateKey: PrivateKeyMaterial) => T | Promise<T>
  ): Promise<T> {
    let privateKey: PrivateKeyMaterial | undefined;
    try {
      const supplied = await this.privateKeyProvider();
      privateKey =
        typeof supplied === "string"
          ? supplied.trim()
          : Uint8Array.from(supplied);
      if (privateKey.length === 0) {
        throw new PerkOSError(
          "SIGNING_FAILED",
          "privateKeyProvider returned empty key material."
        );
      }
      return await operation(privateKey);
    } catch (cause) {
      if (cause instanceof PerkOSError) throw cause;
      throw new PerkOSError(
        "SIGNING_FAILED",
        "HeadlessSigner could not use the supplied key material.",
        { cause }
      );
    } finally {
      if (privateKey instanceof Uint8Array) privateKey.fill(0);
    }
  }
}

export interface StacksConnectContractCallParams {
  readonly contract: ContractId;
  readonly functionName: string;
  readonly functionArgs: readonly ClarityValue[];
  readonly network: PerkOSNetwork;
  readonly postConditions: readonly PostCondition[];
  readonly postConditionMode: PostConditionModeName;
  readonly sponsored: boolean;
}

export type StacksConnectRequest = (
  method: "stx_callContract",
  params: StacksConnectContractCallParams
) => Promise<unknown>;

export interface StacksConnectSignerOptions {
  readonly network: PerkOSNetwork;
  readonly address: string;
  readonly request: StacksConnectRequest;
}

function extractConnectTxid(result: unknown): string {
  if (!result || typeof result !== "object") {
    throw new PerkOSError(
      "BROADCAST_REJECTED",
      "Stacks Connect returned an invalid transaction result.",
      { raw: result }
    );
  }
  const record = result as Record<string, unknown>;
  const nested =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : undefined;
  const candidate = record.txid ?? record.txId ?? nested?.txid ?? nested?.txId;
  if (typeof candidate !== "string") {
    throw new PerkOSError(
      "BROADCAST_REJECTED",
      "Stacks Connect did not return a transaction ID.",
      { raw: result }
    );
  }
  return normalizeTxid(candidate);
}

export class StacksConnectSigner implements PerkOSSigner {
  private readonly network: PerkOSNetwork;
  private readonly address: string;
  private readonly request: StacksConnectRequest;

  constructor(options: StacksConnectSignerOptions) {
    assertPrincipal(options.address, "Stacks Connect address", options.network);
    if (typeof options.request !== "function") {
      throw new PerkOSError(
        "CONFIG_INVALID",
        "StacksConnectSigner requires the Stacks Connect request function."
      );
    }
    this.network = options.network;
    this.address = options.address;
    this.request = options.request;
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  async signAndBroadcast(plan: ContractCallPlan): Promise<SignerResult> {
    if (plan.network !== this.network) {
      throw new PerkOSError(
        "SIGNER_MISMATCH",
        `StacksConnectSigner is configured for ${this.network}, not ${plan.network}.`
      );
    }
    try {
      const result = await this.request("stx_callContract", {
        contract: plan.contract,
        functionName: plan.functionName,
        functionArgs: [...plan.functionArgs],
        network: plan.network,
        postConditions: [...plan.postConditions],
        postConditionMode: plan.postConditionMode,
        sponsored: false,
      });
      return { txid: extractConnectTxid(result), raw: result };
    } catch (cause) {
      if (cause instanceof PerkOSError) throw cause;
      throw new PerkOSError(
        "SIGNING_FAILED",
        "Stacks Connect rejected or cancelled the contract call.",
        { cause, contract: plan.contract, functionName: plan.functionName }
      );
    }
  }
}
