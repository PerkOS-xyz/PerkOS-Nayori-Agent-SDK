import type {
  ClarityValue,
  ContractIdString,
  PostCondition,
  PostConditionModeName,
} from "@stacks/transactions";

export type PerkOSNetwork = "mainnet" | "testnet";
export type PaymentAsset = "sbtc" | "stx";
export type ContractId = ContractIdString;
export type Amount = bigint;
export type AmountLike = bigint | number | string;

export interface PerkOSContracts {
  readonly agentRegistry: ContractId;
  readonly stxCommerce: ContractId;
  readonly sbtcCommerce: ContractId;
  readonly reputationRegistry: ContractId;
  readonly sbtcToken: ContractId;
  readonly sbtcAssetName: string;
}

export interface PerkOSConfig {
  readonly network: PerkOSNetwork;
  readonly apiUrl?: string;
  readonly contracts?: Partial<PerkOSContracts>;
  readonly signer?: PerkOSSigner;
  readonly spendingPolicy?: SpendingPolicyInput;
  readonly readOnlyTransport?: ReadOnlyTransport;
  readonly transactionTracker?: TransactionTrackerLike;
}

export interface ResolvedPerkOSConfig {
  readonly network: PerkOSNetwork;
  readonly apiUrl?: string;
  readonly contracts: PerkOSContracts;
}

export interface AgentEndpoint {
  readonly name: string;
  readonly url: string;
}

export interface AgentRecord {
  readonly id: bigint;
  readonly name: string;
  readonly description: string;
  readonly creator: string;
  readonly wallet: string;
  readonly active: boolean;
  readonly endpoints: readonly AgentEndpoint[];
}

export type JobStatus =
  | "open"
  | "funded"
  | "submitted"
  | "completed"
  | "rejected"
  | "expired"
  | "timeout-paid"
  | "decision-pending"
  | "disputed";

export type JobDecision = "approve" | "reject";
export type Hash32Input = string | Uint8Array;

export interface JobRecord {
  readonly id: bigint;
  readonly asset: PaymentAsset;
  readonly client: string;
  readonly provider?: string;
  readonly evaluator: string;
  readonly appealAuthority?: string;
  readonly description: string;
  readonly budget: bigint;
  readonly expiredAt: bigint;
  readonly status: JobStatus;
  readonly statusCode: bigint;
  readonly deliverable?: string;
  readonly submittedAtBurn?: bigint;
  readonly reviewDeadline?: bigint;
}

export interface DecisionRecord {
  readonly jobId: bigint;
  readonly originalDecision: JobDecision;
  readonly finalDecision?: JobDecision;
  readonly evidenceHash: string;
  readonly explanationHash: string;
  readonly decidedAtBurn: bigint;
  readonly appealDeadline: bigint;
  readonly appealedBy?: string;
  readonly appealEvidenceHash?: string;
  readonly resolutionDeadline?: bigint;
  readonly resolutionHash?: string;
  readonly finalizedBy?: string;
  readonly finalizedAtBurn?: bigint;
}

export interface ReputationSyncRecord {
  readonly jobId: bigint;
  readonly asset: PaymentAsset;
  readonly outcome: "completed" | "disputed";
  readonly outcomeCode: bigint;
  readonly pending: boolean;
  readonly lastError: bigint;
}

export interface ReputationRecord {
  readonly agent: string;
  readonly totalScore: bigint;
  readonly ratingCount: bigint;
  readonly averageScoreX100: bigint;
  readonly completedJobs: bigint;
  readonly disputedJobs: bigint;
}

export type PerkOSOperation =
  | "register-agent"
  | "update-agent"
  | "deactivate-agent"
  | "create-job"
  | "set-budget"
  | "fund-job"
  | "assign-provider"
  | "submit-work"
  | "complete-job"
  | "reject-job"
  | "expire-job"
  | "settle-review-timeout"
  | "record-decision"
  | "appeal-decision"
  | "finalize-decision"
  | "resolve-appeal"
  | "settle-appeal-timeout"
  | "retry-reputation-sync"
  | "rate-provider";

export interface TransactionIntent {
  readonly operation: PerkOSOperation;
  readonly asset?: PaymentAsset;
  readonly amount?: bigint;
  readonly jobId?: bigint;
  readonly sender?: string;
  readonly recipient?: string;
}

export interface ContractCallPlan {
  readonly type: "contract-call";
  readonly network: PerkOSNetwork;
  readonly contract: ContractId;
  readonly functionName: string;
  readonly functionArgs: readonly ClarityValue[];
  readonly postConditions: readonly PostCondition[];
  readonly postConditionMode: PostConditionModeName;
  readonly intent: TransactionIntent;
}

export interface SignerResult {
  readonly txid: string;
  readonly raw?: unknown;
}

export interface PerkOSSigner {
  getAddress(): Promise<string>;
  signAndBroadcast(plan: ContractCallPlan): Promise<SignerResult>;
}

export interface TransactionReceipt {
  readonly txid: string;
  readonly status: "broadcast";
  readonly network: PerkOSNetwork;
  readonly contract: ContractId;
  readonly operation: PerkOSOperation;
  readonly asset?: PaymentAsset;
  readonly amount?: bigint;
  readonly jobId?: bigint;
  readonly explorerUrl: string;
  readonly raw?: unknown;
}

export type TransactionConfirmationStatus =
  | "pending"
  | "success"
  | "abort"
  | "dropped"
  | "timeout";

export interface TransactionResultValue {
  readonly hex?: string;
  readonly repr?: string;
}

export interface TransactionConfirmation {
  readonly txid: string;
  readonly network: PerkOSNetwork;
  readonly status: TransactionConfirmationStatus;
  readonly observedAt: string;
  readonly blockHeight?: number;
  readonly blockHash?: string;
  readonly result?: TransactionResultValue;
  readonly raw?: unknown;
}

export interface ConfirmationOptions {
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onStatus?: (
    confirmation: TransactionConfirmation
  ) => void | Promise<void>;
}

export interface TransactionTrackerLike {
  getStatus(txid: string): Promise<TransactionConfirmation>;
  waitForConfirmation(
    txid: string,
    options?: ConfirmationOptions
  ): Promise<TransactionConfirmation>;
}

export interface ConfirmedTransactionReceipt {
  readonly broadcast: TransactionReceipt;
  readonly confirmation: TransactionConfirmation;
}

export interface ReadOnlyCall {
  readonly network: PerkOSNetwork;
  readonly apiUrl?: string;
  readonly contract: ContractId;
  readonly functionName: string;
  readonly functionArgs: readonly ClarityValue[];
  readonly senderAddress: string;
}

export type ReadOnlyTransport = (call: ReadOnlyCall) => Promise<ClarityValue>;

export interface SpendingPolicyInput {
  readonly allowedNetworks?: readonly PerkOSNetwork[];
  readonly allowedContracts?: readonly ContractId[];
  readonly allowedAssets?: readonly PaymentAsset[];
  readonly maxPerTransaction?: Partial<Record<PaymentAsset, AmountLike>>;
  readonly maxPerSession?: Partial<Record<PaymentAsset, AmountLike>>;
}

export interface SpendingApproval {
  readonly operation: PerkOSOperation;
  readonly asset?: PaymentAsset;
  readonly amount?: bigint;
  readonly spentThisSession?: bigint;
  readonly remainingThisSession?: bigint;
}

export interface RegisterAgentInput {
  readonly name: string;
  readonly description: string;
  readonly wallet: string;
  readonly endpoints?: readonly AgentEndpoint[];
}

export interface UpdateAgentInput {
  readonly agentId: AmountLike;
  readonly name?: string;
  readonly description?: string;
  readonly wallet?: string;
}

export interface CreateJobInput {
  readonly asset: PaymentAsset;
  readonly provider?: string;
  readonly evaluator: string;
  readonly expiredAt: AmountLike;
  readonly description: string;
}

export interface JobAmountInput {
  readonly asset: PaymentAsset;
  readonly jobId: AmountLike;
  readonly amount: AmountLike;
}

export interface FundJobInput extends JobAmountInput {
  readonly sender?: string;
}

export interface AssignProviderInput {
  readonly asset: PaymentAsset;
  readonly jobId: AmountLike;
  readonly provider: string;
}

export interface SubmitWorkInput {
  readonly asset: PaymentAsset;
  readonly jobId: AmountLike;
  readonly deliverable: string | Uint8Array;
}

export interface SettleJobInput {
  readonly asset: PaymentAsset;
  readonly jobId: AmountLike;
  readonly amount: AmountLike;
  readonly recipient: string;
  readonly sbtcToken?: ContractId;
}

export interface RateProviderInput {
  readonly asset: PaymentAsset;
  readonly jobId: AmountLike;
  readonly score: AmountLike;
  readonly comment: string;
}

export interface RecordDecisionInput {
  readonly asset: PaymentAsset;
  readonly jobId: AmountLike;
  readonly decision: JobDecision;
  readonly evidenceHash: Hash32Input;
  readonly explanationHash: Hash32Input;
}

export interface AppealDecisionInput {
  readonly asset: PaymentAsset;
  readonly jobId: AmountLike;
  readonly evidenceHash: Hash32Input;
}

export type DecisionSettlementInput = SettleJobInput;

export interface ResolveAppealInput {
  readonly asset: PaymentAsset;
  readonly jobId: AmountLike;
  readonly decision: JobDecision;
  readonly resolutionHash: Hash32Input;
}

export interface ResolveAppealPlanInput extends DecisionSettlementInput {
  readonly decision: JobDecision;
  readonly resolutionHash: Hash32Input;
}
