import { Cl, Pc } from "@stacks/transactions";
import type { ClarityValue, PostCondition } from "@stacks/transactions";
import { PerkOSError } from "./errors.js";
import type {
  AppealDecisionInput,
  AssignProviderInput,
  ContractCallPlan,
  ContractId,
  CreateJobInput,
  DecisionSettlementInput,
  FundJobInput,
  JobAmountInput,
  JobDecision,
  PaymentAsset,
  RateProviderInput,
  RecordDecisionInput,
  RegisterAgentInput,
  ResolvedPerkOSConfig,
  ResolveAppealPlanInput,
  SettleJobInput,
  SubmitWorkInput,
  UpdateAgentInput,
} from "./types.js";
import {
  assertAscii,
  assertPrincipal,
  parseContractId,
  toHash32,
  toUint,
} from "./validation.js";

function commerceContract(config: ResolvedPerkOSConfig, asset: PaymentAsset): ContractId {
  return asset === "sbtc" ? config.contracts.sbtcCommerce : config.contracts.stxCommerce;
}

function plan(
  config: ResolvedPerkOSConfig,
  contract: ContractId,
  functionName: string,
  functionArgs: readonly ClarityValue[],
  intent: ContractCallPlan["intent"],
  postConditions: readonly PostCondition[] = []
): ContractCallPlan {
  return {
    type: "contract-call",
    network: config.network,
    contract,
    functionName,
    functionArgs,
    postConditions,
    postConditionMode: "deny",
    intent,
  };
}

function tokenArg(
  config: ResolvedPerkOSConfig,
  tokenContract: ContractId = config.contracts.sbtcToken
): ClarityValue {
  const token = parseContractId(tokenContract, "sbtcToken", config.network);
  return Cl.contractPrincipal(token.address, token.name);
}

function escrowArgs(
  config: ResolvedPerkOSConfig,
  asset: PaymentAsset,
  baseArgs: readonly ClarityValue[],
  sbtcToken?: ContractId
): readonly ClarityValue[] {
  return asset === "sbtc" ? [...baseArgs, tokenArg(config, sbtcToken)] : baseArgs;
}

function exactTransfer(
  config: ResolvedPerkOSConfig,
  asset: PaymentAsset,
  sender: string,
  amount: bigint,
  sbtcToken?: ContractId
): PostCondition {
  if (asset === "stx") {
    return Pc.principal(sender).willSendEq(amount).ustx();
  }
  return Pc.principal(sender)
    .willSendEq(amount)
    .ft(sbtcToken ?? config.contracts.sbtcToken, config.contracts.sbtcAssetName);
}

function deliverableBuffer(value: string | Uint8Array): Uint8Array {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : Uint8Array.from(value);
  if (bytes.length === 0 || bytes.length > 64) {
    throw new PerkOSError(
      "INPUT_INVALID",
      "deliverable must contain between 1 and 64 bytes.",
      { bytes: bytes.length }
    );
  }
  if (typeof value === "string") {
    assertAscii(value, "deliverable", 64);
  }
  return bytes;
}

function decisionCode(decision: JobDecision): bigint {
  return decision === "approve" ? 1n : 2n;
}

export class PerkOSTransactionBuilder {
  readonly config: ResolvedPerkOSConfig;

  constructor(config: ResolvedPerkOSConfig) {
    this.config = config;
  }

  registerAgent(input: RegisterAgentInput): ContractCallPlan {
    assertAscii(input.name, "name", 64);
    assertAscii(input.description, "description", 256);
    assertPrincipal(input.wallet, "wallet", this.config.network);
    const endpoints = input.endpoints ?? [];
    if (endpoints.length > 10) {
      throw new PerkOSError("INPUT_INVALID", "endpoints cannot contain more than 10 entries.");
    }
    const endpointCVs = endpoints.map((endpoint, index) => {
      assertAscii(endpoint.name, `endpoints[${index}].name`, 32);
      assertAscii(endpoint.url, `endpoints[${index}].url`, 128);
      return Cl.tuple({
        name: Cl.stringAscii(endpoint.name),
        url: Cl.stringAscii(endpoint.url),
      });
    });
    return plan(
      this.config,
      this.config.contracts.agentRegistry,
      "register-agent",
      [
        Cl.stringAscii(input.name),
        Cl.stringAscii(input.description),
        Cl.principal(input.wallet),
        Cl.list(endpointCVs),
      ],
      { operation: "register-agent" }
    );
  }

  updateAgent(input: UpdateAgentInput): ContractCallPlan {
    const agentId = toUint(input.agentId, "agentId");
    if (input.name !== undefined) assertAscii(input.name, "name", 64);
    if (input.description !== undefined) assertAscii(input.description, "description", 256);
    if (input.wallet !== undefined) {
      assertPrincipal(input.wallet, "wallet", this.config.network);
    }
    return plan(
      this.config,
      this.config.contracts.agentRegistry,
      "update-agent",
      [
        Cl.uint(agentId),
        input.name === undefined ? Cl.none() : Cl.some(Cl.stringAscii(input.name)),
        input.description === undefined
          ? Cl.none()
          : Cl.some(Cl.stringAscii(input.description)),
        input.wallet === undefined ? Cl.none() : Cl.some(Cl.principal(input.wallet)),
      ],
      { operation: "update-agent" }
    );
  }

  deactivateAgent(agentIdInput: bigint | number | string): ContractCallPlan {
    const agentId = toUint(agentIdInput, "agentId");
    return plan(
      this.config,
      this.config.contracts.agentRegistry,
      "deactivate-agent",
      [Cl.uint(agentId)],
      { operation: "deactivate-agent" }
    );
  }

  createJob(input: CreateJobInput): ContractCallPlan {
    assertPrincipal(input.evaluator, "evaluator", this.config.network);
    if (input.provider) assertPrincipal(input.provider, "provider", this.config.network);
    if (input.provider === input.evaluator) {
      throw new PerkOSError("INPUT_INVALID", "provider and evaluator must be different.");
    }
    assertAscii(input.description, "description", 512);
    const expiredAt = toUint(input.expiredAt, "expiredAt");
    return plan(
      this.config,
      commerceContract(this.config, input.asset),
      "create-job",
      [
        input.provider ? Cl.some(Cl.principal(input.provider)) : Cl.none(),
        Cl.principal(input.evaluator),
        Cl.uint(expiredAt),
        Cl.stringAscii(input.description),
      ],
      { operation: "create-job", asset: input.asset }
    );
  }

  setBudget(input: JobAmountInput): ContractCallPlan {
    const jobId = toUint(input.jobId, "jobId");
    const amount = toUint(input.amount, "amount");
    return plan(
      this.config,
      commerceContract(this.config, input.asset),
      "set-budget",
      [Cl.uint(jobId), Cl.uint(amount)],
      { operation: "set-budget", asset: input.asset, amount, jobId }
    );
  }

  fundJob(input: FundJobInput): ContractCallPlan {
    const jobId = toUint(input.jobId, "jobId");
    const amount = toUint(input.amount, "amount");
    if (!input.sender) {
      throw new PerkOSError(
        "INPUT_INVALID",
        "sender is required to create the exact funding post-condition."
      );
    }
    assertPrincipal(input.sender, "sender", this.config.network);
    const contract = commerceContract(this.config, input.asset);
    return plan(
      this.config,
      contract,
      "fund-job",
      escrowArgs(this.config, input.asset, [Cl.uint(jobId)]),
      {
        operation: "fund-job",
        asset: input.asset,
        amount,
        jobId,
        sender: input.sender,
      },
      [exactTransfer(this.config, input.asset, input.sender, amount)]
    );
  }

  assignProvider(input: AssignProviderInput): ContractCallPlan {
    const jobId = toUint(input.jobId, "jobId");
    assertPrincipal(input.provider, "provider", this.config.network);
    return plan(
      this.config,
      commerceContract(this.config, input.asset),
      "assign-provider",
      [Cl.uint(jobId), Cl.principal(input.provider)],
      {
        operation: "assign-provider",
        asset: input.asset,
        jobId,
        recipient: input.provider,
      }
    );
  }

  submitWork(input: SubmitWorkInput): ContractCallPlan {
    const jobId = toUint(input.jobId, "jobId");
    return plan(
      this.config,
      commerceContract(this.config, input.asset),
      "submit-work",
      [Cl.uint(jobId), Cl.buffer(deliverableBuffer(input.deliverable))],
      { operation: "submit-work", asset: input.asset, jobId }
    );
  }

  completeJob(input: SettleJobInput): ContractCallPlan {
    return this.settlement("complete-job", input);
  }

  rejectJob(input: SettleJobInput): ContractCallPlan {
    return this.settlement("reject-job", input);
  }

  expireJob(input: SettleJobInput): ContractCallPlan {
    return this.settlement("expire-job", input);
  }

  settleReviewTimeout(input: SettleJobInput): ContractCallPlan {
    return this.settlement("settle-review-timeout", input);
  }

  recordDecision(input: RecordDecisionInput): ContractCallPlan {
    const jobId = toUint(input.jobId, "jobId");
    return plan(
      this.config,
      commerceContract(this.config, input.asset),
      "record-decision",
      [
        Cl.uint(jobId),
        Cl.uint(decisionCode(input.decision)),
        Cl.buffer(toHash32(input.evidenceHash, "evidenceHash")),
        Cl.buffer(toHash32(input.explanationHash, "explanationHash")),
      ],
      { operation: "record-decision", asset: input.asset, jobId }
    );
  }

  appealDecision(input: AppealDecisionInput): ContractCallPlan {
    const jobId = toUint(input.jobId, "jobId");
    return plan(
      this.config,
      commerceContract(this.config, input.asset),
      "appeal-decision",
      [
        Cl.uint(jobId),
        Cl.buffer(toHash32(input.evidenceHash, "evidenceHash")),
      ],
      { operation: "appeal-decision", asset: input.asset, jobId }
    );
  }

  finalizeDecision(input: DecisionSettlementInput): ContractCallPlan {
    return this.decisionSettlement("finalize-decision", input, [
      Cl.uint(toUint(input.jobId, "jobId")),
    ]);
  }

  resolveAppeal(input: ResolveAppealPlanInput): ContractCallPlan {
    return this.decisionSettlement("resolve-appeal", input, [
      Cl.uint(toUint(input.jobId, "jobId")),
      Cl.uint(decisionCode(input.decision)),
      Cl.buffer(toHash32(input.resolutionHash, "resolutionHash")),
    ]);
  }

  settleAppealTimeout(input: DecisionSettlementInput): ContractCallPlan {
    return this.decisionSettlement("settle-appeal-timeout", input, [
      Cl.uint(toUint(input.jobId, "jobId")),
    ]);
  }

  retryReputationSync(
    asset: PaymentAsset,
    jobIdInput: bigint | number | string
  ): ContractCallPlan {
    const jobId = toUint(jobIdInput, "jobId");
    return plan(
      this.config,
      commerceContract(this.config, asset),
      "retry-reputation-sync",
      [Cl.uint(jobId)],
      { operation: "retry-reputation-sync", asset, jobId }
    );
  }

  rateProvider(input: RateProviderInput): ContractCallPlan {
    const jobId = toUint(input.jobId, "jobId");
    const score = toUint(input.score, "score");
    if (score > 5n) {
      throw new PerkOSError("INPUT_INVALID", "score must be between 1 and 5.");
    }
    assertAscii(input.comment, "comment", 256, true);
    return plan(
      this.config,
      commerceContract(this.config, input.asset),
      "rate-provider",
      [Cl.uint(jobId), Cl.uint(score), Cl.stringAscii(input.comment)],
      { operation: "rate-provider", asset: input.asset, jobId }
    );
  }

  private decisionSettlement(
    operation: "finalize-decision" | "resolve-appeal" | "settle-appeal-timeout",
    input: DecisionSettlementInput,
    functionArgs: readonly ClarityValue[]
  ): ContractCallPlan {
    const jobId = toUint(input.jobId, "jobId");
    const amount = toUint(input.amount, "amount", true);
    assertPrincipal(input.recipient, "recipient", this.config.network);
    const contract = commerceContract(this.config, input.asset);
    const sbtcToken =
      input.asset === "sbtc"
        ? input.sbtcToken ?? this.config.contracts.sbtcToken
        : undefined;
    if (sbtcToken) parseContractId(sbtcToken, "sbtcToken", this.config.network);
    const postConditions =
      amount > 0n
        ? [exactTransfer(this.config, input.asset, contract, amount, sbtcToken)]
        : [];
    return plan(
      this.config,
      contract,
      operation,
      escrowArgs(this.config, input.asset, functionArgs, sbtcToken),
      {
        operation,
        asset: input.asset,
        amount,
        jobId,
        recipient: input.recipient,
      },
      postConditions
    );
  }

  private settlement(
    operation:
      | "complete-job"
      | "reject-job"
      | "expire-job"
      | "settle-review-timeout",
    input: SettleJobInput
  ): ContractCallPlan {
    const jobId = toUint(input.jobId, "jobId");
    const amount = toUint(input.amount, "amount", true);
    assertPrincipal(input.recipient, "recipient", this.config.network);
    const contract = commerceContract(this.config, input.asset);
    const sbtcToken =
      input.asset === "sbtc"
        ? input.sbtcToken ?? this.config.contracts.sbtcToken
        : undefined;
    if (sbtcToken) parseContractId(sbtcToken, "sbtcToken", this.config.network);
    const postConditions =
      amount > 0n
        ? [exactTransfer(this.config, input.asset, contract, amount, sbtcToken)]
        : [];
    return plan(
      this.config,
      contract,
      operation,
      escrowArgs(this.config, input.asset, [Cl.uint(jobId)], sbtcToken),
      {
        operation,
        asset: input.asset,
        amount,
        jobId,
        recipient: input.recipient,
      },
      postConditions
    );
  }
}
