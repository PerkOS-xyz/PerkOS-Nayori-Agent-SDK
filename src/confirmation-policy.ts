/** Operator policy, not consensus finality or a promise of wall-clock completion. */
export interface ConfirmationPolicy {
  readonly workflowBurnBlocks: number;
  readonly settlementBurnBlocks: number;
}
export const DEFAULT_CONFIRMATION_POLICY: Readonly<ConfirmationPolicy> = Object.freeze({
  workflowBurnBlocks: 6, settlementBurnBlocks: 6,
});
export function parseConfirmationPolicy(network: "mainnet" | "testnet", value: unknown = DEFAULT_CONFIRMATION_POLICY): Readonly<ConfirmationPolicy> {
  if (network !== "mainnet" && network !== "testnet") throw new Error("invalid_confirmation_network");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_confirmation_policy");
  const p = value as Record<string, unknown>;
  const minimum = network === "mainnet" ? 6 : 0;
  if (Object.keys(p).length !== 2 || !["workflowBurnBlocks", "settlementBurnBlocks"].every(k =>
    Object.hasOwn(p, k) && Number.isSafeInteger(p[k]) && Number(p[k]) >= minimum && Number(p[k]) <= 144) ||
    Number(p.settlementBurnBlocks) < Number(p.workflowBurnBlocks)) throw new Error("invalid_confirmation_policy");
  return Object.freeze({ workflowBurnBlocks: Number(p.workflowBurnBlocks), settlementBurnBlocks: Number(p.settlementBurnBlocks) });
}
export interface ConfirmationObservation {
  readonly txid: string;
  readonly canonical: boolean;
  readonly isUnanchored: boolean;
  readonly status: string;
  readonly burnBlockHeight: number;
  readonly currentBurnBlockHeight: number;
}
export function confirmationProgress(network: "mainnet" | "testnet", policy: ConfirmationPolicy,
  phase: "workflow" | "settlement", expectedTxid: string, tx: ConfirmationObservation) {
  const p = parseConfirmationPolicy(network, policy);
  if (phase !== "workflow" && phase !== "settlement") throw new Error("invalid_confirmation_phase");
  const required = phase === "settlement" ? p.settlementBurnBlocks : p.workflowBurnBlocks;
  const valid = /^0x[a-f0-9]{64}$/.test(expectedTxid) && tx.txid === expectedTxid && tx.canonical === true &&
    tx.isUnanchored === false && tx.status === "success" &&
    Number.isSafeInteger(tx.burnBlockHeight) && tx.burnBlockHeight > 0 &&
    Number.isSafeInteger(tx.currentBurnBlockHeight) && tx.currentBurnBlockHeight >= tx.burnBlockHeight &&
    Number.isSafeInteger(tx.burnBlockHeight + required);
  const remaining = valid ? Math.max(0, tx.burnBlockHeight + required - tx.currentBurnBlockHeight) : null;
  return { phase, requiredAdditionalBurnBlocks: required, remainingBurnBlocks: remaining,
    requiredBurnHeight: valid ? tx.burnBlockHeight + required : null,
    observedBurnHeight: Number.isSafeInteger(tx.currentBurnBlockHeight) ? tx.currentBurnBlockHeight : null,
    ready: valid && remaining === 0, state: !valid ? "unverified" : remaining === 0 ? "ready" : "confirming",
    estimatedSeconds: remaining === null ? null : remaining * 600,
    estimateIsGuarantee: false as const };
}
