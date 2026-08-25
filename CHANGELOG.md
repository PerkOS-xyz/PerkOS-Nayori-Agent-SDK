# Changelog

All notable changes to `@perkos/agent-sdk` are documented here.

## Unreleased

### Added

- Official x402 v2 payment-requirement, signature, and response header codecs through
  `@x402/core`.
- Strict Stacks CAIP-2, escrow-contract, asset, job, and amount validation for STX and sBTC x402
  requirements.
- A client scheme adapter that validates the on-chain job, reuses SDK signing and spending policy,
  confirms escrow funding, and returns a transaction proof.
- A safe x402 header quickstart, protocol design record, and regression coverage.

### Security

- Documented that the client proof requires independent Stacks transaction verification and replay
  protection before a production resource server can authorize access.

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
