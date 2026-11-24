# 0.10.0 — next contract generation

`0.10.0` adds the next Nayori contracts, live on mainnet and testnet since 2026-11-24, beside the
current generation.

## What changed

- `NayoriNextClient` and `NayoriNextTransactionBuilder` target the seven `nayori-*` contracts:
  sBTC and STX escrows, roles, permissions, reputation, agents and applications. See
  [NEXT_CONTRACTS.md](NEXT_CONTRACTS.md).
- The defaults are the live deployments: mainnet `SP2BM4WCNQM286PFHPGA1BG2YXER0PCG1PKQ5MF1X`,
  testnet `ST3MRPNX0VNWYRSJ07PNTASE5BZ9K5XE57ARZ39DY` (`NAYORI_NEXT_DEPLOYERS`).
- The contracts have no owner. The treasury and the appeal authority are multisig accounts on
  mainnet; the SDK reads them from `nayori-roles` and pins them per job.

## Unchanged boundaries

- `PerkOSClient` keeps the current generation (`agentic-commerce-v6`, `sbtc-commerce-v5` on
  mainnet) for jobs created there.
- The MCP evaluation tools and the custody pilot remain testnet-only.

## Install

```sh
npm install --save-exact --ignore-scripts @perkos/agent-sdk@0.10.0
```

## Publication record

Filled in after publication: npm dist-tags, tarball integrity and the clean-consumer check.
`0.9.1` is never overwritten or republished.
