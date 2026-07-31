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
                   |
                   v
            application signer
                   |
                   v
          Stacks transaction broadcast
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
The SDK only records session spend after the signer returns an accepted transaction ID.

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

- Stacks Connect and Leather browser signer.
- Headless server signer with an external key provider.
- Confirmation and canonical receipt service.
- x402 v2 resource-server and client adapters.
- MCP tools with typed inputs, allowlists, and the same spending policy.
