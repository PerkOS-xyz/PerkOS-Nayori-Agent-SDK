import { Cl } from "@stacks/transactions";
import type { ClarityValue } from "@stacks/transactions";
import { expectBoolean, expectPrincipal, expectUint } from "../clarity.js";
import { defaultReadOnlyTransport } from "../client.js";
import { PerkOSError } from "../errors.js";
import { SpendingPolicy } from "../policy.js";
import { TransactionTracker } from "../tracker.js";
import { normalizeTxid } from "../txid.js";
import type {
  AmountLike,
  ConfirmationOptions,
  ConfirmedTransactionReceipt,
  ContractCallPlan,
  ContractId,
  Hash32Input,
  JobDecision,
  PaymentAsset,
  PerkOSSigner,
  ReadOnlyTransport,
  SpendingApproval,
  TransactionConfirmation,
  TransactionReceipt,
  TransactionTrackerLike,
} from "../types.js";
import { assertPrincipal, parseContractId, toUint } from "../validation.js";
import { NayoriNextTransactionBuilder } from "./builders.js";
import { assertNayoriNextDeployed, resolveNayoriNextConfig } from "./config.js";
import { NAYORI_NEXT_CONTRACT_KEYS, NAYORI_NEXT_ROLE_CODES } from "./constants.js";
import {
  parseNayoriNextAgent,
  parseNayoriNextAllowance,
  parseNayoriNextApplication,
  parseNayoriNextApplications,
  parseNayoriNextDecision,
  parseNayoriNextHandover,
  parseNayoriNextJob,
  parseNayoriNextOutcome,
  parseNayoriNextProviderStats,
  parseNayoriNextReputationPending,
  parseNayoriNextSubmission,
} from "./parsers.js";
import type {
  NayoriNextAgent,
  NayoriNextAgentInput,
  NayoriNextAllowance,
  NayoriNextAllowanceTarget,
  NayoriNextAllowCallerInput,
  NayoriNextAppealInput,
  NayoriNextApplication,
  NayoriNextConfig,
  NayoriNextCreateJobInput,
  NayoriNextDecision,
  NayoriNextDisallowCallerInput,
  NayoriNextHandover,
  NayoriNextHandoverInput,
  NayoriNextJob,
  NayoriNextJobRef,
  NayoriNextOutcome,
  NayoriNextProviderStats,
  NayoriNextRateProviderInput,
  NayoriNextRecordDecisionInput,
  NayoriNextReputationPending,
  NayoriNextRole,
  NayoriNextSubmission,
  NayoriNextSubmitWorkInput,
  ResolvedNayoriNextConfig,
} from "./types.js";

type JobIdLike = AmountLike;

/**
 * Client for the next Nayori contract generation (live on mainnet and testnet).
 * Reads return parsed records; writes read the live job or application first
 * so the post-conditions carry the exact amounts the contract will move.
 */
export class NayoriNextClient {
  readonly config: ResolvedNayoriNextConfig;
  readonly transactions: NayoriNextTransactionBuilder;
  readonly policy: SpendingPolicy;
  readonly tracker: TransactionTrackerLike;
  private readonly signer: PerkOSSigner | undefined;
  private readonly readOnlyTransport: ReadOnlyTransport;

  constructor(input: NayoriNextConfig) {
    this.config = resolveNayoriNextConfig(input);
    this.transactions = new NayoriNextTransactionBuilder(this.config);
    this.policy = new SpendingPolicy(
      { network: this.config.network },
      {
        ...input.spendingPolicy,
        allowedContracts:
          input.spendingPolicy?.allowedContracts ??
          NAYORI_NEXT_CONTRACT_KEYS.filter((key) => key !== "reputation").map(
            (key) => this.config.contracts[key]
          ),
      }
    );
    this.signer = input.signer;
    this.readOnlyTransport = input.readOnlyTransport ?? defaultReadOnlyTransport;
    this.tracker =
      input.transactionTracker ??
      new TransactionTracker({
        network: this.config.network,
        ...(this.config.apiUrl ? { apiUrl: this.config.apiUrl } : {}),
      });
  }

  // ---------------------------------------------------------------- execution

  preview(plan: ContractCallPlan): SpendingApproval {
    return this.policy.authorize(plan);
  }

  async execute(plan: ContractCallPlan): Promise<TransactionReceipt> {
    assertNayoriNextDeployed(this.config);
    if (plan.network !== this.config.network) {
      throw new PerkOSError(
        "POLICY_DENIED",
        `Plan network ${plan.network} does not match client network ${this.config.network}.`
      );
    }
    if (!this.signer) {
      throw new PerkOSError("SIGNER_REQUIRED", "A signer is required to execute transaction plans.");
    }
    this.policy.authorize(plan);
    const signerAddress = await this.signer.getAddress();
    assertPrincipal(signerAddress, "signer address", this.config.network);
    if (plan.intent.sender && signerAddress !== plan.intent.sender) {
      throw new PerkOSError(
        "SIGNER_MISMATCH",
        `Plan expects ${plan.intent.sender}, but the signer controls ${signerAddress}.`
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
    if (typeof receiptOrTxid !== "string" && receiptOrTxid.network !== this.config.network) {
      throw new PerkOSError(
        "POLICY_DENIED",
        `Receipt network ${receiptOrTxid.network} does not match client network ${this.config.network}.`
      );
    }
    const txid = typeof receiptOrTxid === "string" ? receiptOrTxid : receiptOrTxid.txid;
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

  // ---------------------------------------------------------------- escrow reads

  async getJobCount(asset: PaymentAsset): Promise<bigint> {
    return expectUint(
      await this.read(this.transactions.escrowContract(asset), "get-job-count"),
      "get-job-count"
    );
  }

  async getJob(asset: PaymentAsset, jobIdInput: JobIdLike): Promise<NayoriNextJob | null> {
    const jobId = toUint(jobIdInput, "jobId");
    return parseNayoriNextJob(await this.escrowRead(asset, "get-job", jobId), asset, jobId);
  }

  async getSubmission(asset: PaymentAsset, jobIdInput: JobIdLike): Promise<NayoriNextSubmission | null> {
    const jobId = toUint(jobIdInput, "jobId");
    return parseNayoriNextSubmission(await this.escrowRead(asset, "get-submission", jobId), jobId);
  }

  async getDecision(asset: PaymentAsset, jobIdInput: JobIdLike): Promise<NayoriNextDecision | null> {
    const jobId = toUint(jobIdInput, "jobId");
    return parseNayoriNextDecision(await this.escrowRead(asset, "get-decision", jobId), jobId);
  }

  async getEscrowBalance(asset: PaymentAsset, jobIdInput: JobIdLike): Promise<bigint> {
    const jobId = toUint(jobIdInput, "jobId");
    return expectUint(await this.escrowRead(asset, "get-escrow-balance", jobId), "get-escrow-balance");
  }

  async getReputationPending(
    asset: PaymentAsset,
    jobIdInput: JobIdLike
  ): Promise<NayoriNextReputationPending | null> {
    const jobId = toUint(jobIdInput, "jobId");
    return parseNayoriNextReputationPending(
      await this.escrowRead(asset, "get-reputation-pending", jobId),
      asset,
      jobId
    );
  }

  // ---------------------------------------------------------------- reputation, agents, roles

  async getProviderStats(provider: string): Promise<NayoriNextProviderStats> {
    assertPrincipal(provider, "provider", this.config.network);
    return parseNayoriNextProviderStats(
      await this.read(this.config.contracts.reputation, "get-provider-stats", [Cl.principal(provider)]),
      provider
    );
  }

  /** The outcome the given escrow recorded for a job. */
  async getOutcome(asset: PaymentAsset, jobIdInput: JobIdLike): Promise<NayoriNextOutcome | null> {
    const jobId = toUint(jobIdInput, "jobId");
    const source = this.transactions.escrowContract(asset);
    return parseNayoriNextOutcome(
      await this.read(this.config.contracts.reputation, "get-outcome", [
        Cl.principal(source),
        Cl.uint(jobId),
      ]),
      asset,
      jobId
    );
  }

  async getAgent(wallet: string): Promise<NayoriNextAgent | null> {
    assertPrincipal(wallet, "wallet", this.config.network);
    return parseNayoriNextAgent(
      await this.read(this.config.contracts.agents, "get-agent", [Cl.principal(wallet)]),
      wallet
    );
  }

  async isRegisteredAgent(wallet: string): Promise<boolean> {
    assertPrincipal(wallet, "wallet", this.config.network);
    return expectBoolean(
      await this.read(this.config.contracts.agents, "is-registered", [Cl.principal(wallet)]),
      "is-registered"
    );
  }

  async getAgentCount(): Promise<bigint> {
    return expectUint(await this.read(this.config.contracts.agents, "get-agent-count"), "get-agent-count");
  }

  async getTreasury(): Promise<string> {
    return expectPrincipal(await this.read(this.config.contracts.roles, "get-treasury"), "get-treasury");
  }

  async getAppealAuthority(): Promise<string> {
    return expectPrincipal(
      await this.read(this.config.contracts.roles, "get-appeal-authority"),
      "get-appeal-authority"
    );
  }

  async getHandover(role: NayoriNextRole): Promise<NayoriNextHandover | null> {
    const code = NAYORI_NEXT_ROLE_CODES[role];
    if (code === undefined) {
      throw new PerkOSError("INPUT_INVALID", 'role must be "treasury" or "appeal-authority".');
    }
    return parseNayoriNextHandover(
      await this.read(this.config.contracts.roles, "get-handover", [Cl.uint(code)]),
      role
    );
  }

  async getAllowance(
    party: string,
    caller: ContractId,
    target: NayoriNextAllowanceTarget
  ): Promise<NayoriNextAllowance | null> {
    assertPrincipal(party, "party", this.config.network);
    return parseNayoriNextAllowance(
      await this.read(this.config.contracts.permissions, "get-allowance", [
        Cl.principal(party),
        this.contractPrincipal(caller, "caller"),
        this.contractPrincipal(this.resolveTarget(target), "target"),
      ])
    );
  }

  // ---------------------------------------------------------------- applications reads

  async getApplications(jobIdInput: JobIdLike): Promise<NayoriNextApplication[]> {
    const jobId = toUint(jobIdInput, "jobId");
    return parseNayoriNextApplications(
      await this.read(this.config.contracts.applications, "get-applications", [Cl.uint(jobId)])
    );
  }

  async getApplication(jobIdInput: JobIdLike, applicant: string): Promise<NayoriNextApplication | null> {
    const jobId = toUint(jobIdInput, "jobId");
    assertPrincipal(applicant, "applicant", this.config.network);
    return parseNayoriNextApplication(
      await this.read(this.config.contracts.applications, "get-application", [
        Cl.uint(jobId),
        Cl.principal(applicant),
      ])
    );
  }

  // ---------------------------------------------------------------- escrow writes

  async createJob(input: NayoriNextCreateJobInput): Promise<TransactionReceipt> {
    const client = input.client ?? (this.signer ? await this.signer.getAddress() : undefined);
    return this.execute(this.transactions.createJob({ ...input, ...(client ? { client } : {}) }));
  }

  /** Funds an open job with exactly its live budget, from the signing client. */
  async fundJob(asset: PaymentAsset, jobIdInput: JobIdLike): Promise<TransactionReceipt> {
    const job = await this.requireJob(asset, jobIdInput);
    const sender = await this.requireSignerAddress();
    if (job.client !== sender) {
      throw new PerkOSError("INPUT_INVALID", "Only the job client may fund the job.", { clarityCode: 302n });
    }
    this.requireStatus(job, ["open"]);
    return this.execute(
      this.transactions.fundJob({ asset, jobId: job.id, budget: job.budget, sender })
    );
  }

  async nameProvider(asset: PaymentAsset, jobIdInput: JobIdLike, provider: string): Promise<TransactionReceipt> {
    const job = await this.requireJob(asset, jobIdInput);
    this.requireStatus(job, ["funded", "offered"]);
    return this.execute(
      this.transactions.nameProvider({
        asset,
        jobId: job.id,
        provider,
        parties: [job.client, job.evaluator, job.treasury, job.appealAuthority],
      })
    );
  }

  acceptJob(input: NayoriNextJobRef): Promise<TransactionReceipt> {
    return this.execute(this.transactions.acceptJob(input));
  }

  submitWork(input: NayoriNextSubmitWorkInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.submitWork(input));
  }

  recordDecision(input: NayoriNextRecordDecisionInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.recordDecision(input));
  }

  recordDefaultApproval(input: NayoriNextJobRef): Promise<TransactionReceipt> {
    return this.execute(this.transactions.recordDefaultApproval(input));
  }

  appeal(input: NayoriNextAppealInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.appeal(input));
  }

  /** The appeal authority's final decision; settles the job in the same transaction. */
  async resolveAppeal(input: {
    readonly asset: PaymentAsset;
    readonly jobId: JobIdLike;
    readonly decision: JobDecision;
    readonly resolutionHash: Hash32Input;
  }): Promise<TransactionReceipt> {
    const job = await this.requirePayout(input.asset, input.jobId, ["disputed"]);
    return this.execute(
      this.transactions.resolveAppeal({
        ...input,
        jobId: job.id,
        budget: job.budget,
        ...this.winner(job, input.decision),
      })
    );
  }

  /** Settles a decided or disputed job whose window has passed; the recorded decision stands. */
  async settleJob(asset: PaymentAsset, jobIdInput: JobIdLike): Promise<TransactionReceipt> {
    const job = await this.requirePayout(asset, jobIdInput, ["decided", "disputed"]);
    const decision = await this.getDecision(asset, job.id);
    if (!decision) {
      throw new PerkOSError("READ_FAILED", `Job ${job.id} has no recorded decision.`);
    }
    return this.execute(
      this.transactions.settleJob({
        asset,
        jobId: job.id,
        budget: job.budget,
        ...this.winner(job, decision.decision),
      })
    );
  }

  async refundNoDelivery(asset: PaymentAsset, jobIdInput: JobIdLike): Promise<TransactionReceipt> {
    const job = await this.requirePayout(asset, jobIdInput, ["funded", "offered", "accepted"]);
    return this.execute(
      this.transactions.refundNoDelivery({
        asset,
        jobId: job.id,
        budget: job.budget,
        recipient: job.client,
      })
    );
  }

  closeUnfunded(input: NayoriNextJobRef): Promise<TransactionReceipt> {
    return this.execute(this.transactions.closeUnfunded(input));
  }

  rateProvider(input: NayoriNextRateProviderInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.rateProvider(input));
  }

  retryReputation(input: NayoriNextJobRef): Promise<TransactionReceipt> {
    return this.execute(this.transactions.retryReputation(input));
  }

  // ---------------------------------------------------------------- other writes

  allowContractCaller(input: NayoriNextAllowCallerInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.allowContractCaller(input));
  }

  disallowContractCaller(input: NayoriNextDisallowCallerInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.disallowContractCaller(input));
  }

  proposeHandover(input: NayoriNextHandoverInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.proposeHandover(input));
  }

  cancelHandover(role: NayoriNextRole): Promise<TransactionReceipt> {
    return this.execute(this.transactions.cancelHandover(role));
  }

  acceptHandover(role: NayoriNextRole): Promise<TransactionReceipt> {
    return this.execute(this.transactions.acceptHandover(role));
  }

  registerAgent(input: NayoriNextAgentInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.registerAgent(input));
  }

  updateAgent(input: NayoriNextAgentInput): Promise<TransactionReceipt> {
    return this.execute(this.transactions.updateAgent(input));
  }

  /** Applies to an sBTC job from the signing wallet. Counts toward the sBTC spending limits. */
  async applyToJob(input: { readonly jobId: JobIdLike; readonly deposit: AmountLike }): Promise<TransactionReceipt> {
    const sender = await this.requireSignerAddress();
    return this.execute(this.transactions.applyToJob({ ...input, sender }));
  }

  async withdrawApplication(jobIdInput: JobIdLike): Promise<TransactionReceipt> {
    const applicant = await this.requireSignerAddress();
    const deposit = await this.requireApplication(jobIdInput, applicant);
    return this.execute(
      this.transactions.withdrawApplication({ jobId: jobIdInput, applicant, deposit })
    );
  }

  async declineApplication(jobIdInput: JobIdLike, applicant: string): Promise<TransactionReceipt> {
    const deposit = await this.requireApplication(jobIdInput, applicant);
    return this.execute(
      this.transactions.declineApplication({ jobId: jobIdInput, applicant, deposit })
    );
  }

  async releaseApplication(jobIdInput: JobIdLike, applicant: string): Promise<TransactionReceipt> {
    const deposit = await this.requireApplication(jobIdInput, applicant);
    return this.execute(
      this.transactions.releaseApplication({ jobId: jobIdInput, applicant, deposit })
    );
  }

  // ---------------------------------------------------------------- helpers

  private winner(job: NayoriNextJob, decision: JobDecision): { recipient?: string } {
    const recipient = decision === "approve" ? job.provider : job.client;
    return recipient ? { recipient } : {};
  }

  private async requireJob(asset: PaymentAsset, jobIdInput: JobIdLike): Promise<NayoriNextJob> {
    const job = await this.getJob(asset, jobIdInput);
    if (!job) {
      throw new PerkOSError("INPUT_INVALID", `Job ${jobIdInput} does not exist.`, { clarityCode: 300n });
    }
    return job;
  }

  private requireStatus(job: NayoriNextJob, allowed: readonly NayoriNextJob["status"][]): void {
    if (!allowed.includes(job.status)) {
      throw new PerkOSError(
        "INPUT_INVALID",
        `Job ${job.id} is ${job.status}; this operation needs ${allowed.join(" or ")}.`,
        { clarityCode: 301n }
      );
    }
  }

  /** A job about to pay out: the right status and an escrow holding exactly its budget. */
  private async requirePayout(
    asset: PaymentAsset,
    jobIdInput: JobIdLike,
    allowed: readonly NayoriNextJob["status"][]
  ): Promise<NayoriNextJob> {
    const job = await this.requireJob(asset, jobIdInput);
    this.requireStatus(job, allowed);
    const balance = await this.getEscrowBalance(asset, job.id);
    if (balance !== job.budget) {
      throw new PerkOSError(
        "READ_FAILED",
        `Job ${job.id} escrow holds ${balance}, not its budget ${job.budget}.`
      );
    }
    return job;
  }

  private async requireApplication(jobIdInput: JobIdLike, applicant: string): Promise<bigint> {
    const application = await this.getApplication(jobIdInput, applicant);
    if (!application) {
      throw new PerkOSError(
        "INPUT_INVALID",
        `${applicant} has no application on job ${jobIdInput}.`,
        { clarityCode: 608n }
      );
    }
    return application.deposit;
  }

  private async requireSignerAddress(): Promise<string> {
    if (!this.signer) {
      throw new PerkOSError("SIGNER_REQUIRED", "A signer is required for this operation.");
    }
    return this.signer.getAddress();
  }

  private resolveTarget(target: NayoriNextAllowanceTarget): ContractId {
    return target === "escrowSbtc" ||
      target === "escrowStx" ||
      target === "agents" ||
      target === "applications"
      ? this.config.contracts[target]
      : target;
  }

  private contractPrincipal(value: ContractId, field: string): ClarityValue {
    const { address, name } = parseContractId(value, field, this.config.network);
    return Cl.contractPrincipal(address, name);
  }

  private escrowRead(asset: PaymentAsset, functionName: string, jobId: bigint): Promise<ClarityValue> {
    return this.read(this.transactions.escrowContract(asset), functionName, [Cl.uint(jobId)]);
  }

  private read(
    contract: ContractId,
    functionName: string,
    functionArgs: readonly ClarityValue[] = []
  ): Promise<ClarityValue> {
    assertNayoriNextDeployed(this.config);
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
