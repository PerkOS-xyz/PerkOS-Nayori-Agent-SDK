import { PerkOSError } from "./errors.js";
import type {
  ContractCallPlan,
  PaymentAsset,
  ResolvedPerkOSConfig,
  SpendingApproval,
  SpendingPolicyInput,
} from "./types.js";
import { toUint } from "./validation.js";

type AmountLimits = Partial<Record<PaymentAsset, bigint>>;

function limitsFrom(
  input: Partial<Record<PaymentAsset, bigint | number | string>> | undefined,
  field: string
): AmountLimits {
  const result: AmountLimits = {};
  for (const asset of ["sbtc", "stx"] as const) {
    const value = input?.[asset];
    if (value !== undefined) result[asset] = toUint(value, `${field}.${asset}`);
  }
  return result;
}

export class SpendingPolicy {
  private readonly allowedNetworks: ReadonlySet<string>;
  private readonly allowedContracts: ReadonlySet<string>;
  private readonly allowedAssets: ReadonlySet<string>;
  private readonly maxPerTransaction: AmountLimits;
  private readonly maxPerSession: AmountLimits;
  private readonly spent: Record<PaymentAsset, bigint> = { sbtc: 0n, stx: 0n };

  constructor(config: ResolvedPerkOSConfig, input: SpendingPolicyInput = {}) {
    this.allowedNetworks = new Set(input.allowedNetworks ?? [config.network]);
    this.allowedContracts = new Set(
      input.allowedContracts ?? [
        config.contracts.agentRegistry,
        config.contracts.stxCommerce,
        config.contracts.sbtcCommerce,
        config.contracts.reputationRegistry,
      ]
    );
    this.allowedAssets = new Set(input.allowedAssets ?? ["sbtc", "stx"]);
    this.maxPerTransaction = limitsFrom(input.maxPerTransaction, "maxPerTransaction");
    this.maxPerSession = limitsFrom(input.maxPerSession, "maxPerSession");
  }

  authorize(plan: ContractCallPlan): SpendingApproval {
    if (!this.allowedNetworks.has(plan.network)) {
      throw new PerkOSError("POLICY_DENIED", `Network ${plan.network} is not allowed.`);
    }
    if (!this.allowedContracts.has(plan.contract)) {
      throw new PerkOSError("POLICY_DENIED", `Contract ${plan.contract} is not allowed.`);
    }

    const { asset, amount } = plan.intent;
    if (!asset || amount === undefined || amount === 0n || plan.intent.operation !== "fund-job") {
      return { operation: plan.intent.operation, ...(asset ? { asset } : {}) };
    }
    if (!this.allowedAssets.has(asset)) {
      throw new PerkOSError("POLICY_DENIED", `Asset ${asset} is not allowed.`);
    }

    const transactionLimit = this.maxPerTransaction[asset];
    const sessionLimit = this.maxPerSession[asset];
    if (transactionLimit === undefined || sessionLimit === undefined) {
      throw new PerkOSError(
        "POLICY_LIMIT_REQUIRED",
        `Funding ${asset} requires maxPerTransaction.${asset} and maxPerSession.${asset}.`
      );
    }
    if (amount > transactionLimit) {
      throw new PerkOSError(
        "POLICY_DENIED",
        `Funding amount ${amount} exceeds the ${asset} per-transaction limit ${transactionLimit}.`
      );
    }
    const nextSpent = this.spent[asset] + amount;
    if (nextSpent > sessionLimit) {
      throw new PerkOSError(
        "POLICY_DENIED",
        `Funding would exceed the ${asset} session limit ${sessionLimit}.`
      );
    }
    return {
      operation: plan.intent.operation,
      asset,
      amount,
      spentThisSession: this.spent[asset],
      remainingThisSession: sessionLimit - nextSpent,
    };
  }

  record(plan: ContractCallPlan): void {
    const { asset, amount, operation } = plan.intent;
    if (operation === "fund-job" && asset && amount !== undefined) {
      this.spent[asset] += amount;
    }
  }

  spentThisSession(asset: PaymentAsset): bigint {
    return this.spent[asset];
  }
}
