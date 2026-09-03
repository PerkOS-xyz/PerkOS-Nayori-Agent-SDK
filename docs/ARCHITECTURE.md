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

## x402 v2 client adapter

The x402 adapter uses the official v2 schemas and HTTP header codecs. It maps mainnet and testnet
to their Stacks CAIP-2 identifiers and binds every payment requirement to the configured commerce
contract, settlement asset, job ID, and exact atomic budget. `PerkOSX402SchemeClient` then reuses
the normal read path, spending policy, signer, exact post-conditions, and confirmation tracker to
produce a confirmed escrow-funding proof.

`PerkOSX402Facilitator` closes the server-side observation boundary. It uses current Hiro v3
transaction and event responses plus the Stacks chain tip, decodes the commerce contract's
`job-funded` Clarity print event, matches the exact asset transfer, and atomically consumes the
network-prefixed transaction ID through an injected replay store. The facilitator broadcasts no
second transaction because the declared x402 payment flow is upfront.

The included in-memory replay store is process-local and not production durability. A deployed
resource server must inject shared atomic storage. The existing custom application headers are
outside the SDK and are not implicitly treated as x402 v2.

The confirmed funding transaction is public before its proof reaches the resource server. Replay
consumption and a short freshness window do not cryptographically bind that bearer proof to one
HTTP request, so a later request-bound signature/challenge or facilitator-submitted transaction is
required before a high-value production paywall migration.

## MPP PaymentAuth adapter

The MPP adapter is independent of the x402 HTTP envelope but deliberately reuses the same trusted
quote, memo fingerprint, payer intent and exact Stacks transaction verifier. It implements the
official `Payment` authentication scheme with `method="usdc"`, `intent="charge"` and the Stacks
USDCx profile. Challenges and credentials use RFC 8785 canonical JSON and unpadded base64url;
signed Stacks consensus bytes use standard base64 inside the credential.

Nayori selects `Payment-Authorization` in every challenge so an OAuth Bearer token can remain in
the ordinary `Authorization` header. The MPP layer additionally enforces CAIP-10 payer identity,
the official six-decimal USDCx tuple, `OnChainOnly`, standard single-signature authorization and a
low-s origin signature. It emits a structured receipt only for a settlement reference supplied by
the hosted layer.

The adapter is still pure. Merchant authentication, quote-signature trust, live nonce and balance
checks, token-control policy, durable challenge/replay reservation, broadcast, reconciliation,
confirmation and resource delivery remain in Platform. Sponsorship is disabled in the initial
profile.

## Settlement safety

Completion, rejection, expiry and versioned review-timeout settlement may transfer funds held by
the escrow contract rather than by the transaction origin. High-level client methods read the
current job and escrow balance before building the plan. The resulting post-condition identifies
the escrow contract principal and the exact amount expected to leave it. For `sbtc-commerce-v2`,
`sbtc-commerce-v3` and `sbtc-commerce-v4`, the client also reads the job-pinned token and uses it
in both the contract argument and exact fungible-token post-condition; a later default-token
rotation cannot redirect or strand an existing escrow.

The active v5/v4 generation records a fixed 12 Bitcoin burn-block review deadline at submission.
The evaluator records a hashed decision without moving escrow, after which the affected client or
provider receives the configured appeal window. A separately pinned human authority resolves an
appeal; permissionless finalizers preserve liveness after either deadline without choosing a new
recipient. Reputation synchronization has its own durable read record and deny-mode retry plan so
registry unavailability never expands payment authority or rolls back settlement.

Versioned v5/v4/v3 contract IDs are the defaults on both networks. Historical generations remain
available through explicit same-network overrides.

## Future adapters

- Durable replay-store and hosted HTTP adapters for the x402 Stacks facilitator.
- Hosted MPP challenge consumption, settlement reconciliation and confirmed receipt delivery.
- MCP tools with typed inputs, allowlists, and the same spending policy.
- Optional framework-specific integrations and higher-confirmation settlement policies.
