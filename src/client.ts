import { Cl, fetchCallReadOnlyFunction } from "@stacks/transactions";
import type { ClarityValue } from "@stacks/transactions";
import { JOB_STATUS } from "./constants.js";
import {
  expectBoolean,
  expectList,
  expectPrincipal,
  expectString,
  expectTuple,
  expectUint,
  optionalBuffer,
  optionalPrincipal,
  unwrapResponse,
} from "./clarity.js";
import { PerkOSError } from "./errors.js";
import { PerkOSTransactionBuilder } from "./builders.js";
import { SpendingPolicy } from "./policy.js";
import { TransactionTracker } from "./tracker.js";
import { normalizeTxid } from "./txid.js";
import type {
  AgentRecord,
  AssignProviderInput,
  ConfirmationOptions,
  ConfirmedTransactionReceipt,
  ContractCallPlan,
  ContractId,
  CreateJobInput,
  FundJobInput,
  JobAmountInput,
  JobRecord,
  PaymentAsset,
  PerkOSConfig,
  RateProviderInput,
  ReadOnlyCall,
  ReadOnlyTransport,
  RegisterAgentInput,
  ReputationRecord,
  SettleJobInput,
  SpendingApproval,
  SubmitWorkInput,
  TransactionConfirmation,
  TransactionReceipt,
  TransactionTrackerLike,
  UpdateAgentInput,
} from "./types.js";
import { assertPrincipal, parseContractId, resolveConfig, toUint } from "./validation.js";

function contractForAsset(
  contracts: { stxCommerce: ContractId; sbtcCommerce: ContractId },
  asset: PaymentAsset
): ContractId {
  return asset === "sbtc" ? contracts.sbtcCommerce : contracts.stxCommerce;
}

async function defaultReadOnlyTransport(call: ReadOnlyCall): Promise<ClarityValue> {
  const { address, name } = parseContractId(call.contract, "contract", call.network);
  return fetchCallReadOnlyFunction({
    contractAddress: address,
    contractName: name,
    functionName: call.functionName,
    functionArgs: [...call.functionArgs],
    senderAddress: call.senderAddress,
    network: call.network,
    ...(call.apiUrl ? { client: { baseUrl: call.apiUrl } } : {}),
  });
}

export class PerkOSClient {
  readonly config;
  readonly transactions: PerkOSTransactionBuilder;
  readonly policy: SpendingPolicy;
  readonly tracker: TransactionTrackerLike;
  private readonly signer;
  private readonly readOnlyTransport: ReadOnlyTransport;

  constructor(input: PerkOSConfig) {
    this.config = resolveConfig(input);
    this.transactions = new PerkOSTransactionBuilder(this.config);
    this.policy = new SpendingPolicy(this.config, input.spendingPolicy);
    this.signer = input.signer;
    this.readOnlyTransport = input.readOnlyTransport ?? defaultReadOnlyTransport;
    this.tracker =
      input.transactionTracker ??
      new TransactionTracker({
        network: this.config.network,
        ...(this.config.apiUrl ? { apiUrl: this.config.apiUrl } : {}),
      });
  }

  preview(plan: ContractCallPlan): SpendingApproval {
    return this.policy.authorize(plan);
  }

  async execute(plan: ContractCallPlan): Promise<TransactionReceipt> {
    if (plan.network !== this.config.network) {
      throw new PerkOSError(
        "POLICY_DENIED",
        `Plan network ${plan.network} does not match client network ${this.config.network}.`
      );
    }
    if (!this.signer) {
      throw new PerkOSError(
        "SIGNER_REQUIRED",
        "A signer is required to execute transaction plans."
      );
    }

    this.policy.authorize(plan);
    const signerAddress = await this.signer.getAddress();
    assertPrincipal(signerAddress, "signer address", this.config.network);
    if (plan.intent.sender && signerAddress !== plan.intent.sender) {
      throw new PerkOSError(
        "SIGNER_MISMATCH",
        `Funding plan expects ${plan.intent.sender}, but the signer controls ${signerAddress}.`
      );
    }

    try {
      const result = await this.signer.signAndBroadcast(plan);
      const txid = normalizeTxid(result.txid);
      this.policy.record(plan);
      return {
        txid,
        status: "broadcast",
        network: plan.network,
        contract: plan.contract,
        operation: plan.intent.operation,
        ...(plan.intent.asset ? { asset: plan.intent.asset } : {}),
        ...(plan.intent.amount !== undefined ? { amount: plan.intent.amount } : {}),
        ...(plan.intent.jobId !== undefined ? { jobId: plan.intent.jobId } : {}),
        explorerUrl: `https://explorer.hiro.so/txid/${txid}?chain=${plan.network}`,
        ...(result.raw !== undefined ? { raw: result.raw } : {}),
      };
    } catch (cause) {
      if (cause instanceof PerkOSError) throw cause;
      throw new PerkOSError("SIGNING_FAILED", "The signer could not broadcast the transaction.", {
        cause,
        contract: plan.contract,
        functionName: plan.functionName,
      });
    }
  }

  async confirm(
    receiptOrTxid: TransactionReceipt | string,
    options: ConfirmationOptions = {}
  ): Promise<TransactionConfirmation> {
    if (
      typeof receiptOrTxid !== "string" &&
      receiptOrTxid.network !== this.config.network
    ) {
      throw new PerkOSError(
        "POLICY_DENIED",
        `Receipt network ${receiptOrTxid.network} does not match client network ${this.config.network}.`
      );
    }
    const txid =
      typeof receiptOrTxid === "string" ? receiptOrTxid : receiptOrTxid.txid;
    return this.tracker.waitForConfirmation(txid, options);
  }

  async executeAndConfirm(
    plan: ContractCallPlan,
    options: ConfirmationOptions = {}
  ): Promise<ConfirmedTransactionReceipt> {
    const broadcast = await this.execute(plan);
    const confirmation = await this.confirm(broadcast, options);
    return { broadcast, confirmation };
  }

  async getAgentCount(): Promise<bigint> {
    const value = unwrapResponse(
      await this.read(this.config.contracts.agentRegistry, "get-agent-count"),
      "get-agent-count"
    );
    return expectUint(value, "get-agent-count");
  }

  async getAgent(agentIdInput: bigint | number | string): Promise<AgentRecord | null> {
    const agentId = toUint(agentIdInput, "agentId");
    try {
      const value = unwrapResponse(
        await this.read(this.config.contracts.agentRegistry, "get-agent", [Cl.uint(agentId)]),
        "get-agent"
      );
      const tuple = expectTuple(value, "get-agent");
      const endpoints = expectList(tuple.endpoints!, "agent.endpoints").map((endpoint, index) => {
        const endpointTuple = expectTuple(endpoint, `agent.endpoints[${index}]`);
        return {
          name: expectString(endpointTuple.name, `agent.endpoints[${index}].name`),
          url: expectString(endpointTuple.url, `agent.endpoints[${index}].url`),
        };
      });
      return {
        id: agentId,
        name: expectString(tuple.name, "agent.name"),
        description: expectString(tuple.description, "agent.description"),
        creator: expectPrincipal(tuple.creator, "agent.creator"),
        wallet: expectPrincipal(tuple.wallet, "agent.wallet"),
        active: expectBoolean(tuple.active, "agent.active"),
        endpoints,
      };
    } catch (error) {
      if (
        error instanceof PerkOSError &&
        error.code === "CONTRACT_ERROR" &&
        error.details?.clarityCode === 102n
      ) {
        return null;
      }
      throw error;
    }
  }

  async getJobCount(asset: PaymentAsset): Promise<bigint> {
    const value = unwrapResponse(
      await this.read(contractForAsset(this.config.contracts, asset), "get-job-count"),
      "get-job-count"
    );
    return expectUint(value, "get-job-count");
  }

  async getJob(
    asset: PaymentAsset,
    jobIdInput: bigint | number | string
  ): Promise<JobRecord | null> {
    const jobId = toUint(jobIdInput, "jobId");
    try {
      const value = unwrapResponse(
        await this.read(contractForAsset(this.config.contracts, asset), "get-job", [
          Cl.uint(jobId),
        ]),
        "get-job"
      );
      const tuple = expectTuple(value, "get-job");
      const statusCode = expectUint(tuple.status, "job.status");
      const status = JOB_STATUS[Number(statusCode) as keyof typeof JOB_STATUS];
      if (!status) {
        throw new PerkOSError("READ_FAILED", `Unknown job status ${statusCode}.`);
      }
      const provider = optionalPrincipal(tuple.provider, "job.provider");
      const deliverable = optionalBuffer(tuple.deliverable, "job.deliverable");
      return {
        id: jobId,
        asset,
        client: expectPrincipal(tuple.client, "job.client"),
        ...(provider ? { provider } : {}),
        evaluator: expectPrincipal(tuple.evaluator, "job.evaluator"),
        description: expectString(tuple.description, "job.description"),
        budget: expectUint(tuple.budget, "job.budget"),
        expiredAt: expectUint(tuple["expired-at"], "job.expired-at"),
        status,
        statusCode,
        ...(deliverable ? { deliverable } : {}),
      };
    } catch (error) {
      if (
        error instanceof PerkOSError &&
        error.code === "CONTRACT_ERROR" &&
        (error.details?.clarityCode === 202n || error.details?.clarityCode === 302n)
      ) {
        return null;
      }
      throw error;
    }
  }

  async getEscrowBalance(
    asset: PaymentAsset,
    jobIdInput: bigint | number | string
  ): Promise<bigint> {
    const jobId = toUint(jobIdInput, "jobId");
    const value = unwrapResponse(
      await this.read(contractForAsset(this.config.contracts, asset), "get-escrow-balance", [
        Cl.uint(jobId),
      ]),
      "get-escrow-balance"
    );
    return expectUint(value, "get-escrow-balance");
  }

  async getConfiguredSbtcToken(): Promise<string> {
    const value = unwrapResponse(
      await this.read(this.config.contracts.sbtcCommerce, "get-payment-token"),
      "get-payment-token"
    );
    return expectPrincipal(value, "get-payment-token");
  }

  async getReputation(agent: string): Promise<ReputationRecord> {
    assertPrincipal(agent, "agent", this.config.network);
    const value = unwrapResponse(
      await this.read(this.config.contracts.reputationRegistry, "get-reputation", [
        Cl.principal(agent),
      ]),
      "get-reputation"
    );
    const tuple = expectTuple(value, "get-reputation");
    return {
      agent,
      totalScore: expectUint(tuple["total-score"], "reputation.total-score"),
      ratingCount: expectUint(tuple["rating-count"], "reputation.rating-count"),
      averageScoreX100: expectUint(
        tuple["average-score-x100"],
        "reputation.average-score-x100"
      ),
      completedJobs: expectUint(tuple["completed-jobs"], "reputation.completed-jobs"),
      disputedJobs: expectUint(tuple["disputed-jobs"], "reputation.disputed-jobs"),
    };
  }

  registerAgent(input: RegisterAgentInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.registerAgent(input));
  }

  updateAgent(input: UpdateAgentInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.updateAgent(input));
  }

  deactivateAgent(agentId: bigint | number | string): Promise<TransactionReceipt> {
    return this.execute(this.transactions.deactivateAgent(agentId));
  }

  createJob(input: CreateJobInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.createJob(input));
  }

  setBudget(input: JobAmountInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.setBudget(input));
  }

  async fundJob(input: FundJobInput): Promise<TransactionReceipt> {
    const jobId = toUint(input.jobId, "jobId");
    const amount = toUint(input.amount, "amount");
    this.policy.authorize({
      type: "contract-call",
      network: this.config.network,
      contract: contractForAsset(this.config.contracts, input.asset),
      functionName: "fund-job",
      functionArgs: [],
      postConditions: [],
      postConditionMode: "deny",
      intent: { operation: "fund-job", asset: input.asset, amount, jobId },
    });
    const sender = input.sender ?? (await this.requireSignerAddress());
    return this.execute(
      this.transactions.fundJob({ ...input, jobId, amount, sender })
    );
  }

  assignProvider(input: AssignProviderInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.assignProvider(input));
  }

  submitWork(input: SubmitWorkInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.submitWork(input));
  }

  async completeJob(asset: PaymentAsset, jobIdInput: bigint | number | string) {
    const settlement = await this.settlementInput("complete-job", asset, jobIdInput);
    return this.execute(this.transactions.completeJob(settlement));
  }

  async rejectJob(asset: PaymentAsset, jobIdInput: bigint | number | string) {
    const settlement = await this.settlementInput("reject-job", asset, jobIdInput);
    return this.execute(this.transactions.rejectJob(settlement));
  }

  async expireJob(asset: PaymentAsset, jobIdInput: bigint | number | string) {
    const settlement = await this.settlementInput("expire-job", asset, jobIdInput);
    return this.execute(this.transactions.expireJob(settlement));
  }

  rateProvider(input: RateProviderInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.rateProvider(input));
  }

  private async settlementInput(
    operation: "complete-job" | "reject-job" | "expire-job",
    asset: PaymentAsset,
    jobIdInput: bigint | number | string
  ): Promise<SettleJobInput> {
    const jobId = toUint(jobIdInput, "jobId");
    const [job, amount] = await Promise.all([
      this.getJob(asset, jobId),
      this.getEscrowBalance(asset, jobId),
    ]);
    if (!job) {
      throw new PerkOSError("INPUT_INVALID", `Job ${jobId} does not exist.`);
    }
    const recipient =
      operation === "complete-job"
        ? job.provider
        : job.client;
    if (!recipient) {
      throw new PerkOSError(
        "INPUT_INVALID",
        `Job ${jobId} has no provider to receive settlement.`
      );
    }
    return { asset, jobId, amount, recipient };
  }

  private async requireSignerAddress(): Promise<string> {
    if (!this.signer) {
      throw new PerkOSError("SIGNER_REQUIRED", "A signer is required to fund a job.");
    }
    return this.signer.getAddress();
  }

  private read(
    contract: ContractId,
    functionName: string,
    functionArgs: readonly ClarityValue[] = []
  ): Promise<ClarityValue> {
    const senderAddress = parseContractId(contract, "contract", this.config.network).address;
    return this.readOnlyTransport({
      network: this.config.network,
      ...(this.config.apiUrl ? { apiUrl: this.config.apiUrl } : {}),
      contract,
      functionName,
      functionArgs,
      senderAddress,
    });
  }
}
