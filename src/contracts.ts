import { validateStacksAddress } from "@stacks/transactions";

/** Network guards shared with the Nayori Evaluator. Kept byte-identical in both repositories. */
export type StacksNetworkName = "testnet" | "mainnet";

export function isPrincipalForNetwork(value: string, network: StacksNetworkName): boolean {
  const prefix = network === "testnet" ? "ST" : "SP";
  return value.startsWith(prefix) && !value.includes(".") && validateStacksAddress(value);
}

export function isContractIdForNetwork(value: string, network: StacksNetworkName): boolean {
  const [address, name, extra] = value.split(".");
  return !extra && isPrincipalForNetwork(address ?? "", network) &&
    Boolean(name && /^[a-z][a-z0-9-]{0,39}$/.test(name));
}
