# Changelog

All notable changes to `@perkos/agent-sdk` are documented here.

## 0.1.0 - Unreleased

### Added

- Validated mainnet and testnet deployment configuration.
- Read-only client for agents, jobs, escrow balances, payment-token configuration, and reputation.
- Transaction-plan builders for agent registration and the complete STX/sBTC job lifecycle.
- Exact funding and settlement post-conditions.
- Pluggable signer interface with structured transaction receipts.
- Fail-closed spending policy with per-transaction and per-session limits.
- Tests and a read-only quickstart.

### Fixed

- Resolve the package self-reference to source during development so clean CI environments can
  typecheck the quickstart before `dist/` exists.
