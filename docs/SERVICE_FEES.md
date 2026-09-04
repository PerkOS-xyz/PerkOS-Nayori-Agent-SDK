# Earned service fee integration (unreleased)

This source branch adds opt-in support for `agentic-commerce-v6` (STX) and
`sbtc-commerce-v5` (sBTC). These are **simnet candidates, not deployed defaults**.
The published `@perkos/agent-sdk@0.7.1` does not contain these new methods.
Do not point a production client at candidate names or treat a successful build as a deployment.
Existing v5/v4 jobs retain their full-budget, no-service-fee terms.

## Payment lifecycle

Funding locks the **gross** budget, including the potential 2% fee. Nothing is paid to
treasury at funding, submission, decision recording or appeal filing. Final evaluated
settlement atomically sends `floor(gross / 50)` to the job-pinned treasury and the remainder
to the provider on approval **or back to the client on rejection**. Both transfers use the
escrow asset. The settled escrow balance is zero.

No evaluation (expiry/review timeout) means no service fee. An evidence-backed waiver
before settlement also results in zero fee. Gas is separate, paid in STX. Optional extra
analysis would require a separately accepted x402 quote; that service is not implemented
and there is no automatic second 2% or payment prerequisite for filing an appeal.

## Read first, accept explicitly

After the exact candidate sources have been deployed and verified in isolated testnet,
configure their explicit same-network contract IDs in `PerkOSClient`. Do not guess a treasury:
read `getServiceFeePolicy(asset)` and `getJobServiceFee(asset, jobId)`.

```ts
// Uses the UNRELEASED source build, not npm 0.7.1.
// nayori is a client configured with reviewed contracts and a policy-limited signer.
const job = await nayori.getJob("sbtc", jobId);
if (!job) throw new Error("Job not found");
const policy = await nayori.getServiceFeePolicy("sbtc");
const fees = await nayori.getJobServiceFee("sbtc", jobId);

// Present gross, potential fee, net approval/net rejection, treasury and gas
// to the operator (or an approved deterministic agent spending policy).
// This object represents actual acceptance, not permission granted by this example.
const serviceFeeAcceptance = {
  gross: job.budget,
  basisPoints: 200 as const,
  treasury: fees.treasury,
  rejectionRefund: "net-after-evaluation" as const,
};

// Only after acceptance, with the CLIENT signer:
const broadcast = await nayori.fundJob({
  asset: "sbtc", jobId, amount: job.budget, serviceFeeAcceptance,
});
const confirmation = await nayori.confirm(broadcast);
if (confirmation.status !== "success") throw new Error("Funding not confirmed");

// The PROVIDER uses a separate client/signer and independently accepts the live
// budget/fee before submitWork({ asset, jobId, deliverable, serviceFeeAcceptance }).
```

`quoteServiceFee(gross)` performs exact uint128-safe bigint arithmetic but is only a local
quote. It does not prove a deployment, initialization, actual fee charge or refund.
Amounts below 50 atomic units round down to zero fee; no minimum job price is introduced.
See [`examples/service-fees.ts`](../examples/service-fees.ts) for a signer-free report helper.

## Methods and role boundaries

| Method | Behavior |
| --- | --- |
| `supportsServiceFees(asset)` | Known ABI capability, not verification of contract authenticity |
| `getServiceFeePolicy(asset)` | Validates initialization fields, fixed 200 bps, network-specific windows and treasury separation |
| `getJobServiceFee(asset, jobId)` | Validates ledger against the job, budget, roles and pinned treasury; read failures propagate |
| `fundJob(input)` | Requires accepted gross/bps/treasury/net-refund terms matching live state before wallet access |
| `submitWork(input)` | Requires the provider's matching acceptance before wallet access |
| `finalizeDecision`, `resolveAppeal`, `settleAppealTimeout` | Derive gross and split from live state; sBTC uses the job-pinned token |
| `initializeServiceFeeProtocol(input)` | Owner-signed, explicit treasury/authority; SDK requires testnet 3 or mainnet 144 appeal burn blocks |
| `waiveServiceFee(input)` | Job-pinned authority signs a nonzero 32-byte evidence hash; records an irreversible waiver |
| `refundServiceFee(asset, jobId)` | Treasury signs a real outstanding-fee return from its own balance; spending limits apply |

Only standard wallet principals can execute these signer-based administrative methods. A contract
principal treasury would require its own reviewed governance caller, not a forged wallet signer.
The authority decides whether evidence establishes platform fault; a changed appeal outcome alone
does not automatically waive a fee. The SDK does not make that decision for an operator.

## Accounting is not a quote

- `feeAmount` is the potential budget quote, never collected revenue.
- No `settlement`: no earned fee has been collected.
- `settlement.chargedFee - settlement.refundedFee`: fee retained after actual returns.
- `settlement.net + settlement.refundedFee`: total delivered to the economic recipient.
- Waiver plus an outstanding charged fee: a refund obligation, **not a completed refund**.

A treasury without funds or an available signer cannot complete a refund. Maintain refund
reserves and an operational process before launch. Replay attempts are rejected by the contract.
Internal test-wallet transactions are not externally earned revenue or adoption.

## Post-conditions and trust

Decision settlements use one exact **gross escrow outflow** post-condition per asset, not separate
net/fee conditions on the same sender. Treasury refunds instead constrain the treasury's exact
fee outflow. Deny mode is retained. Post-conditions constrain aggregate outflow, not recipients;
verify contract sources and canonical transfer events independently after confirmation.

`plan.intent.serviceFee` is disclosure metadata, not a signed enforcement mechanism. Synchronous
builders cannot read the chain: their caller must supply already-verified state, token and split.
Prefer high-level client methods. Neither `execute` nor a custom RPC can establish the authenticity
of an arbitrary caller-selected contract. Custody allowlists and source verification remain required.
Funding/refund session limits count broadcasts conservatively, not final revenue.

Direct x402/MPP single-transfer verification is unchanged and must not be relaxed for escrow splits.

Reference: [Stacks post-conditions](https://docs.stacks.co/post-conditions/examples).
