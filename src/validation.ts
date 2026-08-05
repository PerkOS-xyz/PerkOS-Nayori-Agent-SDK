import { validateStacksAddress } from "@stacks/transactions";
import { PerkOSError } from "./errors.js";
import type {
  AmountLike,
  ContractId,
  PerkOSContracts,
  PerkOSNetwork,
  ResolvedPerkOSConfig,
} from "./types.js";
import { DEFAULT_DEPLOYMENTS } from "./constants.js";

const CONTRACT_NAME = /^[a-z][a-z0-9-]{0,39}$/;

export function toUint(value: AmountLike, field: string, allowZero = false): bigint {
  let parsed: bigint;
  try {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error("number must be a non-negative safe integer");
    }
    if (typeof value === "string" && !/^\d+$/.test(value)) {
      throw new Error("string must contain only decimal digits");
    }
    parsed = BigInt(value);
  } catch (cause) {
    throw new PerkOSError("INPUT_INVALID", `${field} must be an unsigned integer.`, {
      field,
      value,
      cause,
    });
  }
  if (parsed < 0n || (!allowZero && parsed === 0n)) {
    throw new PerkOSError(
      "INPUT_INVALID",
      `${field} must be ${allowZero ? "zero or greater" : "greater than zero"}.`,
      { field, value }
    );
  }
  return parsed;
}

export function assertAscii(value: string, field: string, maxBytes: number, allowEmpty = false): void {
  if ((!allowEmpty && value.length === 0) || value.length > maxBytes) {
    throw new PerkOSError(
      "INPUT_INVALID",
      `${field} must be ${allowEmpty ? "at most" : "between 1 and"} ${maxBytes} ASCII bytes.`,
      { field, maxBytes }
    );
  }
  for (const character of value) {
    if (character.codePointAt(0)! > 0x7f) {
      throw new PerkOSError("INPUT_INVALID", `${field} must contain ASCII characters only.`, {
        field,
      });
    }
  }
}

export function assertPrincipal(
  principal: string,
  field: string,
  network?: PerkOSNetwork
): void {
  if (!validateStacksAddress(principal)) {
    throw new PerkOSError("INPUT_INVALID", `${field} is not a valid Stacks principal.`, {
      field,
      principal,
    });
  }
  if (network && !principalMatchesNetwork(principal, network)) {
    throw new PerkOSError(
      "INPUT_INVALID",
      `${field} does not belong to Stacks ${network}.`,
      { field, principal, network }
    );
  }
}

export function parseContractId(
  contract: string,
  field: string,
  network?: PerkOSNetwork
): { address: string; name: string } {
  const pieces = contract.split(".");
  if (pieces.length !== 2) {
    throw new PerkOSError("CONFIG_INVALID", `${field} must use <address>.<contract-name>.`, {
      field,
      contract,
    });
  }
  const [address, name] = pieces;
  if (!address || !name || !validateStacksAddress(address) || !CONTRACT_NAME.test(name)) {
    throw new PerkOSError("CONFIG_INVALID", `${field} is not a valid contract identifier.`, {
      field,
      contract,
    });
  }
  if (network && !principalMatchesNetwork(address, network)) {
    throw new PerkOSError("CONFIG_INVALID", `${field} does not belong to Stacks ${network}.`, {
      field,
      contract,
      network,
    });
  }
  return { address, name };
}

export function principalMatchesNetwork(principal: string, network: PerkOSNetwork): boolean {
  return network === "mainnet"
    ? principal.startsWith("SP") || principal.startsWith("SM")
    : principal.startsWith("ST") || principal.startsWith("SN");
}

export function normalizeApiUrl(value: string, field = "apiUrl"): string {
  const normalized = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch (cause) {
    throw new PerkOSError("CONFIG_INVALID", `${field} must be a valid URL.`, {
      cause,
    });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PerkOSError("CONFIG_INVALID", `${field} must use HTTP or HTTPS.`);
  }
  return normalized.replace(/\/+$/, "");
}

export function resolveConfig(input: {
  network: PerkOSNetwork;
  apiUrl?: string;
  contracts?: Partial<PerkOSContracts>;
}): ResolvedPerkOSConfig {
  if (input.network !== "mainnet" && input.network !== "testnet") {
    throw new PerkOSError("CONFIG_INVALID", 'network must be "mainnet" or "testnet".');
  }

  const apiUrl = input.apiUrl ? normalizeApiUrl(input.apiUrl) : undefined;

  const contracts: PerkOSContracts = {
    ...DEFAULT_DEPLOYMENTS[input.network],
    ...input.contracts,
  };

  for (const field of [
    "agentRegistry",
    "stxCommerce",
    "sbtcCommerce",
    "reputationRegistry",
    "sbtcToken",
  ] as const) {
    parseContractId(contracts[field], `contracts.${field}`, input.network);
  }
  assertAscii(contracts.sbtcAssetName, "contracts.sbtcAssetName", 128);

  return {
    network: input.network,
    ...(apiUrl ? { apiUrl } : {}),
    contracts,
  };
}

export function asContractId(value: string): ContractId {
  return value as ContractId;
}
