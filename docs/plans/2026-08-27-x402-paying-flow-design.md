# Nayori x402 paying flow design

Date: 2026-08-27

Status: approved for implementation

## Objective

Add a payer-side TypeScript flow for Nayori's direct Stacks x402 profile. The same immutable
payment intent must support an interactive Leather wallet and an automated agent whose key stays
inside an application-owned KMS, HSM, secret manager, or wallet service. The SDK prepares and
validates the payment; it does not broadcast. The Nayori facilitator remains the only component
authorized to reserve and broadcast a submitted payment.

This increment does not modify or redeploy the approved Milestone 1 contracts, enable Platform
settlement, or claim Milestone 2 transaction/adoption evidence.

## Constraints and external behavior

- Direct payments use the existing `stacks-signed-tx-v1` profile for STX, sBTC, and USDCx.
- `PaymentIntent` is deterministic, serializable, request-bound, and contains no private material.
- The SDK must validate the trusted quote, accepted x402 requirement, request digest, payer,
  recipient, asset, atomic amount, fee, nonce, signature, memo, and post-conditions before returning
  settlement input.
- A signer receives only an immutable intent and the canonical unsigned transaction.
- Leather integration uses the current Stacks Connect `stx_signTransaction` method with
  `broadcast: false`; a missing signed transaction is a failure even if a wallet returns a txid.
- Headless integration delegates signing to an application callback. The SDK never accepts,
  requests, stores, or logs the agent's private key.
- Spending policy is mandatory and fail-closed. An LLM or agent cannot override its decision.
- Session limits count signed authorizations, not confirmed settlements. This conservative rule
  prevents repeated signing after an ambiguous network result.

## Public API

The new module exports:

- `NayoriX402PaymentIntent` and `createNayoriX402PaymentIntent`;
- `NayoriX402PaymentPolicy`, its explicit configuration, and read-only session usage;
- `NayoriX402PaymentSigner` as the common signer contract;
- `LeatherSigner`, a Stacks Connect callback adapter;
- `PolicySigner`, a remote/headless signing callback adapter;
- `NayoriX402PaymentClient`, which builds, authorizes, signs, verifies, and returns the exact input
  accepted by the hosted `/v1/x402/settle` route.

The client input contains the signed quote bundle returned by Nayori, the protected request, fee,
and nonce. Address and compressed public key come from the signer. The output contains
`signedQuote`, `paymentRequirements`, `paymentPayload`, `request`, and locally verified payment
metadata. It never broadcasts.

## Intent and transaction construction

Intent construction first normalizes the quote and proves that:

1. the protected method, canonical URL, and body digest match the quote;
2. the accepted x402 requirement is exactly the requirement derived from that quote;
3. the quote is currently valid with the configured clock-skew allowance;
4. the signer's compressed public key derives the declared Stacks payer address;
5. fee and nonce are canonical unsigned integers.

The intent ID is a SHA-256 digest over a domain-separated canonical representation containing the
quote fingerprint, payer, public key, fee, and nonce. The signed transaction is constructed as:

- STX: a native token transfer with the quote fingerprint in the memo;
- sBTC/USDCx: the canonical SIP-010 `transfer` call with the payer and recipient principals, the
  fingerprint in the optional memo, deny mode, and one exact fungible-token post-condition.

All three paths are standard, non-sponsored transactions. Fee and nonce are provided explicitly so
transaction preparation is deterministic and performs no hidden network request.

## Policy and concurrency

Policy configuration explicitly lists allowed networks, assets, recipients, and HTTPS origins,
plus per-transaction and per-session atomic limits for every allowed asset and a maximum fee in
micro-STX. Optional merchant IDs and a minimum remaining quote lifetime further narrow authority.

Authorization reserves both payment amount and fee synchronously before asynchronous signing. The
reservation is committed after a valid signed transaction is produced, or released if building,
signing, or local verification fails. Active reservations are included in session-limit checks, so
concurrent agent calls cannot oversubscribe the budget. A committed intent cannot be signed again
by the same policy instance.

## Signer boundaries

`LeatherSigner` is configured with the connected address, compressed public key, and an injected
Stacks Connect-compatible request function. It calls only:

```text
stx_signTransaction({ transaction: unsignedHex, broadcast: false })
```

`PolicySigner` is configured with the same public identity and a remote callback. That callback may
talk to a KMS/HSM/wallet service and must return a fully signed serialized transaction. No example
introduced for this payer flow uses an environment variable or local raw private key. The older,
explicitly opt-in escrow lifecycle example remains separate from this x402 custody boundary.

Neither signer result is trusted. The client runs the existing pure x402 verifier and additionally
checks payer, nonce, fee, non-sponsored authorization, and the canonical intent fields before
committing policy usage.

## Errors and observability

Invalid quote context returns `X402_INVALID`; policy rejection returns the existing `POLICY_DENIED`
or `POLICY_LIMIT_REQUIRED`; signer cancellation or malformed output returns `SIGNING_FAILED`.
Errors include stable, non-secret context such as intent ID, asset, or quote ID. Signed quote tokens,
request bodies, unsigned/signed transaction bytes, and callbacks are not included in error details.

## Tests and release gate

Regression coverage must include all three assets, Leather `broadcast: false`, remote signing,
request/requirement mismatch, public-key mismatch, fee and amount limits, recipient/origin denial,
quote expiry, signer mutation, invalid signatures, cancellation, concurrent reservation, release on
failure, and duplicate-intent prevention. `npm run verify`, `npm audit --audit-level=high`, package
contents inspection, and a clean-room consumer import are required before the PR is opened.

## Primary references

- Stacks Connect `request` API and normalized `stx_signTransaction` result:
  https://docs.stacks.co/reference/stacks.js/stacks-connect/request/request
- Stacks Connect wallet compatibility, including Leather support:
  https://docs.stacks.co/stacks-connect/wallet-support
- Stacks transaction construction and unsigned transaction primitives:
  https://docs.stacks.co/stacks.js/build-transactions
- Stacks node raw transaction broadcast boundary:
  https://docs.stacks.co/reference/api/stacks-node-rpc/transactions
