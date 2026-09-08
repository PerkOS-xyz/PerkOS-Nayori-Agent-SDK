# Hermes QA checkpoints and confirmation handling

This is an **unreleased QA candidate**, not a completed funded autonomous E2E certification.
One supervised internal sBTC lifecycle is verified in [validation and release boundaries](VALIDATION_AND_RELEASE.md).
Use your existing agent and LLM. Keep the wallet and policy signer under your control, outside
the model process. Follow [existing-agent onboarding](EXISTING_AGENT.md), then the
[buyer](HERMES_BUYER.md) or [provider](HERMES_PROVIDER.md) manual.

## Fund wallets before enabling execution

Wallet funding is not agent registration and is not escrow funding. Derive and verify each
public address from its own signer, test recovery and inspect balances on the intended network.
Do not fund example addresses or send money to a provider as a substitute for `fund-job`.

For the bounded sBTC QA walkthrough:

| Role | Initial wallet budget | What it authorizes |
| --- | --- | --- |
| Buyer | 1000 **atomic sBTC units** plus 30000 micro-STX | One escrow budget and six actions at 5000 micro-STX gas each |
| Provider | 10000 micro-STX | Registration and submission at 5000 micro-STX each |
| Evaluator / appeal authority | Separately operated | Neither participant receives these keys or spending permissions |

These are pilot caps, not a live fee estimate or guaranteed inclusion price. Funding transfers
also cost gas to their sender and are outside those recipient budgets. The provider needs no
sBTC deposit to receive an approved payout. Verify the canonical token principal, not just its
ticker. The candidate accepts STX or sBTC escrow; direct USDCx resource payments are separate.

## Track these checkpoints independently

| Checkpoint | Required evidence | Does not prove |
| --- | --- | --- |
| Wallet ready | Correct network/address, recovery and asset/gas balances | Registration or escrow |
| Tools ready | Real discovery, role context and bounded signer status | A chain transaction |
| Signed / broadcast | Durable intent and saved txid | Canonical success or confirmation depth |
| Registered | Successful registry call, returned agent ID and matching active record | A created or funded job |
| Job funded | Confirmed job ID, criteria commitment, assigned provider, exact asset and escrow | Delivered work |
| Work submitted | Confirmed evidence commitment and retrievable matching bytes | Evaluator approval |
| Decision pending | On-chain decision and explanation hashes, appeal deadline | Payment or final reputation |
| Settled | Terminal state, zero escrow, exact transfer events and reputation state | External adoption by itself |

## Six-burn confirmation gate

The QA custody pilot keeps an operation `signed` until its transaction is canonical, anchored
and successful **and six subsequent Bitcoin burn blocks have arrived**. For a transaction in
burn block `B`, the condition is `currentBurn >= B + 6`. This is not six Stacks blocks, not six
seconds and not an estimate of wall-clock completion. A success shown by an explorer may precede
the custodian's `confirmed` state. The SDK's general confirmation tracker and this custody gate
are different policies; do not assume all SDK methods apply this depth automatically.

Call `nayori_custody_status` to reconcile the existing journal. Do not call `nayori_execute`
again to force confirmation, change the nonce, delete state, replace the permit, or increase the
gas budget. A reserved operation without a txid, an abort, unavailable RPC or uncertain broadcast
requires operator investigation. Keep the same journal and saved txid; there is no automatic
fee bump or automatic rebroadcast. Six burn blocks reduce, but do not eliminate, reorg risk.

## Role handoff and outcome

The buyer completes registration, creation, budget, funding and assignment one action at a time.
Issue the provider's permit only after independently verifying the real job ID, identities,
criteria, expiry, token and exact funded escrow. Never use a synthetic job ID in a funded permit.
The provider's pilot permit is job-bound; it then registers and submits with its own signer.

If the identity is already registered, verify the active record and reuse it; omit registration
from the permit and recalculate the cap. The verified repeat cycle used five buyer actions
(25000 micro-STX) and one provider submission (5000 micro-STX), excluding incoming funding and
the evaluator's own gas. These do not replace the first-registration budgets above.

Preserve the submitted evidence bytes. An evaluator decision does not move escrow. Wait through
the job's actual appeal deadline and respect any appeal; do not replace the chain deadline with
a timer in your agent. Approved gross 1000 atomic sBTC under the QA 200 bps policy settles as
980 to the provider and 20 to the job-pinned treasury. Verify events rather than calculating
an expected amount and reporting it as paid. Production contract generations may differ.

## Isolation, evidence and video

Restrict the signer's outbound transport to the approved testnet RPC. Keep the model process
away from key files, writable permits/journals, the Docker socket and privileged shell access.
An operator-owned restricted relay is one deployment option, not an SDK-managed custody service.
RPC reachability is not authorization; the signer still validates every operation and budget.

Save public network, source/artifact hashes, permit hash, agent/job IDs, txids, block heights and
verification results. Keep secrets, private host paths and internal logs out of published docs
and recordings. Label shortened waiting periods in the video. Team-operated testnet participants
are internal QA, not independent mainnet adoption.

The local Hermes MCP does not purchase x402 resources. [x402](X402_PAYMENTS.md) needs a separate
permission, budget, confirmed payment and delivered-resource receipt; evaluation admission does
not create a second payment. Record that gate separately from the escrow workflow.
