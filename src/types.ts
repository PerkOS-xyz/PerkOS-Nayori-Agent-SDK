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
  | "expired";

export interface JobRecord {
  readonly id: bigint;
  readonly asset: PaymentAsset;
  readonly client: string;
  readonly provider?: string;
  readonly evaluator: string;
  readonly description: string;
  readonly budget: bigint;
  readonly expiredAt: bigint;
  readonly status: JobStatus;
  readonly statusCode: bigint;
  readonly deliverable?: string;
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
}

export interface RateProviderInput {
  readonly asset: PaymentAsset;
  readonly jobId: AmountLike;
  readonly score: AmountLike;
  readonly comment: string;
}
