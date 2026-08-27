# Security

## Release status

`@perkos/agent-sdk` 0.4.0 is an M2 developer release and has not completed the external security
review required for the PerkOS Stacks Endowment milestone.

Do not use this developer release to control material funds without your own review. Inspect every
transaction plan in the signer and configure explicit spending limits.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Send a private report to
`security@perkos.xyz` with:

- the affected version and network;
- reproduction steps or a proof of concept;
- the potential impact;
- relevant contract IDs, transaction IDs, or logs;
- a safe way to contact the reporter.

The PerkOS team will acknowledge the report, validate it, and coordinate remediation and
disclosure.

## Implemented safeguards

- Explicit network selection and network-compatible contract validation.
- Exact post-conditions for wallet funding.
- Exact escrow-contract post-conditions for completion, rejection, and refunds.
- Contract and asset allowlists.
- Required per-transaction and per-session funding limits.
- Funding-limit checks occur before requesting a signer address.
- Signer-address matching for funding plans.
- No automatic environment-variable or private-key loading.
- No arbitrary URL or payment-destination execution surface in the core SDK.
- Strict validation and normalization of signer-returned Stacks transaction IDs.
- Bounded, cancellable confirmation polling with explicit abort, dropped, and timeout states.
- Network mismatch rejection in both browser and headless signer adapters.
- Request-bound direct STX, sBTC, and USDCx payment intents with immutable economic fields.
- Explicit direct-payment recipient, HTTPS origin, merchant, amount, fee, and session limits.
- Concurrent payment reservations that prevent asynchronous agents from oversubscribing a budget.
- Independent verification of every signed direct-payment transaction before facilitator submission.
- Invitation-bound partner enrollment through exact Stacks message signing, with compressed public
  key and recoverable-signature validation before API submission.
- OAuth client secrets and tokens remain caller-owned and are never persisted or automatically
  refreshed by the SDK.

## Key handling

`StacksConnectSigner` delegates signing to the wallet extension and never receives a private key.
The host application must select the intended account and show the wallet approval surface.

`HeadlessSigner` calls an application-owned `privateKeyProvider` only when it needs to derive the
public address or sign. It caches only the public address. When the provider returns a
`Uint8Array`, the SDK signs with a copy and zeroes that local copy after the operation. JavaScript
strings are immutable and cannot be reliably erased; use binary key material and an isolated
secret provider when the runtime permits it.

The SDK does not make an unsafe runtime safe. Restrict process access, rotate credentials, separate
client/provider/evaluator identities, and use an HSM, KMS, or isolated signer for material funds.

`LeatherSigner` uses `stx_signTransaction` with `broadcast: false` and requires Leather/Stacks
Connect to return the signed transaction bytes. `PolicySigner` receives only an immutable intent and
unsigned transaction; its application callback should call an isolated custody service. The SDK's
in-process policy is defense in depth and can be bypassed by a malicious host application, so the
custody service must independently authenticate callers, revalidate intent, enforce durable limits,
and keep keys outside the agent/LLM process.

`createStacksConnectPartnerSigner` uses `stx_signMessage` only for the exact partner-enrollment
challenge. This signature authorizes OAuth client creation, not a payment. The host must show the
message, network and selected address to the user, move the returned one-time client secret into a
secret manager and keep invitations, signatures, secrets and access tokens out of telemetry and
prompts.

## Confirmation handling

A broadcast receipt means a node accepted the transaction, not that the contract call succeeded.
Automated workflows should call `confirm` or `executeAndConfirm`, require `success`, inspect the
Clarity result, and choose an additional confirmation threshold appropriate to the value at risk.
Treat transaction APIs as external dependencies and retain the transaction ID for independent
verification.

## Trust boundaries

The SDK prepares, validates, and submits transaction plans through an application-provided
signer. It does not prove that the signer implementation is safe. Applications must protect
private keys, verify wallet prompts, authenticate agent commands, and treat external tool or
model output as untrusted.
