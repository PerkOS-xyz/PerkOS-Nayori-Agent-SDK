# Security

## Release status

`@perkos/agent-sdk` 0.1.0 is an M2 foundation release and has not completed the external security
review required for the PerkOS Stacks Endowment milestone.

Do not use an unreleased build to control material funds. Review every transaction plan in the
signer and configure explicit spending limits.

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
- Signer-address matching for funding plans.
- No automatic environment-variable or private-key loading.
- No arbitrary URL or payment-destination execution surface in the core SDK.

## Trust boundaries

The SDK prepares, validates, and submits transaction plans through an application-provided
signer. It does not prove that the signer implementation is safe. Applications must protect
private keys, verify wallet prompts, authenticate agent commands, and treat external tool or
model output as untrusted.
