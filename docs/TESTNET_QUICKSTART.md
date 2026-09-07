# Role-separated agent onboarding — QA candidate

This guide describes the QA candidate, not a published npm release. The role-separated
SDK/committed-evaluation flow has completed controlled STX and sBTC testnet jobs; this
does not certify a live Hermes installation or external adoption.
Use Node.js 22 and the reviewed QA commit. Do not point it at mainnet.
The app's default deployments, production and the published package are unchanged.

## Roles and custody

- Buyer: owns criteria, creates the job, sets its budget, funds escrow and assigns a provider.
- Provider: owns its wallet, performs the work and submits the committed evidence manifest.
- Evaluator service: verifies chain state and downloaded evidence, then records its decision.
- Human appeal authority: handles disputes; it is not installed in either participant agent.

Create separate testnet wallets with your custody provider. Keep each key in its own signer
boundary, fund only the required test tokens and STX gas, and never share the evaluator key.
The example imports an **operator-selected absolute module path** exporting a `PerkOSSigner`
named `signer`. Do not let an LLM or external job select that module. Its implementation must
restrict network, contracts, operation, nonce and gas fees and durably account for wallet spending.
SDK spending policies are per process and do not replace persistent custody limits.
The separate [Hermes MCP adapter](HERMES_MCP.md) defaults to read/prepare only. Optional
[bounded custody delegation](HERMES_CUSTODY.md) is a QA source candidate for wallet-enabled
actions; it still requires review, deployment, Linux isolation and actual Hermes E2E validation.

## Install and preview

From the reviewed SDK source checkout:

```bash
npm ci
npm run verify
npm run quickstart:testnet
```

The last command defaults to offline preview; it does not load a signer or call a network.
For clean-consumer testing, build and pack the candidate, then install that tarball in a
separate project with Node 22 and `tsx`. Do not publish or overwrite npm 0.7.1.

## Supply real job inputs

Keep a JSON config **outside Git**, with one copy for each role. Required fields:

| Field | Value |
|---|---|
| network / asset | `testnet` / `stx` or `sbtc` |
| role | `client` or `provider` |
| client / provider / evaluator / treasury | Four distinct real testnet principals; evaluator and treasury must match QA policy |
| amount | Decimal string in micro-STX or satoshis; example cap 100000 or 1000 respectively |
| expiredAt | Future **Stacks block height**, not burn height or Unix time |
| description | Real ASCII work description, at most 428 characters |
| acceptanceCriteria | Array of `{ id, requirement, verification }` fixed by the buyer before creation |
| jobId | Confirmed job ID, required after creation |
| evidence | Provider's real `{ id, uri, sha256, mediaType, sizeBytes }` manifest |
| agentName | Optional real participant name |

Use the configured QA evaluator's evidence origin allowlist. Automatic review initially supports
up to five HTTPS UTF-8 text/plain or application/json files, 8192 bytes per file, 16000 bytes total.
Hash the exact downloaded bytes; no fake URLs or invented deliverables. Public manifests and
chain commitments must never contain secrets. Preserve the original criteria file for both roles.

## Run one step at a time

Set `PERKOS_RUN_CONFIG`, `PERKOS_JOURNAL` and `PERKOS_SIGNER_MODULE` to absolute paths outside Git.
Use a dedicated journal per role and run. Enable `PERKOS_CONFIRM_TESTNET_BROADCAST=yes` only for
the intended operation. Funding and submission also require
`PERKOS_ACCEPT_SERVICE_FEE=200bps-net-after-evaluation`.

```bash
PERKOS_ACTION=register npm run quickstart:testnet
PERKOS_ACTION=create npm run quickstart:testnet
```

Both participants register using their own process. Only the buyer creates. Copy the confirmed
`(ok uN)` job ID from creation into both role configs, then execute separately:

1. Buyer: `set-budget`, then `fund`, then `assign`.
2. Provider: do the actual work, prepare the real evidence manifest, then `submit`.
3. Either role: `evaluate` against an explicitly configured `PERKOS_EVALUATOR_URL` QA origin.
4. Either role: `status`. It is read-only and needs no signer or broadcast opt-in.
5. Buyer: `finalize` only after decision-pending, no appeal, and current burn height strictly
   greater than the appeal deadline. Disputes require the appeal workflow, not bypassing this gate.

A `202` response means admitted, not approved. Poll the returned evaluation ID at
`GET /v1/evaluations/{id}` and inspect the on-chain job. A recorded decision does not transfer
escrow. On finalization, independently verify the 98/2 provider/treasury split (or evaluated
rejection refund), zero escrow and reputation sync. Gas is additional, paid by each transaction signer.
The 2% fee is earned on evaluation and stays in escrow until settlement; no extra appeal fee is added.

## Commitments without new contracts

`prepareEvaluationJob(input)` returns the description plus a versioned SHA-256 criteria marker.
`prepareEvaluationSubmission(input)` returns a 36-byte deliverable: ASCII `ny1:` and the raw
32-byte evidence digest, fitting existing `(buff 64)` contracts.

Both use fixed projected JSON fields, lexicographically sorted keys, ordered arrays, UTF-8 and
distinct hash domains. Criteria bind network/asset/contract/client/evaluator/description.
Evidence additionally binds job ID, provider and criteria hash. Do not reorder arrays, normalize
text or change manifests after signing. `evaluationJobId` derives a deterministic job-scoped
request identifier; it is **not** a credential.

Hashes protect manifest integrity, not evidence truth. Only the on-chain client can commit the
criteria and only the assigned provider can submit the evidence. Public HTTP callers may trigger
verification of those exact commitments, but cannot change criteria, spend participant wallets
or force the evaluator to approve.

## Recovery and limitations

The append-only mode-600 journal records an attempt before signing and stores the txid before
confirmation. Repeating an identical invocation confirms that txid instead of signing again.
Changed action inputs, a stale lock, malformed journal or ambiguous attempt fail closed.
Never delete checkpoints to force a retry: reconcile the wallet nonce and transaction history first.
Ambiguous signing failures require operator reconciliation; no exactly-once
network guarantee is claimed. A dry preview is not an on-chain E2E test.

The evaluator public writer defaults off; controlled QA has enabled bounded admission and
passed database/restart and two-role STX/sBTC E2E gates. Isolated live Hermes integration,
x402-protected API walkthrough and recorded demo remain separate gates.
The existing x402/MPP clients are separate from this escrow evaluation trigger;
this route does not introduce another payment or imply x402 coverage was tested here.
