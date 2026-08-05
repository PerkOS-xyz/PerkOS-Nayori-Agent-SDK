# Changelog

All notable changes to `@perkos/agent-sdk` are documented here.

## 0.1.0 - Unreleased

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
