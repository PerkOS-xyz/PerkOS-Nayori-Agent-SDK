import { describe, it, expect } from "vitest";
import { confirmationProgress, parseConfirmationPolicy } from "../src/confirmation-policy.js";
const txid = "0x" + "a".repeat(64);
const tx = { txid, canonical: true, isUnanchored: false, status: "success", burnBlockHeight: 100, currentBurnBlockHeight: 100 };
describe("operator confirmation policy", () => {
  it("preserves conservative defaults on both networks", () => {
    for (const network of ["mainnet", "testnet"] as const) expect(parseConfirmationPolicy(network)).toEqual({ workflowBurnBlocks: 6, settlementBurnBlocks: 6 });
  });
  it.each([-1, 1.5, NaN, Infinity, 145, "0", null])("rejects invalid count %s", count => {
    expect(() => parseConfirmationPolicy("testnet", { workflowBurnBlocks: count, settlementBurnBlocks: 6 })).toThrow();
  });
  it("rejects unknown fields/network and settlement weaker than workflow", () => {
    expect(() => parseConfirmationPolicy("testnet", { workflowBurnBlocks: 0, settlementBurnBlocks: 6, override: true })).toThrow();
    expect(() => parseConfirmationPolicy("testnet", { workflowBurnBlocks: 6, settlementBurnBlocks: 0 })).toThrow();
    expect(() => parseConfirmationPolicy("other" as "testnet")).toThrow();
  });
  it("does not accept QA fast policy on mainnet", () => {
    expect(() => parseConfirmationPolicy("mainnet", { workflowBurnBlocks: 0, settlementBurnBlocks: 6 })).toThrow();
    expect(parseConfirmationPolicy("mainnet", { workflowBurnBlocks: 6, settlementBurnBlocks: 12 })).toEqual({ workflowBurnBlocks: 6, settlementBurnBlocks: 12 });
  });
  it("accepts canonical QA workflow without additional burn blocks but holds settlement", () => {
    const p = parseConfirmationPolicy("testnet", { workflowBurnBlocks: 0, settlementBurnBlocks: 6 });
    expect(confirmationProgress("testnet", p, "workflow", txid, tx).ready).toBe(true);
    expect(confirmationProgress("testnet", p, "settlement", txid, tx)).toMatchObject({ ready: false, remainingBurnBlocks: 6, requiredBurnHeight: 106, estimatedSeconds: 3600, estimateIsGuarantee: false });
    expect(confirmationProgress("testnet", p, "settlement", txid, { ...tx, currentBurnBlockHeight: 106 }).ready).toBe(true);
  });
  it.each([{ canonical: false }, { isUnanchored: true }, { status: "pending" }, { status: "abort_by_response" },
    { txid: "0x" + "b".repeat(64) }, { burnBlockHeight: 0 }, { burnBlockHeight: NaN }, { currentBurnBlockHeight: 99 }])("fails closed on %j even in fast QA", change => {
    expect(confirmationProgress("testnet", { workflowBurnBlocks: 0, settlementBurnBlocks: 6 }, "workflow", txid, { ...tx, ...change })).toMatchObject({ ready: false, remainingBurnBlocks: null, estimatedSeconds: null });
  });
});
