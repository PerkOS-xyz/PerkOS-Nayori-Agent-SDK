import { Cl, Pc } from "@stacks/transactions";
import type { ClarityValue, PostCondition } from "@stacks/transactions";
import { deliverableBuffer } from "../builders.js";
import { PerkOSError } from "../errors.js";
import type {
  AmountLike,
  ContractCallPlan,
  ContractId,
  Hash32Input,
  JobDecision,
  PaymentAsset,
  TransactionIntent,
} from "../types.js";
import {
  assertAscii,
  assertPrincipal,
  parseContractId,
  toHash32,
  toUint,
} from "../validation.js";
import { assertNayoriNextDeployed } from "./config.js";
import {
  NAYORI_NEXT_DECISION,
  NAYORI_NEXT_LIMITS,
  NAYORI_NEXT_ROLE_CODES,
} from "./constants.js";
import type {
  NayoriNextAgentInput,
  NayoriNextAllowanceTarget,
  NayoriNextAllowCallerInput,
  NayoriNextAppealInput,
  NayoriNextApplicationRefundInput,
  NayoriNextApplyInput,
  NayoriNextCreateJobInput,
  NayoriNextDisallowCallerInput,
  NayoriNextFundJobInput,
  NayoriNextHandoverInput,
  NayoriNextJobRef,
  NayoriNextNameProviderInput,
  NayoriNextPayoutInput,
  NayoriNextRateProviderInput,
  NayoriNextRecordDecisionInput,
  NayoriNextResolveAppealInput,
  NayoriNextRole,
  NayoriNextSubmitWorkInput,
  ResolvedNayoriNextConfig,
} from "./types.js";

/** Input that a contract would reject: the error names the contract code it would return. */
function rejected(message: string, clarityCode: bigint, field?: string): PerkOSError {
  return new PerkOSError("INPUT_INVALID", message, {
    clarityCode,
    ...(field ? { field } : {}),
  });
}

function inRange(
  value: AmountLike,
  field: string,
  bounds: { readonly min: bigint; readonly max: bigint },
  clarityCode: bigint
): bigint {
  const parsed = toUint(value, field, true);
  if (parsed < bounds.min || parsed > bounds.max) {
    throw rejected(
      `${field} must be between ${bounds.min} and ${bounds.max}.`,
      clarityCode,
      field
    );
  }
  return parsed;
}

function hashArg(value: Hash32Input, field: string): ClarityValue {
  try {
    return Cl.buffer(toHash32(value, field));
  } catch (cause) {
    if (cause instanceof PerkOSError) {
      throw new PerkOSError("INPUT_INVALID", cause.message, {
        ...cause.details,
        clarityCode: 312n,
      });
    }
    throw cause;
  }
}

function decisionArg(decision: JobDecision): ClarityValue {
  const code = NAYORI_NEXT_DECISION[decision];
  if (code === undefined) {
    throw rejected('decision must be "approve" or "reject".', 311n, "decision");
  }
  return Cl.uint(code);
}

function roleArg(role: NayoriNextRole): ClarityValue {
  const code = NAYORI_NEXT_ROLE_CODES[role];
  if (code === undefined) {
    throw rejected('role must be "treasury" or "appeal-authority".', 100n, "role");
  }
  return Cl.uint(code);
}

function assertAsset(asset: PaymentAsset): void {
  if (asset !== "sbtc" && asset !== "stx") {
    throw new PerkOSError("INPUT_INVALID", 'asset must be "sbtc" or "stx".');
  }
}

/**
 * Transaction plans for the next Nayori contracts. Every plan uses
 * post-condition mode deny: funding binds the payer to the exact amount, and
 * every contract payout binds the contract principal to its exact outflow.
 */
export class NayoriNextTransactionBuilder {
  readonly config: ResolvedNayoriNextConfig;

  constructor(config: ResolvedNayoriNextConfig) {
    this.config = config;
  }

  escrowContract(asset: PaymentAsset): ContractId {
    assertAsset(asset);
    return asset === "sbtc"
      ? this.config.contracts.escrowSbtc
      : this.config.contracts.escrowStx;
  }

  // ---------------------------------------------------------------- escrow

  createJob(input: NayoriNextCreateJobInput): ContractCallPlan {
    const contract = this.escrowContract(input.asset);
    assertPrincipal(input.evaluator, "evaluator", this.config.network);
    if (input.client !== undefined) {
      assertPrincipal(input.client, "client", this.config.network);
      if (input.client === input.evaluator) {
        throw rejected("client and evaluator must be different.", 307n, "evaluator");
      }
    }
    const budget = inRange(
      input.budget,
      "budget",
      NAYORI_NEXT_LIMITS.budget[input.asset],
      308n
    );
    const deliveryBlocks = inRange(
      input.deliveryBlocks,
      "deliveryBlocks",
      NAYORI_NEXT_LIMITS.deliveryBlocks,
      309n
    );
    const reviewBlocks = inRange(
      input.reviewBlocks,
      "reviewBlocks",
      NAYORI_NEXT_LIMITS.reviewBlocks,
      309n
    );
    if (input.description.length === 0) {
      throw rejected("description must not be empty.", 310n, "description");
    }
    assertAscii(input.description, "description", NAYORI_NEXT_LIMITS.descriptionBytes);
    return this.plan(
      contract,
      "create-job",
      [
        Cl.principal(input.evaluator),
        Cl.uint(budget),
        Cl.uint(deliveryBlocks),
        Cl.uint(reviewBlocks),
        Cl.stringAscii(input.description),
      ],
      {
        operation: "create-job",
        asset: input.asset,
        ...(input.client ? { sender: input.client } : {}),
      }
    );
  }

  /** The client moves exactly the job budget into escrow. */
  fundJob(input: NayoriNextFundJobInput): ContractCallPlan {
    const contract = this.escrowContract(input.asset);
    const jobId = toUint(input.jobId, "jobId");
    const budget = inRange(
      input.budget,
      "budget",
      NAYORI_NEXT_LIMITS.budget[input.asset],
      308n
    );
    assertPrincipal(input.sender, "sender", this.config.network);
    return this.plan(
      contract,
      "fund-job",
      [Cl.uint(jobId)],
      {
        operation: "fund-job",
        asset: input.asset,
        amount: budget,
        jobId,
        sender: input.sender,
      },
      [this.transfer(input.asset, input.sender, budget, "eq")]
    );
  }

  /** The client offers the job to a provider; it can change the offer until acceptance. */
  nameProvider(input: NayoriNextNameProviderInput): ContractCallPlan {
    const contract = this.escrowContract(input.asset);
    const jobId = toUint(input.jobId, "jobId");
    assertPrincipal(input.provider, "provider", this.config.network);
    if (input.parties?.includes(input.provider)) {
      throw rejected(
        "provider cannot be the client, evaluator, treasury or appeal authority.",
        307n,
        "provider"
      );
    }
    return this.plan(
      contract,
      "name-provider",
      [Cl.uint(jobId), Cl.principal(input.provider)],
      {
        operation: "name-provider",
        asset: input.asset,
        jobId,
        recipient: input.provider,
      }
    );
  }

  acceptJob(input: NayoriNextJobRef): ContractCallPlan {
    return this.jobCall(input, "accept-job", "accept-job");
  }

  submitWork(input: NayoriNextSubmitWorkInput): ContractCallPlan {
    const contract = this.escrowContract(input.asset);
    const jobId = toUint(input.jobId, "jobId");
    return this.plan(
      contract,
      "submit-work",
      [Cl.uint(jobId), Cl.buffer(deliverableBuffer(input.deliverable))],
      { operation: "submit-work", asset: input.asset, jobId }
    );
  }

  recordDecision(input: NayoriNextRecordDecisionInput): ContractCallPlan {
    const contract = this.escrowContract(input.asset);
    const jobId = toUint(input.jobId, "jobId");
    return this.plan(
      contract,
      "record-decision",
      [
        Cl.uint(jobId),
        decisionArg(input.decision),
        hashArg(input.evidenceHash, "evidenceHash"),
      ],
      { operation: "record-decision", asset: input.asset, jobId }
    );
  }

  /** Anyone, after the review window passes without a decision. */
  recordDefaultApproval(input: NayoriNextJobRef): ContractCallPlan {
    return this.jobCall(input, "record-default-approval", "record-default-approval");
  }

  /** The losing party: the client against an approval, the provider against a rejection. */
  appeal(input: NayoriNextAppealInput): ContractCallPlan {
    const contract = this.escrowContract(input.asset);
    const jobId = toUint(input.jobId, "jobId");
    return this.plan(
      contract,
      "appeal",
      [Cl.uint(jobId), hashArg(input.evidenceHash, "evidenceHash")],
      { operation: "appeal", asset: input.asset, jobId }
    );
  }

  /** The job's appeal authority; settles in the same call (escrow pays out the budget). */
  resolveAppeal(input: NayoriNextResolveAppealInput): ContractCallPlan {
    return this.payout(input, "resolve-appeal", "resolve-appeal", [
      decisionArg(input.decision),
      hashArg(input.resolutionHash, "resolutionHash"),
    ]);
  }

  /** Anyone, after the appeal or resolution window; the escrow pays out the budget. */
  settleJob(input: NayoriNextPayoutInput): ContractCallPlan {
    return this.payout(input, "settle-job", "settle-job");
  }

  /** Anyone, after the deadline and before submission; the full budget goes back to the client. */
  refundNoDelivery(input: NayoriNextPayoutInput): ContractCallPlan {
    return this.payout(input, "refund-no-delivery", "refund-no-delivery");
  }

  /** Anyone, for an unfunded job past its deadline. No funds move. */
  closeUnfunded(input: NayoriNextJobRef): ContractCallPlan {
    return this.jobCall(input, "close-unfunded", "close-unfunded");
  }

  /** The client of a completed job, once. */
  rateProvider(input: NayoriNextRateProviderInput): ContractCallPlan {
    const contract = this.escrowContract(input.asset);
    const jobId = toUint(input.jobId, "jobId");
    const score = inRange(input.score, "score", NAYORI_NEXT_LIMITS.rating, 205n);
    return this.plan(
      contract,
      "rate-provider",
      [Cl.uint(jobId), Cl.uint(score)],
      { operation: "rate-provider", asset: input.asset, jobId }
    );
  }

  /** Anyone; replays an outcome the reputation registry did not take at settlement. */
  retryReputation(input: NayoriNextJobRef): ContractCallPlan {
    return this.jobCall(input, "retry-reputation", "retry-reputation");
  }

  // ---------------------------------------------------------------- permissions

  /** Must be called directly by the party (not through a contract). */
  allowContractCaller(input: NayoriNextAllowCallerInput): ContractCallPlan {
    const caller = this.contractArg(input.caller, "caller");
    const target = this.targetArg(input.target);
    const until =
      input.until === undefined ? undefined : toUint(input.until, "until");
    return this.plan(
      this.config.contracts.permissions,
      "allow-contract-caller",
      [caller, target, until === undefined ? Cl.none() : Cl.some(Cl.uint(until))],
      { operation: "allow-contract-caller" }
    );
  }

  disallowContractCaller(input: NayoriNextDisallowCallerInput): ContractCallPlan {
    return this.plan(
      this.config.contracts.permissions,
      "disallow-contract-caller",
      [this.contractArg(input.caller, "caller"), this.targetArg(input.target)],
      { operation: "disallow-contract-caller" }
    );
  }

  // ---------------------------------------------------------------- roles

  /** The current holder proposes a successor; it can accept after 144 Bitcoin blocks. */
  proposeHandover(input: NayoriNextHandoverInput): ContractCallPlan {
    assertPrincipal(input.candidate, "candidate", this.config.network);
    return this.plan(
      this.config.contracts.roles,
      "propose-handover",
      [roleArg(input.role), Cl.principal(input.candidate)],
      { operation: "propose-handover", recipient: input.candidate }
    );
  }

  cancelHandover(role: NayoriNextRole): ContractCallPlan {
    return this.plan(
      this.config.contracts.roles,
      "cancel-handover",
      [roleArg(role)],
      { operation: "cancel-handover" }
    );
  }

  acceptHandover(role: NayoriNextRole): ContractCallPlan {
    return this.plan(
      this.config.contracts.roles,
      "accept-handover",
      [roleArg(role)],
      { operation: "accept-handover" }
    );
  }

  // ---------------------------------------------------------------- agents

  /** Registers the signing wallet as an agent (one per wallet). */
  registerAgent(input: NayoriNextAgentInput): ContractCallPlan {
    return this.agentCall("register", "register-agent", input);
  }

  updateAgent(input: NayoriNextAgentInput): ContractCallPlan {
    return this.agentCall("update", "update-agent", input);
  }

  // ---------------------------------------------------------------- applications

  /**
   * A registered agent applies to an open sBTC job with a deposit. The
   * applicant sends exactly the deposit. On a full list the contract refunds
   * the lowest entry in the same call; that entry is always strictly below the
   * new deposit, so the contract outflow is bounded by the deposit (D10).
   */
  applyToJob(input: NayoriNextApplyInput): ContractCallPlan {
    const jobId = toUint(input.jobId, "jobId");
    const deposit = inRange(
      input.deposit,
      "deposit",
      NAYORI_NEXT_LIMITS.applicationDeposit,
      605n
    );
    assertPrincipal(input.sender, "sender", this.config.network);
    return this.plan(
      this.config.contracts.applications,
      "apply-to-job",
      [Cl.uint(jobId), Cl.uint(deposit)],
      {
        operation: "apply-to-job",
        asset: "sbtc",
        amount: deposit,
        jobId,
        sender: input.sender,
      },
      [
        this.transfer("sbtc", input.sender, deposit, "eq"),
        this.transfer("sbtc", this.config.contracts.applications, deposit, "lte"),
      ]
    );
  }

  /** The applicant takes its deposit back. */
  withdrawApplication(input: NayoriNextApplicationRefundInput): ContractCallPlan {
    return this.applicationRefund(input, "withdraw", "withdraw-application", false);
  }

  /** The client declines an applicant, who cannot reapply to the job; the deposit is refunded. */
  declineApplication(input: NayoriNextApplicationRefundInput): ContractCallPlan {
    return this.applicationRefund(input, "decline", "decline-application", true);
  }

  /** Anyone, once the job stops taking applications; the deposit is refunded. */
  releaseApplication(input: NayoriNextApplicationRefundInput): ContractCallPlan {
    return this.applicationRefund(input, "release", "release-application", true);
  }

  // ---------------------------------------------------------------- helpers

  private plan(
    contract: ContractId,
    functionName: string,
    functionArgs: readonly ClarityValue[],
    intent: TransactionIntent,
    postConditions: readonly PostCondition[] = []
  ): ContractCallPlan {
    assertNayoriNextDeployed(this.config);
    return {
      type: "contract-call",
      network: this.config.network,
      contract,
      functionName,
      functionArgs,
      postConditions,
      postConditionMode: "deny",
      intent,
    };
  }

  private transfer(
    asset: PaymentAsset,
    principal: string,
    amount: bigint,
    condition: "eq" | "lte"
  ): PostCondition {
    const from = Pc.principal(principal);
    const sends = condition === "eq" ? from.willSendEq(amount) : from.willSendLte(amount);
    return asset === "stx"
      ? sends.ustx()
      : sends.ft(this.config.contracts.sbtcToken, this.config.contracts.sbtcAssetName);
  }

  private jobCall(
    input: NayoriNextJobRef,
    functionName: string,
    operation: TransactionIntent["operation"]
  ): ContractCallPlan {
    const contract = this.escrowContract(input.asset);
    const jobId = toUint(input.jobId, "jobId");
    return this.plan(contract, functionName, [Cl.uint(jobId)], {
      operation,
      asset: input.asset,
      jobId,
    });
  }

  private payout(
    input: NayoriNextPayoutInput,
    functionName: string,
    operation: TransactionIntent["operation"],
    extraArgs: readonly ClarityValue[] = []
  ): ContractCallPlan {
    const contract = this.escrowContract(input.asset);
    const jobId = toUint(input.jobId, "jobId");
    const budget = inRange(
      input.budget,
      "budget",
      NAYORI_NEXT_LIMITS.budget[input.asset],
      308n
    );
    if (input.recipient !== undefined) {
      assertPrincipal(input.recipient, "recipient", this.config.network);
    }
    return this.plan(
      contract,
      functionName,
      [Cl.uint(jobId), ...extraArgs],
      {
        operation,
        asset: input.asset,
        amount: budget,
        jobId,
        ...(input.recipient ? { recipient: input.recipient } : {}),
      },
      [this.transfer(input.asset, contract, budget, "eq")]
    );
  }

  private agentCall(
    functionName: "register" | "update",
    operation: "register-agent" | "update-agent",
    input: NayoriNextAgentInput
  ): ContractCallPlan {
    if (input.name.length === 0) {
      throw rejected("name must not be empty.", 503n, "name");
    }
    assertAscii(input.name, "name", NAYORI_NEXT_LIMITS.agentNameBytes);
    assertAscii(input.uri, "uri", NAYORI_NEXT_LIMITS.agentUriBytes, true);
    return this.plan(
      this.config.contracts.agents,
      functionName,
      [Cl.stringAscii(input.name), Cl.stringAscii(input.uri)],
      { operation }
    );
  }

  private applicationRefund(
    input: NayoriNextApplicationRefundInput,
    functionName: "withdraw" | "decline" | "release",
    operation: "withdraw-application" | "decline-application" | "release-application",
    applicantArg: boolean
  ): ContractCallPlan {
    const jobId = toUint(input.jobId, "jobId");
    assertPrincipal(input.applicant, "applicant", this.config.network);
    const deposit = inRange(
      input.deposit,
      "deposit",
      NAYORI_NEXT_LIMITS.applicationDeposit,
      605n
    );
    const contract = this.config.contracts.applications;
    return this.plan(
      contract,
      functionName,
      applicantArg
        ? [Cl.uint(jobId), Cl.principal(input.applicant)]
        : [Cl.uint(jobId)],
      {
        operation,
        asset: "sbtc",
        amount: deposit,
        jobId,
        recipient: input.applicant,
        ...(applicantArg ? {} : { sender: input.applicant }),
      },
      [this.transfer("sbtc", contract, deposit, "eq")]
    );
  }

  private contractArg(value: ContractId, field: string): ClarityValue {
    let parsed: { address: string; name: string };
    try {
      parsed = parseContractId(value, field, this.config.network);
    } catch (cause) {
      throw new PerkOSError(
        "INPUT_INVALID",
        `${field} must be a contract id on Stacks ${this.config.network}.`,
        { field, cause }
      );
    }
    return Cl.contractPrincipal(parsed.address, parsed.name);
  }

  private targetArg(target: NayoriNextAllowanceTarget): ClarityValue {
    const contracts = this.config.contracts;
    const resolved =
      target === "escrowSbtc" ||
      target === "escrowStx" ||
      target === "agents" ||
      target === "applications"
        ? contracts[target]
        : target;
    return this.contractArg(resolved, "target");
  }
}
