# Changelog

All notable changes to `@perkos/agent-sdk` are documented here.

## Unreleased

## 0.5.1 - 2026-08-30

### Fixed

- Update only the Stacks testnet USDCx identity to the contract currently registered by Circle
  xReserve remote domain `10003` and proven by an official successful bridge mint:
  `ST2WK9SGBJ15RHZ33KK0KYVSXBEBHM1XDM8C96EC4.usdcx`. Mainnet remains unchanged.
- Keep x402 and MPP challenge, intent, post-condition and verifier construction on the same exact
  SIP-010 asset so clients cannot sign an obsolete testnet token while the facilitator expects the
  current bridge output.

### Added

- Record the source-verified v4/v3 Stacks testnet deployment under
  `ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5`, STX 27/27 and official PoX-5 sBTC 30/30 complete
  evidence, while retaining explicit overrides and unchanged published defaults.
- Record the v3 12-block timeout proof: preparation 20/20, settlement 12/12 and public-state
  verification 10/10; job `u2` ended `timeout-paid` (`u6`) with zero escrow, one exact sBTC payout
  and no completion, reputation or rating credit.
- Explicit support for the 12-burn-block `agentic-commerce-v4` and `sbtc-commerce-v3` review
  candidate while preserving compatibility with the immutable 144-block v3/v2 generation.
- Candidate-aware job parsing for Bitcoin submission/review heights and the distinct
  `timeout-paid` (`u6`) terminal state.
- Exact deny-mode STX/sBTC `settleReviewTimeout` plans and high-level client execution after the
  candidate contract's evaluator deadline.
- Durable reputation synchronization reads and permissionless `retryReputationSync` plans.
- Versioned Clarity error mappings and same-network contract-override guidance while leaving all
  published deployment defaults unchanged.

### Security

- Keep published deployment defaults unchanged; v4/v3 contract selection remains an explicit,
  same-network override that is safe only after source-verified deployment.
- Timeout settlement reads the current escrow, provider, and job-pinned sBTC token before
  constructing a contract-principal post-condition for the exact amount and funded token.
- Reputation retry has no asset transfer and remains deny-mode. The SDK does not interpret a
  timeout payout as completion or reputation evidence.

## 0.5.0 - 2026-08-28

### Added

- A standards-based MPP PaymentAuth adapter for `method="usdc"`, `intent="charge"` and the direct
  USDCx on Stacks profile, separate from the existing x402 routes.
- RFC 8785 canonical challenge, credential and receipt codecs; `WWW-Authenticate: Payment`
  challenges select `Payment-Authorization` so OAuth Bearer credentials remain independent.
- Official mainnet and testnet USDCx method details, CAIP-10 payer sources, base64 SIP-005
  transaction credentials and `Payment-Receipt` settlement pointers.
- An MPP-specific unsigned transaction builder that reuses the existing payer intent and spending
  policy while selecting the required `OnChainOnly` anchor mode.
- Public integration documentation and a safe offline MPP/USDCx quickstart.

### Security

- Bind each MPP challenge to a trusted Nayori quote and actual protected request, including HTTP
  body digest, amount, recipient, asset, merchant and expiry.
- Reuse exact SIP-010 transfer, memo, signature and post-condition verification, adding strict
  profile fields, canonical envelopes, standard single-signature authorization and low-s signing.
- Keep sponsorship disabled and leave live nonce/balance checks, durable replay reservation,
  broadcast, confirmation and delivery at the hosted Platform boundary.

## 0.4.0 - 2026-08-28

### Added

- `NayoriPartnerClient` for invitation-bound wallet challenges, one-time OAuth client enrollment,
  minimum-scope client-credentials tokens and authenticated MCP JSON-RPC calls.
- `createStacksConnectPartnerSigner` adapter for Leather-compatible `stx_signMessage` responses
  without giving the SDK wallet key material.
- Partner-pilot documentation covering exact-message review, one-time secret handling, scopes,
  MCP tools and the separate wallet payment-signing boundary.

### Security

- Normalize and validate recoverable signatures and compressed public keys before registration.
- Keep OAuth credentials caller-owned: the SDK does not persist, log, refresh or treat them as
  payment authorization.

## 0.3.2 - 2026-08-27

### Fixed

- Treat the payment intent fee as a strict upper bound when an interactive wallet returns a lower
  positive origin fee. Fees above the authorized value and zero fees continue to fail closed;
  payer, nonce, amount, recipient, memo and non-sponsored authorization remain exact.
- Commit the independently verified origin fee to session usage while reserving the full authorized
  fee during asynchronous signing. This preserves concurrent fee caps and reports actual spend.
- Cover Leather-compatible lower-fee signing, out-of-bounds rejection, reservation release and
  actual-fee policy accounting.

## 0.3.1 - 2026-08-27

### Fixed

- Accept the canonical initial Stacks account nonce `0` when constructing an x402 payment intent.
  Amounts, fees, limits and other positive-only fields remain unchanged, while negative or
  malformed nonces continue to fail closed.
- Cover a complete STX payer flow that builds, signs and independently verifies a transaction with
  origin nonce `0`, plus rejection of negative nonce input.

## 0.3.0 - 2026-08-27

### Added

- Deterministic, request-bound x402 `PaymentIntent` construction for direct STX, sBTC, and USDCx
  payments, including explicit payer, fee, nonce, quote fingerprint, and expiry.
- A concurrency-safe, fail-closed payment policy with network, asset, recipient, origin, merchant,
  per-transaction, per-session, fee, and remaining-quote-validity controls.
- `LeatherSigner` using Stacks Connect `stx_signTransaction` with `broadcast: false`, plus a
  `PolicySigner` callback for KMS/HSM/isolated wallet services that never supplies a private key to
  the SDK.
- `NayoriX402PaymentClient`, which builds a canonical unsigned transaction, reserves policy budget,
  delegates signing, independently verifies the result, and emits the hosted facilitator body
  without broadcasting.
- An offline payer quickstart and integration guide for interactive wallets and automated agents.

### Security

- Re-verify signer output against the trusted quote and exact request, including origin signature,
  payer, fee, nonce, amount, recipient, asset, memo, deny mode, and post-conditions.
- Reserve concurrent amount and fee usage before signing, release on failure, and permanently count
  valid signatures against the in-process session budget.
- Freeze cloned quote, request, requirement, payment payload, and settlement structures to avoid
  caller mutation across asynchronous wallet or remote-signer boundaries.

## 0.2.0 - 2026-08-26

### Changed

- Renamed the existing GitHub repository from `PerkOS-Agent-SDK` to
  `PerkOS-Nayori-Agent-SDK` without changing the public npm package name or its API. GitHub
  history, releases, issues, pull requests, and legacy URL redirects remain intact.

### Added

- A compatibility-first `stacks-signed-tx-v1` x402 profile for direct STX, sBTC, and USDCx
  payments, with canonical internal CAIP-19 identities and explicit `upfront` semantics.
- Short-lived canonical request quotes and deterministic 31-byte memo fingerprints binding method,
  URL, body digest, network, asset, exact amount, recipient, merchant, and expiry.
- A side-effect-free signed-transaction verifier for canonical Stacks encoding, origin signature,
  payer, network, exact STX/SIP-010 transfer templates, memo, deny mode, and exact post-conditions.
- Deterministic quote vectors and adversarial coverage for request, requirement, network, signature,
  asset, recipient, amount, memo, contract, function, and post-condition tampering.

- Official x402 v2 payment-requirement, signature, and response header codecs through
  `@x402/core`.
- Strict Stacks CAIP-2, escrow-contract, asset, job, and amount validation for STX and sBTC x402
  requirements.
- A client scheme adapter that validates the on-chain job, reuses SDK signing and spending policy,
  confirms escrow funding, and returns a transaction proof.
- A safe x402 header quickstart, protocol design record, and regression coverage.
- A Stacks x402 facilitator that independently verifies current Hiro v3 transaction/event
  evidence, exact escrow funding and confirmation freshness before settlement.
- An injected atomic replay-store contract, process-local implementation for demos/tests, and a
  public fail-closed facilitator quickstart using historical mainnet evidence.

### Security

- Kept direct-payment verification separate from merchant authentication, signed-quote trust,
  durable replay/idempotency, balance/nonce preflight, simulation, sponsorship, broadcast,
  confirmation, and resource delivery; those remain mandatory hosted-facilitator boundaries.
- Omit a final `transactionId` for origin-signed sponsored payments until the sponsor adds its
  signature, preventing an incomplete transaction hash from being represented as a network txid.

- Documented that the client proof requires independent Stacks transaction verification and replay
  protection before a production resource server can authorize access.
- Documented the remaining bearer-proof front-running boundary and the requirement for durable
  shared replay storage and request binding before high-value production use.

## 0.1.0 - 2026-08-24

### Added

- Validated mainnet and testnet deployment configuration.
- Read-only client for agents, jobs, escrow balances, payment-token configuration, and reputation.
- Transaction-plan builders for agent registration and the complete STX/sBTC job lifecycle.
- Exact funding and settlement post-conditions.
- Pluggable signer interface with structured transaction receipts.
- Included headless signer with an on-demand external key provider.
- Included Stacks Connect signer adapter for Leather and compatible browser wallets.
- Normalized transaction tracking with bounded polling, cancellation, terminal statuses, block
  metadata, and Clarity result fields.
- Client helpers to confirm a broadcast or execute and return a combined confirmation receipt.
- Fail-closed spending policy with per-transaction and per-session limits.
- Read-only mainnet quickstart and an opt-in transactional sBTC testnet lifecycle using distinct
  client, provider, and evaluator roles.
- Safe dry-run mode for the transactional quickstart, enabled by default.

### Fixed

- Resolve the package self-reference to source during development so clean CI environments can
  typecheck the quickstart before `dist/` exists.
- Reject malformed signer results instead of accepting non-transaction identifiers as broadcasts.
- Use the Stacks node `/v2/info` endpoint for the transactional quickstart chain height and cover
  the request with a regression test.
- Hydrate terminal Clarity results from transaction detail when the v3 status response returns a
  null result.
