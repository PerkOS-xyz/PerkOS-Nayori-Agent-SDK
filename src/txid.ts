import { PerkOSError } from "./errors.js";

const TXID = /^[0-9a-f]{64}$/i;

export function normalizeTxid(value: string): string {
  if (typeof value !== "string") {
    throw new PerkOSError(
      "BROADCAST_REJECTED",
      "The signer returned no Stacks transaction ID.",
      { txid: value }
    );
  }
  const hex = value.trim().replace(/^0x/i, "");
  if (!TXID.test(hex)) {
    throw new PerkOSError(
      "BROADCAST_REJECTED",
      "The signer returned an invalid Stacks transaction ID.",
      { txid: value }
    );
  }
  return `0x${hex.toLowerCase()}`;
}
