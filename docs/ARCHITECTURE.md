# Architecture

## Scope

The SDK is a typed boundary between agent frameworks and the existing PerkOS contracts. The core
package contains no LLM, HTTP-paywall, MCP server, wallet extension, or private-key store. Those
systems integrate through explicit interfaces so that transaction policy remains reusable and
auditable.

## Flow

```text
Agent or application
        |
        v
PerkOSClient ---- read-only transport ---- Stacks API
        |
        +---- PerkOSTransactionBuilder
        |          |
        |          v
        |    ContractCallPlan
        |          |
        +---- SpendingPolicy
        |          |
        |          v
        |    StacksConnectSigner ---- browser wallet
        |          or
        |      HeadlessSigner ------ external key provider
        |          |
        |          v
        |    Stacks transaction broadcast
        |
        +---- TransactionTracker ---- Stacks API v3
                   |
                   v
           normalized confirmation
```

## Read path

`PerkOSClient` resolves a known deployment or validated override and invokes a replaceable
read-only transport. Responses are decoded from Clarity values into records that use `bigint` for
all on-chain integers. Known missing-record errors return `null`; malformed responses and other
contract errors remain explicit.

## Write path

Builders produce a `ContractCallPlan` containing:

- the selected network and exact contract ID;
- function name and serialized Clarity arguments;
- post-condition mode and post-conditions;
- semantic intent such as operation, asset, job ID, sender, recipient, and amount.

Plans are inert. `execute` checks the plan against `SpendingPolicy` before invoking the signer.
The SDK only records session spend after the signer returns a valid Stacks transaction ID.
The high-level `fundJob` helper also validates its amount and funding limits before requesting a
signer address, so a denied spend does not cause headless key-provider access.

## Signer adapters

`StacksConnectSigner` is an injected adapter around the Stacks Connect `stx_callContract` request.
The host application owns wallet discovery, account selection, and the user approval surface. The
adapter forwards the contract, function, arguments, network, and post-conditions without receiving
a private key.

`HeadlessSigner` uses `makeContractCall` and `broadcastTransaction`. It obtains key material from an
application callback at the last responsible moment, caches only the public address, and clears its
local `Uint8Array` copy after use. The callback is the integration point for a secret manager, HSM,
KMS, or isolated signing service. It is intentionally not an environment-variable loader or key
store.

Both adapters reject plans from a network other than the network fixed at construction.

## Confirmation path

`TransactionTracker` queries the Hiro Stacks API v3 transaction endpoint and maps API states into
`pending`, `success`, `abort`, `dropped`, or `timeout`. A not-yet-indexed transaction is pending,
not failed. Waiting is bounded, cancellable, and emits status observations through an optional
callback. Because the v3 endpoint may return `result: null` for successful contract calls, terminal
receipts make a best-effort transaction-detail lookup to hydrate the Clarity result without
replacing v3 as the status and block-metadata source.

`PerkOSClient.executeAndConfirm` keeps broadcast information and confirmation evidence separate in
one receipt. API-reported success is evidence of transaction execution, but applications may still
require additional confirmations before treating high-value settlement as irreversible.

## Asset adapters

STX and sBTC share the same public job lifecycle but have different contract signatures and
post-conditions:

- STX funding calls `fund-job(job-id)` and constrains micro-STX.
- sBTC funding calls `fund-job(job-id, token)` and constrains the canonical SIP-010 asset.
- sBTC settlement functions also receive the configured token trait argument.

This difference stays inside the builder so frameworks do not duplicate asset-specific Clarity
logic.

## Settlement safety

Completion, rejection, and expiry may transfer funds held by the escrow contract rather than by
the transaction origin. High-level client methods read the current job and escrow balance before
building the plan. The resulting post-condition identifies the escrow contract principal and the
exact amount expected to leave it.

## Future adapters

- x402 v2 resource-server and client adapters.
- MCP tools with typed inputs, allowlists, and the same spending policy.
- Optional framework-specific integrations and higher-confirmation settlement policies.
