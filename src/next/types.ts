import type {
  AmountLike,
  ContractId,
  Hash32Input,
  JobDecision,
  PaymentAsset,
  PerkOSNetwork,
  PerkOSSigner,
  ReadOnlyTransport,
  SpendingPolicyInput,
  TransactionTrackerLike,
} from "../types.js";

export type NayoriNextContractKey =
  | "permissions"
  | "roles"
  | "reputation"
  | "escrowSbtc"
  | "escrowStx"
  | "agents"
  | "applications";

export interface NayoriNextContracts {
  readonly permissions: ContractId;
  readonly roles: ContractId;
  readonly reputation: ContractId;
  readonly escrowSbtc: ContractId;
  readonly escrowStx: ContractId;
  readonly agents: ContractId;
  readonly applications: ContractId;
  /** Canonical sBTC used inside the contracts; only post-conditions reference it. */
  readonly sbtcToken: ContractId;
  readonly sbtcAssetName: string;
}

export interface NayoriNextConfig {
  readonly network: PerkOSNetwork;
  /** Address that deployed the seven next contracts on this network. */
  readonly deployer?: string;
  /** Per-contract overrides, applied after `deployer`. */
  readonly contracts?: Partial<NayoriNextContracts>;
  readonly apiUrl?: string;
  readonly signer?: PerkOSSigner;
  readonly spendingPolicy?: SpendingPolicyInput;
  readonly readOnlyTransport?: ReadOnlyTransport;
  readonly transactionTracker?: TransactionTrackerLike;
}

export interface ResolvedNayoriNextConfig {
  readonly network: PerkOSNetwork;
  readonly apiUrl?: string;
  /** Always true: the defaults are the live deployments, and a custom deployer is taken as deployed. */
  readonly deployed: boolean;
  readonly contracts: NayoriNextContracts;
}

export type NayoriNextJobStatus =
  | "open"
  | "funded"
  | "offered"
  | "accepted"
  | "submitted"
  | "decided"
  | "disputed"
  | "completed"
  | "rejected"
  | "refunded"
  | "expired";

export type NayoriNextRole = "treasury" | "appeal-authority";

/** Escrow contracts that accept delegated callers, or any contract id. */
export type NayoriNextAllowanceTarget =
  | "escrowSbtc"
  | "escrowStx"
  | "agents"
  | "applications"
  | ContractId;

// ------------------------------------------------------------------ records

export interface NayoriNextJob {
  readonly id: bigint;
  readonly asset: PaymentAsset;
  readonly client: string;
  readonly evaluator: string;
  readonly provider?: string;
  readonly treasury: string;
  readonly appealAuthority: string;
  readonly budget: bigint;
  readonly description: string;
  /** Before acceptance: deadline to fund, offer and accept. From acceptance: delivery deadline. */
  readonly deliveryDeadline: bigint;
  readonly deliveryBlocks: bigint;
  readonly reviewBlocks: bigint;
  readonly status: NayoriNextJobStatus;
  readonly statusCode: bigint;
}

export interface NayoriNextSubmission {
  readonly jobId: bigint;
  /** Hex of the deliverable buffer (up to 64 bytes). */
  readonly deliverable: string;
  readonly reviewDeadline: bigint;
}

export interface NayoriNextDecision {
  readonly jobId: bigint;
  readonly decision: JobDecision;
  readonly byDefault: boolean;
  /** Hex; all zeros for a default approval. */
  readonly evidenceHash: string;
  readonly appealDeadline: bigint;
  readonly appellant?: string;
  readonly resolutionDeadline?: bigint;
}

export interface NayoriNextReputationPending {
  readonly jobId: bigint;
  readonly asset: PaymentAsset;
  readonly provider: string;
  readonly client: string;
  readonly completed: boolean;
  readonly value: bigint;
}

export interface NayoriNextOutcome {
  readonly jobId: bigint;
  readonly asset: PaymentAsset;
  readonly provider: string;
  readonly client: string;
  readonly completed: boolean;
  readonly value: bigint;
  readonly rated: boolean;
}

/** Raw reputation data; the registry computes no score (DECISIONS D5). */
export interface NayoriNextProviderStats {
  readonly provider: string;
  readonly completed: bigint;
  readonly rejected: bigint;
  readonly notDelivered: bigint;
  readonly completedValueSbtc: bigint;
  readonly completedValueStx: bigint;
  readonly distinctClients: bigint;
  readonly ratingSum: bigint;
  readonly ratingCount: bigint;
}

export interface NayoriNextAgent {
  readonly wallet: string;
  readonly name: string;
  readonly uri: string;
  readonly registeredAt: bigint;
}

export interface NayoriNextApplication {
  readonly applicant: string;
  readonly deposit: bigint;
}

export interface NayoriNextHandover {
  readonly role: NayoriNextRole;
  readonly candidate: string;
  readonly readyAt: bigint;
}

export interface NayoriNextAllowance {
  /** Bitcoin block height the allowance ends at (exclusive); absent means no expiry. */
  readonly until?: bigint;
}

// ------------------------------------------------------------------ inputs

export interface NayoriNextJobRef {
  readonly asset: PaymentAsset;
  readonly jobId: AmountLike;
}

export interface NayoriNextCreateJobInput {
  readonly asset: PaymentAsset;
  readonly evaluator: string;
  /** sats for sBTC, micro-STX for STX. */
  readonly budget: AmountLike;
  readonly deliveryBlocks: AmountLike;
  readonly reviewBlocks: AmountLike;
  readonly description: string;
  /** The signer, when known, so client/evaluator separation is checked locally. */
  readonly client?: string;
}

export interface NayoriNextFundJobInput extends NayoriNextJobRef {
  readonly budget: AmountLike;
  /** The client wallet; the funding post-condition binds it to exactly the budget. */
  readonly sender: string;
}

export interface NayoriNextNameProviderInput extends NayoriNextJobRef {
  readonly provider: string;
  /** Known job parties, checked locally against the provider when given. */
  readonly parties?: readonly string[];
}

export interface NayoriNextSubmitWorkInput extends NayoriNextJobRef {
  readonly deliverable: string | Uint8Array;
}

export interface NayoriNextRecordDecisionInput extends NayoriNextJobRef {
  readonly decision: JobDecision;
  readonly evidenceHash: Hash32Input;
}

export interface NayoriNextAppealInput extends NayoriNextJobRef {
  readonly evidenceHash: Hash32Input;
}

export interface NayoriNextPayoutInput extends NayoriNextJobRef {
  /** The job budget the escrow pays out in full (winner net plus treasury fee, or refund). */
  readonly budget: AmountLike;
  /** Disclosure only; the post-condition constrains the escrow's total outflow. */
  readonly recipient?: string;
}

export interface NayoriNextResolveAppealInput extends NayoriNextPayoutInput {
  readonly decision: JobDecision;
  readonly resolutionHash: Hash32Input;
}

export interface NayoriNextRateProviderInput extends NayoriNextJobRef {
  readonly score: AmountLike;
}

export interface NayoriNextAllowCallerInput {
  /** Contract that may call `target` for the signer. */
  readonly caller: ContractId;
  readonly target: NayoriNextAllowanceTarget;
  /** Optional Bitcoin block height at which the allowance ends. */
  readonly until?: AmountLike;
}

export interface NayoriNextDisallowCallerInput {
  readonly caller: ContractId;
  readonly target: NayoriNextAllowanceTarget;
}

export interface NayoriNextHandoverInput {
  readonly role: NayoriNextRole;
  readonly candidate: string;
}

export interface NayoriNextAgentInput {
  readonly name: string;
  readonly uri: string;
}

export interface NayoriNextApplyInput {
  readonly jobId: AmountLike;
  /** sBTC sats, 100 to 1,000,000. */
  readonly deposit: AmountLike;
  /** The applicant wallet; the post-condition binds it to exactly the deposit. */
  readonly sender: string;
}

export interface NayoriNextApplicationRefundInput {
  readonly jobId: AmountLike;
  readonly applicant: string;
  /** The applicant's recorded deposit, returned in full by the contract. */
  readonly deposit: AmountLike;
}
