# Stacks x402 v2 foundation

Date: 2026-08-25
Status: approved foundation for implementation

## Milestone 2 alignment

Milestone 1 is approved and closed. This work must not redeploy, replace, or add fee behavior to
the M1 mainnet contracts. It is an additive SDK adapter intended to make the existing STX and sBTC
job lifecycle easier for external developers and agent frameworks to adopt during Milestone 2.

The authoritative M2 acceptance work remains the public SDK, working documentation and example,
external security review, recorded SDK demo, mainnet adoption, non-team participation, and external
technical feedback. This x402 foundation can support the SDK/example/adoption portions, but does
not by itself complete M2 and must not delay the security review or adoption outreach.

## Decision

Use the official `@x402/core` v2 envelope and HTTP header codecs, then implement a narrow Stacks
escrow adapter around the existing `PerkOSClient`. The first version represents a confirmed
`fund-job` transaction as the scheme-specific payment proof. It does not implement a hosted
facilitator, protocol revenue, metering, or a new smart contract.

The wire contract uses:

- x402 version `2`;
- `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE` header formats from
  `@x402/core/http`;
- CAIP-2 network identifiers `stacks:1` for mainnet and `stacks:2147483648` for testnet;
- scheme `exact` because the job budget is an exact atomic amount;
- asset transfer method `perkos-escrow-v1` to prevent a direct-transfer facilitator from
  misinterpreting an escrow requirement;
- payment flow `upfront` for the HTTP resource because the escrow must be confirmed before the
  protected endpoint proceeds. The later job completion remains governed by the existing neutral
  evaluator and escrow contract.

## Alternatives considered

### Keep the existing custom `X-X402-*` headers

This is the smallest code change, but it is not the current x402 v2 transport and makes ecosystem
integration harder. It is rejected for new SDK work. The application migration will happen only
after this SDK foundation is merged and tested.

### Adopt a third-party Stacks x402 package directly

`@t402/stacks` and `x402-stacks` provide useful reference implementations. Their transfer and
signer assumptions do not match the PerkOS job escrow lifecycle or the SDK's injected signer and
fail-closed spending policy. A direct dependency would create two signing/policy stacks. They are
not used in the foundation.

### Official x402 core plus a PerkOS Stacks adapter

This keeps the rapidly evolving transport and schemas with the x402 Foundation while retaining
PerkOS-specific escrow validation, exact post-conditions, Leather support, confirmation tracking,
and spending limits. This is the selected approach.

## Components

`src/x402.ts` will provide:

1. Network conversion between the SDK network names and Stacks CAIP-2 identifiers.
2. A payment-requirement builder derived from a resolved `PerkOSClient` configuration.
3. Strict parsing of PerkOS escrow requirements and confirmed-funding proofs.
4. `PerkOSX402SchemeClient`, an `@x402/core` scheme client that uses the existing SDK to inspect
   the job, enforce an exact budget, fund it through the configured signer, wait for terminal
   confirmation, and return a proof containing the transaction ID.
5. Re-exported x402 v2 header codecs so consumers do not recreate base64 JSON handling.

The adapter accepts a small structural client interface rather than a private key or wallet
implementation. The production `PerkOSClient` satisfies the interface; tests can provide a
deterministic in-memory client.

## Data flow

```text
Buyer agent                Resource server             Stacks
     | GET/POST resource          |                       |
     |--------------------------->|                       |
     | 402 + PAYMENT-REQUIRED     |                       |
     |<---------------------------|                       |
     | validate requirement       |                       |
     | inspect job/budget         |                       |
     | fundJob via SDK signer --------------------------->|
     | wait for confirmation ---------------------------->|
     | PAYMENT-SIGNATURE          |                       |
     | (confirmed tx proof)       |                       |
     |--------------------------->|                       |
     |                            | facilitator/verification is a later PR
```

The `PAYMENT-SIGNATURE` name is the x402 transport field for a scheme-specific payment payload.
For this foundation, its Stacks payload is a confirmed transaction proof rather than an EVM
EIP-3009 signature.

## Validation and failure handling

- Reject protocol versions other than v2.
- Reject non-Stacks or cross-network requirements.
- Require positive decimal atomic amounts and job IDs.
- Require the configured commerce contract as `payTo`.
- Require the configured sBTC asset identifier for sBTC and `STX` for STX.
- Require the on-chain job to exist, remain open, and have exactly the quoted budget.
- Reuse the SDK spending policy, signer/network checks, post-conditions, and confirmation tracker.
- Return a payload only after a `success` confirmation. Pending, abort, dropped, and timeout states
  are payment failures.
- Never accept a transaction ID as proof of payment without a later facilitator/server verifying
  the transaction, contract call, sender, amount, job, and replay status.

## Security boundary and known limitation

This PR creates and serializes payment proofs; it does not make an HTTP resource safe to monetize.
A production resource server still needs an independent Stacks facilitator/verifier and replay
store. The verifier must hydrate the transaction, match it to the accepted requirement, confirm
successful escrow funding, and prevent the same transaction from authorizing multiple purchases.

No secret, private key, treasury address, protocol fee, or production endpoint is introduced.

## Testing

The implementation will cover:

- CAIP-2 network mapping;
- STX and sBTC payment-requirement construction;
- official x402 header encode/decode round trips;
- invalid version, network, amount, asset, payee, metadata, and proof rejection;
- exact job-budget validation;
- successful confirmed funding through a fake client;
- failure on non-success terminal confirmations;
- compatibility with `@x402/core`'s `x402Client` registration and payload creation.

## Follow-up sequence

1. Merge this SDK foundation.
2. Build a read-only Stacks verifier/facilitator with replay protection and testnet evidence.
3. Replace the application's custom `X-X402-*` middleware with the SDK v2 adapter.
4. Add an M2 example/demo and use it for external developer feedback and adoption outreach.
5. Consider metering and protocol revenue only as a separate, reviewed product phase that does
   not alter the approved M1 contracts or block M2 acceptance.
