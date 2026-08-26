# Nayori direct x402 Stacks profile

Date: 2026-08-25
Status: approved for implementation

## Boundary

This is an additive Milestone 2 SDK capability. It does not change the approved M1 contracts,
broadcast transactions, host a facilitator, persist replay state, sponsor fees, or replace the
existing `perkos-escrow-v1` job-funding mechanism. The direct mechanism is for an immediate paid
resource; the existing mechanism remains for jobs with escrow, delivery, evaluation, payout, and
reputation.

## Decision

Add a versioned `stacks-signed-tx-v1` mechanism for direct STX, sBTC, and USDCx payments using the
official x402 v2 `exact` scheme and explicit `upfront` flow. The client signs the real Stacks
transaction, and a later hosted facilitator validates and broadcasts it before the resource runs.

The approved compatibility-first wire profile emits:

- `STX` for native STX;
- the canonical `address.contract` principal for sBTC and USDCx;
- a full internal CAIP-19 identifier in `extra.nayoriAssetId` for every asset;
- `extra.assetTransferMethod: "stacks-signed-tx-v1"`;
- `extra.paymentFlow: "upfront"`.

Unknown networks, assets, contracts, or token names fail closed. There is no fallback to STX.

## Request binding

A normalized trusted quote covers quote and merchant IDs, HTTP method, canonical absolute URL,
SHA-256 body digest, network, canonical asset, exact atomic amount, recipient, issue time, and
expiry. The canonical representation has fixed keys and version 1. Its SHA-256 digest is truncated
to 20 bytes and encoded as `ny1_<base64url>`: 31 ASCII characters that fit both the 34-byte native
STX memo and SIP-010 optional memo.

The pure verifier receives the trusted quote and actual request, recomputes the fingerprint, and
requires the signed transaction memo to match. The future hosted layer must authenticate the
merchant and verify the quote signature before treating the quote as trusted.

## Pure verifier

The verifier has no network, database, replay, or broadcast side effects. It:

1. validates the official x402 payload and requirement;
2. requires payload `accepted` to equal the server requirement;
3. matches requirement, trusted quote, and actual request;
4. deserializes one canonical transaction with bounded size and no trailing bytes;
5. verifies chain ID, transaction version, authorization type, and origin signature;
6. derives the payer from the origin spending condition;
7. permits only an exact STX token transfer or canonical SIP-010 `transfer` call;
8. checks amount, sender, recipient, memo, contract, function, arguments, and asset;
9. requires `PostConditionMode.Deny`; SIP-010 requires exactly one equal FT post-condition from
   the payer for the canonical token and amount;
10. returns a typed verified plan for a later settlement layer.

Standard and origin-signed sponsored transactions are accepted. Sponsor signing, fee policy,
nonce queues, balance checks, simulation, replay, idempotency, broadcast, confirmation, and
delivery remain required hosted-service controls.

## Testing

Deterministic signed fixtures cover STX, sBTC, USDCx, mainnet/testnet registry values, canonical
fingerprints, and sponsored origin signatures. Negative tests mutate the request, quote,
requirement, network, signature, transaction template, recipient, amount, memo, contract,
function arguments, post-condition mode, post-condition asset, and serialized bytes. No test calls
a live RPC or broadcasts a transaction.
