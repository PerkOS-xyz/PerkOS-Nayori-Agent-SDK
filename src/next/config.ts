import { PerkOSError } from "../errors.js";
import {
  assertAscii,
  assertPrincipal,
  normalizeApiUrl,
  parseContractId,
} from "../validation.js";
import {
  NAYORI_NEXT_CONTRACT_KEYS,
  NAYORI_NEXT_DEPLOYERS,
  nayoriNextContractIds,
} from "./constants.js";
import type {
  NayoriNextConfig,
  NayoriNextContracts,
  ResolvedNayoriNextConfig,
} from "./types.js";

export function resolveNayoriNextConfig(
  input: Pick<NayoriNextConfig, "network" | "deployer" | "contracts" | "apiUrl">
): ResolvedNayoriNextConfig {
  if (input.network !== "mainnet" && input.network !== "testnet") {
    throw new PerkOSError("CONFIG_INVALID", 'network must be "mainnet" or "testnet".');
  }
  if (input.deployer !== undefined) {
    assertPrincipal(input.deployer, "deployer", input.network);
    if (input.deployer.includes(".")) {
      throw new PerkOSError("CONFIG_INVALID", "deployer must be a standard address.");
    }
  }
  const contracts: NayoriNextContracts = {
    ...nayoriNextContractIds(input.deployer ?? NAYORI_NEXT_DEPLOYERS[input.network], input.network),
    ...input.contracts,
  };
  for (const key of NAYORI_NEXT_CONTRACT_KEYS) {
    parseContractId(contracts[key], `contracts.${key}`, input.network);
  }
  parseContractId(contracts.sbtcToken, "contracts.sbtcToken", input.network);
  assertAscii(contracts.sbtcAssetName, "contracts.sbtcAssetName", 128);
  const apiUrl = input.apiUrl ? normalizeApiUrl(input.apiUrl) : undefined;
  return {
    network: input.network,
    ...(apiUrl ? { apiUrl } : {}),
    deployed: true,
    contracts,
  };
}

export function assertNayoriNextDeployed(config: ResolvedNayoriNextConfig): void {
  if (!config.deployed) {
    throw new PerkOSError(
      "CONFIG_INVALID",
      `The next Nayori contracts are not deployed on ${config.network} yet. ` +
        "Set `deployer` (or every contract in `contracts`) to a real deployment.",
      { network: config.network }
    );
  }
}
