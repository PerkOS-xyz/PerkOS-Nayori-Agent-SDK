# Stacks x402 verifier and facilitator

Date: 2026-08-25  
Status: approved for implementation by the M2 continuation

## Milestone boundary

Milestone 1 is approved and closed. This work is an additive `@perkos/agent-sdk` capability for
Milestone 2 developer adoption and demo readiness. It does not change, redeploy, or charge a fee
through the STX or sBTC contracts. It also does not replace the external security review or any
mainnet/non-team adoption requirement.

The deliverable is a reusable facilitator mechanism, not a hosted production service. It can be
registered with the official `@x402/core` facilitator and can later power a Next.js route, a
standalone facilitator, or an agent framework without duplicating Stacks verification logic.

## Approaches considered

### Deploy a hosted facilitator immediately

This would create an immediately callable endpoint, but it also introduces hosting, rate limits,
availability, durable storage, observability, and incident-response obligations before the core
verification rules are reviewed. It is deferred.

### Migrate the application middleware first

The current application middleware uses custom `X-X402-*` headers and escrow-balance checks. A
direct migration before independent transaction verification would make the surface look standard
without closing its security boundary. It is deferred until the SDK mechanism is merged.

### Add a reusable SDK facilitator with injected state

This provides strict, testable verification and lets each host supply its own fetch implementation
and atomic replay store. It aligns directly with the public SDK, example, and external-feedback
parts of M2. This is the selected approach.

## Protocol model

The existing client uses `paymentFlow: "upfront"`: the buyer broadcasts and confirms `fund-job`
before it asks for the protected resource again. Under the official x402 v2 flow table, upfront
payments call facilitator settlement before the resource handler; read-only `/verify` is not part
of the normal resource-server ordering. For this Stacks mechanism, settlement does not broadcast a
second transaction. It independently observes the already confirmed escrow funding and atomically
consumes its transaction ID as the one-time payment proof.

The facilitator still implements `verify` because it is part of the standard facilitator API and
is useful for diagnostics. `verify` never writes replay state. `settle` repeats verification and
then performs the atomic replay-state transition before returning success.

## Components

`src/x402-facilitator.ts` will contain:

1. `HiroX402TransactionSource`, a read-only client for transaction detail and chain tip.
2. Strict parsers for the minimum Hiro response fields needed by the mechanism.
3. Verification of requirement/payload equality, confirmation depth, freshness, payer, contract
   call, function arguments, asset transfer event, amount, and client proof block metadata.
4. `PerkOSX402Facilitator`, implementing the official `SchemeNetworkFacilitator` interface.
5. `PerkOSX402ReplayStore`, an injected atomic-consume interface.
6. `InMemoryX402ReplayStore`, safe for examples and one-process tests but explicitly unsuitable
   for horizontally scaled production.

The default transaction source uses the API URL already resolved by the SDK configuration. No API
key, private key, signer, fee recipient, or treasury is needed.

## Verification rules

A payment is valid only when all checks pass:

- The payload and supplied requirement are deeply equal and both pass the existing PerkOS x402
  parser.
- The transaction ID and claimed payer are valid for the configured Stacks network.
- Hiro returns a canonical, anchored, successful `contract_call` transaction.
- The transaction sender equals the payload payer.
- The contract and function are exactly the configured asset-specific commerce contract and
  `fund-job`.
- The first Clarity argument is the exact job ID. For sBTC, the token argument is the configured
  canonical token.
- A matching on-chain transfer event moves the exact requirement amount from the payer to the
  commerce contract: canonical SIP-010 sBTC for sBTC, or micro-STX for STX.
- The API block height/hash match any block metadata included in the client proof.
- The transaction has the configured minimum confirmation count and is no older than the quote's
  `maxTimeoutSeconds`, with a small configurable clock-skew allowance.
- The network-prefixed transaction key has not already been consumed.

The event check is mandatory even when a transaction result is `(ok true)`: successful execution
alone does not prove that the quoted amount and asset moved into escrow.

## Replay and concurrency

The replay key is `${network}:${normalizedTxid}`. `settle` calls an atomic
`consume(key, record): Promise<boolean>`. Exactly one concurrent caller can receive `true`; every
later caller receives a replay failure. A production adapter must implement this with a unique
database constraint or an atomic primitive such as Redis `SET NX`, and should retain records at
least as long as any protected resource can be delivered.

The in-memory implementation uses a process-local map and is only for tests, examples, local
development, and a single-process demo. It must not be represented as durable or distributed
replay protection.

## Security limitation

The current Stacks payload is proof of an already public transaction, not a private off-chain
authorization bound cryptographically to an HTTP request. Confirmation freshness and first-writer
replay consumption reduce stale reuse, but a party that obtains the proof before settlement could
attempt to front-run it. The application must not migrate a high-value production paywall until a
later design either gives the facilitator the signed transaction before broadcast or adds a
request-bound payer signature/challenge.

This limitation will be visible in the README and example. The mechanism is appropriate for M2
integration evidence and controlled pilots, not an unaudited high-value production gateway.

## Errors

Malformed requirements, mismatches, failed transactions, insufficient confirmations, expired
proofs, missing transfer events, and replay attempts return stable invalid-reason strings. Network
or malformed API responses fail closed. Settlement never marks a proof consumed until every
read-only verification check succeeds.

If consumption succeeds, settlement returns the existing funding transaction, payer, Stacks
CAIP-2 network, and exact atomic amount. It never claims to have broadcast another transaction.

## Testing and evidence

Unit tests will cover sBTC and STX success, official facilitator registration, malformed payloads,
cross-network/requirement mismatch, wrong sender/contract/function/job/token/amount, missing or
incorrect transfer events, failed/noncanonical/unanchored transactions, insufficient confirmation,
expiry, block metadata mismatch, API failure, and concurrent replay consumption.

A wallet-free quickstart will inspect the public M1 mainnet sBTC funding transaction through Hiro
and demonstrate that its contract call and transfer event match the expected escrow fields while
the facilitator correctly refuses it as an expired x402 proof. It changes no M1 state and consumes
no replay record. This is additional M2 SDK evidence, not a new M1 claim or adoption credit.

## Follow-up

1. Merge and publish the SDK verifier/facilitator.
2. Obtain external technical feedback and include the module in the recorded M2 SDK demo.
3. Add a durable replay-store adapter and thin hosted HTTP facilitator.
4. Replace the application's custom x402 middleware only after the request-binding limitation has
   an accepted mitigation.
5. Continue the external security review and mainnet/non-team adoption work in parallel.
