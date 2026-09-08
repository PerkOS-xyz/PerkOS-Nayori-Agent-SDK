# Confirmation policy and workflow timing

Source candidate after 0.8.0-rc.1; **not yet published or deployed**. The immutable npm
0.8.0-rc.1 package and every version-1 custody permit retain six additional Bitcoin burn blocks.
Do not edit an installed package, an active permit or its journal to accelerate an existing run.

## Three independent clocks

- Transaction confirmation: operator policy for observing canonical successful transactions.
- Evaluation: the on-chain review window is a maximum response window, not a promised LLM latency.
- Appeal and payment: the contract controls eligibility; feedback can be visible before payout.

Stacks confirmations and Bitcoin burn blocks are different. Six additional burn blocks are a
conservative application policy, not a universal Stacks consensus requirement. See the official
[Bitcoin finality documentation](https://docs.stacks.co/learn/block-production/bitcoin-finality).
Estimates use 600 seconds per burn block, are not guaranteed, and exclude mempool/LLM latency.

## Operator configuration

The new pure helpers support both networks. Defaults remain 6/6. Mainnet accepts 6–144 additional
burn blocks; testnet accepts 0–144. Settlement cannot be weaker than workflow. Zero means a
canonical, anchored, successful transaction is still required, but no extra burn block is waited.
These are conservative product limits, not a claim of zero reorganization risk.

```ts
import { parseConfirmationPolicy, confirmationProgress } from '@perkos/agent-sdk';
const policy = parseConfirmationPolicy('testnet', {
  workflowBurnBlocks: 0,
  settlementBurnBlocks: 6,
});
// observation must come from the configured, network-validated chain reader, never an LLM.
const progress = confirmationProgress('testnet', policy, 'workflow', savedTxid, observation);
// ready, remainingBurnBlocks, requiredBurnHeight, estimatedSeconds, estimateIsGuarantee
```

The helper does not sign, broadcast or configure `TransactionTracker`, x402/MPP, a wallet or
the platform facilitator. Integrators must enforce their chosen policy at their own signer boundary.
For mainnet use the same helper with `'mainnet'` and at least 6/6; the Hermes custody pilot
remains testnet-only and must not be repurposed as a production signer.

## Version-2 QA custody permits

For a **new authorized run**, the operator uses the same permit fields plus:

```json
{
  "version": 2,
  "confirmationPolicy": { "workflowBurnBlocks": 0, "settlementBurnBlocks": 6 }
}
```

This is a fragment, not a complete permit. The parser fixes field order, validates and freezes
the policy, and includes it in the permit hash. Version 1 preserves its original hash and behavior.
MCP execution arguments cannot supply policy overrides. A changed policy cannot reopen the same
journal. Never delete that journal to reset allowance or migrate an in-flight run.

`nayori_custody_status` exposes the effective `confirmationPolicy` and per-action
`confirmationProgress` after reconciliation. `finalize` uses the settlement threshold; other
pilot operations use workflow. Confirmed prior transactions are rechecked before another action.
Pending, aborted, noncanonical or inconsistent observations do not advance the workflow; ambiguous
broadcasts never trigger a second signature. Gas and LLM allowances remain separately enforced.

## Read the actual job deadlines

Before accepting work, use `getReviewWindow(asset)` and `getAppealWindow(asset)` on the selected
contracts. After submission, `getJob(asset, id)` exposes `reviewDeadline`; after evaluation,
`getDecision(asset, id)` exposes `appealDeadline` and any `resolutionDeadline`.
Finalization/timeout requires current burn height **strictly greater** than the relevant deadline,
plus role, state, asset and escrow verification. A passed deadline is not a settlement receipt.
Current contract windows are not user-editable per job; this change deploys no contracts.

The companion Web candidate exposes `GET /api/v1/workflow-timing?asset=sbtc&jobId=15` on the
selected environment. Its operator baseline is disclosure only; the bound signer permit wins.
An unavailable clock is not zero waiting time. New source availability is not evidence of a
completed funded E2E or external adoption.
