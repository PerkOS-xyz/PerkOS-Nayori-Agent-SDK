import { ClarityType } from "@stacks/transactions";
import type { ClarityValue, SomeCV } from "@stacks/transactions";
import {
  expectBoolean,
  expectBuffer,
  expectList,
  expectPrincipal,
  expectString,
  expectTuple,
  expectUint,
  optionalPrincipal,
  optionalUint,
} from "../clarity.js";
import { PerkOSError } from "../errors.js";
import type { JobDecision, PaymentAsset } from "../types.js";
import { NAYORI_NEXT_JOB_STATUS } from "./constants.js";
import type {
  NayoriNextAgent,
  NayoriNextAllowance,
  NayoriNextApplication,
  NayoriNextDecision,
  NayoriNextHandover,
  NayoriNextJob,
  NayoriNextJobStatus,
  NayoriNextOutcome,
  NayoriNextProviderStats,
  NayoriNextReputationPending,
  NayoriNextRole,
  NayoriNextSubmission,
} from "./types.js";

/** Unwraps a Clarity optional: `none` is null, `some` its value. */
export function optionalValue(value: ClarityValue, context: string): ClarityValue | null {
  if (value.type === ClarityType.OptionalNone) return null;
  if (value.type === ClarityType.OptionalSome) return (value as SomeCV<ClarityValue>).value;
  throw new PerkOSError("READ_FAILED", `${context} must be a Clarity optional.`);
}

export function nayoriNextJobStatus(code: bigint): NayoriNextJobStatus {
  const status = NAYORI_NEXT_JOB_STATUS[Number(code)];
  if (!status) {
    throw new PerkOSError("READ_FAILED", `Unknown next-generation job status ${code}.`);
  }
  return status;
}

function decisionFromCode(code: bigint, context: string): JobDecision {
  if (code === 1n) return "approve";
  if (code === 2n) return "reject";
  throw new PerkOSError("READ_FAILED", `${context} contains unknown decision ${code}.`);
}

/** `get-job` of nayori-escrow-sbtc / nayori-escrow-stx. */
export function parseNayoriNextJob(
  value: ClarityValue,
  asset: PaymentAsset,
  jobId: bigint
): NayoriNextJob | null {
  const inner = optionalValue(value, "get-job");
  if (!inner) return null;
  const tuple = expectTuple(inner, "get-job");
  const statusCode = expectUint(tuple.status, "job.status");
  const provider = optionalPrincipal(tuple.provider, "job.provider");
  return {
    id: jobId,
    asset,
    client: expectPrincipal(tuple.client, "job.client"),
    evaluator: expectPrincipal(tuple.evaluator, "job.evaluator"),
    ...(provider ? { provider } : {}),
    treasury: expectPrincipal(tuple.treasury, "job.treasury"),
    appealAuthority: expectPrincipal(tuple["appeal-authority"], "job.appeal-authority"),
    budget: expectUint(tuple.budget, "job.budget"),
    description: expectString(tuple.description, "job.description"),
    deliveryDeadline: expectUint(tuple["delivery-deadline"], "job.delivery-deadline"),
    deliveryBlocks: expectUint(tuple["delivery-blocks"], "job.delivery-blocks"),
    reviewBlocks: expectUint(tuple["review-blocks"], "job.review-blocks"),
    status: nayoriNextJobStatus(statusCode),
    statusCode,
  };
}

/** `get-submission`. */
export function parseNayoriNextSubmission(
  value: ClarityValue,
  jobId: bigint
): NayoriNextSubmission | null {
  const inner = optionalValue(value, "get-submission");
  if (!inner) return null;
  const tuple = expectTuple(inner, "get-submission");
  return {
    jobId,
    deliverable: expectBuffer(tuple.deliverable, "submission.deliverable"),
    reviewDeadline: expectUint(tuple["review-deadline"], "submission.review-deadline"),
  };
}

/** `get-decision`. */
export function parseNayoriNextDecision(
  value: ClarityValue,
  jobId: bigint
): NayoriNextDecision | null {
  const inner = optionalValue(value, "get-decision");
  if (!inner) return null;
  const tuple = expectTuple(inner, "get-decision");
  const appellant = optionalPrincipal(tuple.appellant, "decision.appellant");
  const resolutionDeadline = optionalUint(
    tuple["resolution-deadline"],
    "decision.resolution-deadline"
  );
  return {
    jobId,
    decision: decisionFromCode(expectUint(tuple.decision, "decision.decision"), "decision.decision"),
    byDefault: expectBoolean(tuple["by-default"], "decision.by-default"),
    evidenceHash: expectBuffer(tuple["evidence-hash"], "decision.evidence-hash"),
    appealDeadline: expectUint(tuple["appeal-deadline"], "decision.appeal-deadline"),
    ...(appellant ? { appellant } : {}),
    ...(resolutionDeadline !== undefined ? { resolutionDeadline } : {}),
  };
}

/** `get-reputation-pending` of an escrow. */
export function parseNayoriNextReputationPending(
  value: ClarityValue,
  asset: PaymentAsset,
  jobId: bigint
): NayoriNextReputationPending | null {
  const inner = optionalValue(value, "get-reputation-pending");
  if (!inner) return null;
  const tuple = expectTuple(inner, "get-reputation-pending");
  return {
    jobId,
    asset,
    provider: expectPrincipal(tuple.provider, "pending.provider"),
    client: expectPrincipal(tuple.client, "pending.client"),
    completed: expectBoolean(tuple.completed, "pending.completed"),
    value: expectUint(tuple.value, "pending.value"),
  };
}

/** `get-outcome` of nayori-reputation. */
export function parseNayoriNextOutcome(
  value: ClarityValue,
  asset: PaymentAsset,
  jobId: bigint
): NayoriNextOutcome | null {
  const inner = optionalValue(value, "get-outcome");
  if (!inner) return null;
  const tuple = expectTuple(inner, "get-outcome");
  return {
    jobId,
    asset,
    provider: expectPrincipal(tuple.provider, "outcome.provider"),
    client: expectPrincipal(tuple.client, "outcome.client"),
    completed: expectBoolean(tuple.completed, "outcome.completed"),
    value: expectUint(tuple.value, "outcome.value"),
    rated: expectBoolean(tuple.rated, "outcome.rated"),
  };
}

/** `get-provider-stats` of nayori-reputation (never none; empty stats are zeros). */
export function parseNayoriNextProviderStats(
  value: ClarityValue,
  provider: string
): NayoriNextProviderStats {
  const tuple = expectTuple(value, "get-provider-stats");
  return {
    provider,
    completed: expectUint(tuple.completed, "stats.completed"),
    rejected: expectUint(tuple.rejected, "stats.rejected"),
    notDelivered: expectUint(tuple["not-delivered"], "stats.not-delivered"),
    completedValueSbtc: expectUint(tuple["completed-value-sbtc"], "stats.completed-value-sbtc"),
    completedValueStx: expectUint(tuple["completed-value-stx"], "stats.completed-value-stx"),
    distinctClients: expectUint(tuple["distinct-clients"], "stats.distinct-clients"),
    ratingSum: expectUint(tuple["rating-sum"], "stats.rating-sum"),
    ratingCount: expectUint(tuple["rating-count"], "stats.rating-count"),
  };
}

/** `get-agent` of nayori-agents. */
export function parseNayoriNextAgent(
  value: ClarityValue,
  wallet: string
): NayoriNextAgent | null {
  const inner = optionalValue(value, "get-agent");
  if (!inner) return null;
  const tuple = expectTuple(inner, "get-agent");
  return {
    wallet,
    name: expectString(tuple.name, "agent.name"),
    uri: expectString(tuple.uri, "agent.uri"),
    registeredAt: expectUint(tuple["registered-at"], "agent.registered-at"),
  };
}

function parseApplicationEntry(value: ClarityValue, context: string): NayoriNextApplication {
  const tuple = expectTuple(value, context);
  return {
    applicant: expectPrincipal(tuple.applicant, `${context}.applicant`),
    deposit: expectUint(tuple.deposit, `${context}.deposit`),
  };
}

/** `get-applications`: sorted by deposit, highest first, ties by arrival. */
export function parseNayoriNextApplications(value: ClarityValue): NayoriNextApplication[] {
  return expectList(value, "get-applications").map((entry, index) =>
    parseApplicationEntry(entry, `applications[${index}]`)
  );
}

/** `get-application`. */
export function parseNayoriNextApplication(value: ClarityValue): NayoriNextApplication | null {
  const inner = optionalValue(value, "get-application");
  return inner ? parseApplicationEntry(inner, "application") : null;
}

/** `get-handover` of nayori-roles. */
export function parseNayoriNextHandover(
  value: ClarityValue,
  role: NayoriNextRole
): NayoriNextHandover | null {
  const inner = optionalValue(value, "get-handover");
  if (!inner) return null;
  const tuple = expectTuple(inner, "get-handover");
  return {
    role,
    candidate: expectPrincipal(tuple.candidate, "handover.candidate"),
    readyAt: expectUint(tuple["ready-at"], "handover.ready-at"),
  };
}

/** `get-allowance` of nayori-permissions: none means no allowance; `until` none means no expiry. */
export function parseNayoriNextAllowance(value: ClarityValue): NayoriNextAllowance | null {
  const inner = optionalValue(value, "get-allowance");
  if (!inner) return null;
  const until = optionalUint(inner, "allowance.until");
  return until === undefined ? {} : { until };
}
