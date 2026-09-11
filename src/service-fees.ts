import { ClarityType } from "@stacks/transactions";
import type { ClarityValue } from "@stacks/transactions";
import {
  expectBoolean,
  expectPrincipal,
  expectTuple,
  expectUint,
  optionalBuffer,
  unwrapResponse,
} from "./clarity.js";
import { PerkOSError } from "./errors.js";
import {
  assertPrincipal,
  parseContractId,
  toHash32,
  toUint,
} from "./validation.js";
import type {
  AmountLike,
  ContractId,
  JobServiceFeeRecord,
  PaymentAsset,
  PerkOSNetwork,
  ServiceFeePolicy,
  ServiceFeeSplit,
} from "./types.js";

export const SERVICE_FEE_BASIS_POINTS = 200 as const;
const MAX_UINT128 = (1n << 128n) - 1n;

/** Capability detection only. An explicitly configured contract is still a trust boundary. */
export function supportsServiceFees(
  contract: ContractId,
  asset: PaymentAsset
): boolean {
  return (
    parseContractId(contract, "commerce contract").name ===
    (asset === "stx" ? "agentic-commerce-v6" : "sbtc-commerce-v5")
  );
}

export function quoteServiceFee(grossInput: AmountLike): {
  gross: bigint;
  fee: bigint;
  net: bigint;
  basisPoints: 200;
} {
  const gross = toUint(grossInput, "gross", true);
  if (gross > MAX_UINT128)
    throw new PerkOSError("INPUT_INVALID", "gross exceeds Clarity uint128.");
  const fee = gross / 50n;
  return {
    gross,
    fee,
    net: gross - fee,
    basisPoints: SERVICE_FEE_BASIS_POINTS,
  };
}

function principal(
  value: ClarityValue | undefined,
  field: string,
  network: PerkOSNetwork
): string {
  const result = expectPrincipal(value, field);
  if (result.includes(".")) parseContractId(result, field, network);
  else assertPrincipal(result, field, network);
  return result;
}

function basisPoints(value: ClarityValue | undefined): 200 {
  if (expectUint(value, "service fee basis points") !== 200n) {
    throw new PerkOSError(
      "READ_FAILED",
      "Unsupported service fee policy; expected 200 basis points."
    );
  }
  return 200;
}

export function parseServiceFeePolicy(
  cv: ClarityValue,
  network: PerkOSNetwork
): ServiceFeePolicy {
  const t = expectTuple(
    unwrapResponse(cv, "get-protocol-config"),
    "protocol config"
  );
  return {
    configured: expectBoolean(t.configured, "configured"),
    basisPoints: basisPoints(t["service-fee-bps"]),
    treasury: principal(t.treasury, "treasury", network),
    appealAuthority: principal(
      t["appeal-authority"],
      "appeal authority",
      network
    ),
    reviewWindow: expectUint(t["review-window"], "review window"),
    appealWindow: expectUint(t["appeal-window"], "appeal window"),
  };
}

export function parseJobServiceFee(
  cv: ClarityValue,
  jobId: bigint,
  network: PerkOSNetwork
): JobServiceFeeRecord {
  const t = expectTuple(
    unwrapResponse(cv, "get-job-service-fee"),
    "job service fee"
  );
  if (!t.waiver || !t.settlement)
    throw new PerkOSError("READ_FAILED", "Incomplete fee state.");
  const waiver = optionalBuffer(t.waiver, "fee waiver");
  if (waiver !== undefined) toHash32(waiver, "fee waiver");
  const state: JobServiceFeeRecord = {
    jobId,
    basisPoints: basisPoints(t["basis-points"]),
    treasury: principal(t.treasury, "treasury", network),
    feeAmount: expectUint(t["fee-amount"], "potential fee"),
    serviceRecorded: expectBoolean(t["service-recorded"], "service recorded"),
    ...(waiver !== undefined ? { waiver } : {}),
  };
  if (t.settlement.type === ClarityType.OptionalNone) {
    if (waiver && !state.serviceRecorded)
      throw new PerkOSError("READ_FAILED", "Waiver without evaluation.");
    return state;
  }
  if (t.settlement.type !== ClarityType.OptionalSome)
    throw new PerkOSError("READ_FAILED", "Invalid optional fee settlement.");
  const s = expectTuple(t.settlement.value, "fee settlement");
  const settlement = {
    gross: expectUint(s.gross, "gross"),
    recipient: principal(s.recipient, "economic recipient", network),
    net: expectUint(s.net, "net"),
    chargedFee: expectUint(s["charged-fee"], "charged fee"),
    refundedFee: expectUint(s["refunded-fee"], "refunded fee"),
  };
  const expected = quoteServiceFee(settlement.gross);
  if (
    !state.serviceRecorded ||
    settlement.gross === 0n ||
    state.feeAmount !== expected.fee ||
    settlement.recipient === state.treasury ||
    settlement.net + settlement.chargedFee !== settlement.gross ||
    settlement.chargedFee !==
      (waiver && settlement.chargedFee === 0n ? 0n : expected.fee) ||
    settlement.refundedFee > settlement.chargedFee ||
    (settlement.refundedFee !== 0n &&
      (!waiver || settlement.refundedFee !== settlement.chargedFee))
  ) {
    throw new PerkOSError(
      "READ_FAILED",
      "Inconsistent fee settlement accounting."
    );
  }
  return { ...state, settlement };
}

export function validateServiceFeeSplit(
  split: ServiceFeeSplit,
  gross: bigint,
  network: PerkOSNetwork
): void {
  const q = quoteServiceFee(gross);
  if (split.treasury.includes("."))
    parseContractId(split.treasury, "treasury", network);
  else assertPrincipal(split.treasury, "treasury", network);
  const fee = split.waived ? 0n : q.fee;
  if (
    typeof split.waived !== "boolean" ||
    split.basisPoints !== 200 ||
    split.gross !== gross ||
    split.fee !== fee ||
    split.net !== gross - fee
  ) {
    throw new PerkOSError(
      "INPUT_INVALID",
      "Invalid service fee split disclosure."
    );
  }
}
