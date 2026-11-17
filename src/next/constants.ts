import type { AmountLike, ContractId, PerkOSNetwork } from "../types.js";
import { toUint } from "../validation.js";
import type {
  NayoriNextContractKey,
  NayoriNextContracts,
  NayoriNextJobStatus,
  NayoriNextRole,
} from "./types.js";

/**
 * Next Nayori contract generation (nayori-escrow-sbtc, nayori-escrow-stx and
 * their companions). UPCOMING, NOT DEPLOYED YET: the deployer addresses below
 * are placeholders (the Stacks boot address, which can never hold these
 * contracts). Builders and the client refuse to target them; point the SDK at
 * a real deployment with `deployer` or `contracts` in the config.
 */
export const NAYORI_NEXT_PLACEHOLDER_DEPLOYERS: Readonly<Record<PerkOSNetwork, string>> = {
  mainnet: "SP000000000000000000002Q6VF78",
  testnet: "ST000000000000000000002AMW42H",
};

export const NAYORI_NEXT_CONTRACT_NAMES: Readonly<Record<NayoriNextContractKey, string>> = {
  permissions: "nayori-permissions",
  roles: "nayori-roles",
  reputation: "nayori-reputation",
  escrowSbtc: "nayori-escrow-sbtc",
  escrowStx: "nayori-escrow-stx",
  agents: "nayori-agents",
  applications: "nayori-applications",
};

export const NAYORI_NEXT_CONTRACT_KEYS = Object.keys(
  NAYORI_NEXT_CONTRACT_NAMES
) as readonly NayoriNextContractKey[];

/** Canonical sBTC the next escrow and applications contracts call internally. */
export const NAYORI_NEXT_SBTC_TOKENS: Readonly<Record<PerkOSNetwork, ContractId>> = {
  mainnet: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
  testnet: "SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token",
};

export function nayoriNextContractIds(
  deployer: string,
  network: PerkOSNetwork
): NayoriNextContracts {
  const ids = Object.fromEntries(
    NAYORI_NEXT_CONTRACT_KEYS.map((key) => [
      key,
      `${deployer}.${NAYORI_NEXT_CONTRACT_NAMES[key]}`,
    ])
  ) as Record<NayoriNextContractKey, ContractId>;
  return {
    ...ids,
    sbtcToken: NAYORI_NEXT_SBTC_TOKENS[network],
    sbtcAssetName: "sbtc-token",
  };
}

/** Placeholder ids, marked `deployed: false`. Not usable for transactions or reads. */
export const NAYORI_NEXT_DEPLOYMENTS: Readonly<
  Record<PerkOSNetwork, NayoriNextContracts & { readonly deployed: false }>
> = {
  mainnet: {
    ...nayoriNextContractIds(NAYORI_NEXT_PLACEHOLDER_DEPLOYERS.mainnet, "mainnet"),
    deployed: false,
  },
  testnet: {
    ...nayoriNextContractIds(NAYORI_NEXT_PLACEHOLDER_DEPLOYERS.testnet, "testnet"),
    deployed: false,
  },
};

/** Bounds fixed in the contracts. Blocks are Bitcoin (burn) blocks. */
export const NAYORI_NEXT_LIMITS = {
  budget: {
    sbtc: { min: 1_000n, max: 100_000_000n },
    stx: { min: 1_000_000n, max: 100_000_000_000n },
  },
  deliveryBlocks: { min: 144n, max: 4_320n },
  reviewBlocks: { min: 12n, max: 1_008n },
  appealBlocks: 144n,
  handoverDelayBlocks: 144n,
  feeDivisor: 50n,
  applicationDeposit: { min: 100n, max: 1_000_000n },
  maxApplications: 50,
  rating: { min: 1n, max: 5n },
  descriptionBytes: 512,
  deliverableBytes: 64,
  agentNameBytes: 64,
  agentUriBytes: 256,
} as const;

export const NAYORI_NEXT_JOB_STATUS: Readonly<Record<number, NayoriNextJobStatus>> = {
  0: "open",
  1: "funded",
  2: "offered",
  3: "accepted",
  4: "submitted",
  5: "decided",
  6: "disputed",
  7: "completed",
  8: "rejected",
  9: "refunded",
  10: "expired",
};

export const NAYORI_NEXT_DECISION = { approve: 1n, reject: 2n } as const;

export const NAYORI_NEXT_ROLE_CODES: Readonly<Record<NayoriNextRole, bigint>> = {
  treasury: 1n,
  "appeal-authority": 2n,
};

export interface NayoriNextErrorInfo {
  readonly contract: NayoriNextContractKey | "escrow";
  readonly name: string;
  readonly message: string;
}

/** Error codes of the next generation. Ranges do not overlap between contracts. */
export const NAYORI_NEXT_ERRORS: Readonly<Record<number, NayoriNextErrorInfo>> = {
  100: { contract: "roles", name: "ERR_INVALID_ROLE", message: "The role is not treasury (1) or appeal authority (2)." },
  101: { contract: "roles", name: "ERR_NOT_HOLDER", message: "Only the current role holder may perform this operation." },
  102: { contract: "roles", name: "ERR_INVALID_CANDIDATE", message: "The candidate already holds this or the other role." },
  103: { contract: "roles", name: "ERR_NO_HANDOVER", message: "No handover is pending for this role." },
  104: { contract: "roles", name: "ERR_NOT_CANDIDATE", message: "Only the proposed candidate may accept the handover." },
  105: { contract: "roles", name: "ERR_TOO_EARLY", message: "The handover delay has not passed." },
  200: { contract: "reputation", name: "ERR_NOT_ESCROW", message: "Only a Nayori escrow may write reputation." },
  201: { contract: "reputation", name: "ERR_ALREADY_RECORDED", message: "This job outcome was already recorded." },
  202: { contract: "reputation", name: "ERR_NO_OUTCOME", message: "No outcome is recorded for this job." },
  203: { contract: "reputation", name: "ERR_NOT_RATABLE", message: "Only the client of a completed job may rate it." },
  204: { contract: "reputation", name: "ERR_ALREADY_RATED", message: "This job was already rated." },
  205: { contract: "reputation", name: "ERR_INVALID_SCORE", message: "The rating must be between 1 and 5." },
  300: { contract: "escrow", name: "ERR_NOT_FOUND", message: "Job not found." },
  301: { contract: "escrow", name: "ERR_INVALID_STATUS", message: "The job is not in the required state." },
  302: { contract: "escrow", name: "ERR_NOT_CLIENT", message: "Only the job client may perform this operation." },
  303: { contract: "escrow", name: "ERR_NOT_PROVIDER", message: "Only the named provider may perform this operation." },
  304: { contract: "escrow", name: "ERR_NOT_EVALUATOR", message: "Only the job evaluator may record the decision." },
  305: { contract: "escrow", name: "ERR_NOT_APPELLANT", message: "Only the losing party may appeal." },
  306: { contract: "escrow", name: "ERR_NOT_APPEAL_AUTHORITY", message: "Only the job's pinned appeal authority may resolve the appeal." },
  307: { contract: "escrow", name: "ERR_INVALID_PARTY", message: "Client, evaluator, provider, treasury and appeal authority must be distinct." },
  308: { contract: "escrow", name: "ERR_INVALID_BUDGET", message: "The budget is outside the contract bounds." },
  309: { contract: "escrow", name: "ERR_INVALID_DEADLINE", message: "The delivery or review window is outside the contract bounds." },
  310: { contract: "escrow", name: "ERR_INVALID_DESCRIPTION", message: "The description must not be empty." },
  311: { contract: "escrow", name: "ERR_INVALID_DECISION", message: "The decision must be approve (1) or reject (2)." },
  312: { contract: "escrow", name: "ERR_INVALID_HASH", message: "The hash must be a non-zero 32-byte digest." },
  313: { contract: "escrow", name: "ERR_DEADLINE_PASSED", message: "The job deadline has passed." },
  314: { contract: "escrow", name: "ERR_TOO_EARLY", message: "The window for this operation has not opened yet." },
  315: { contract: "escrow", name: "ERR_WINDOW_CLOSED", message: "The window for this operation has closed." },
  316: { contract: "escrow", name: "ERR_NOTHING_PENDING", message: "No reputation update is pending for this job." },
  400: { contract: "permissions", name: "ERR_NOT_DIRECT", message: "Allowances must be set by the party directly, not through a contract." },
  500: { contract: "agents", name: "ERR_NOT_AUTHORIZED", message: "The caller may not act for this wallet." },
  501: { contract: "agents", name: "ERR_ALREADY_REGISTERED", message: "This wallet already has an agent." },
  502: { contract: "agents", name: "ERR_NOT_REGISTERED", message: "This wallet has no agent." },
  503: { contract: "agents", name: "ERR_INVALID_NAME", message: "The agent name must not be empty." },
  600: { contract: "applications", name: "ERR_NOT_AUTHORIZED", message: "The caller may not act for this applicant." },
  601: { contract: "applications", name: "ERR_NOT_AGENT", message: "Only registered agents may apply." },
  602: { contract: "applications", name: "ERR_JOB_NOT_FOUND", message: "Job not found in the sBTC escrow." },
  603: { contract: "applications", name: "ERR_NOT_ACCEPTING", message: "The job no longer takes applications." },
  604: { contract: "applications", name: "ERR_STILL_ACCEPTING", message: "The job still takes applications; deposits cannot be released yet." },
  605: { contract: "applications", name: "ERR_INVALID_DEPOSIT", message: "The deposit is outside the contract bounds." },
  606: { contract: "applications", name: "ERR_ALREADY_APPLIED", message: "This agent already applied to the job." },
  607: { contract: "applications", name: "ERR_LIST_FULL", message: "The list is full and the deposit does not beat the lowest entry." },
  608: { contract: "applications", name: "ERR_NOT_APPLIED", message: "No application from this agent on the job." },
  609: { contract: "applications", name: "ERR_NOT_CLIENT", message: "Only the job client may decline applications." },
  610: { contract: "applications", name: "ERR_IS_CLIENT", message: "The client cannot apply to its own job." },
  611: { contract: "applications", name: "ERR_DECLINED", message: "The client declined this agent for the job." },
  612: { contract: "applications", name: "ERR_INELIGIBLE", message: "The evaluator, treasury and appeal authority cannot apply." },
};

export function describeNayoriNextError(
  code: bigint | number
): NayoriNextErrorInfo | undefined {
  return NAYORI_NEXT_ERRORS[Number(code)];
}

/** The 2% service fee the next escrows charge on settlement (budget / 50). */
export function quoteNayoriNextFee(budgetInput: AmountLike): {
  budget: bigint;
  fee: bigint;
  net: bigint;
} {
  const budget = toUint(budgetInput, "budget", true);
  const fee = budget / NAYORI_NEXT_LIMITS.feeDivisor;
  return { budget, fee, net: budget - fee };
}
