# 0.8.0 — stable agent SDK

`0.8.0` promotes the exact QA-verified Nayori SDK tree to the stable npm line. It keeps
`agentic-commerce-v5`, `sbtc-commerce-v4` and `reputation-registry-v3` as defaults on Stacks
mainnet and testnet. It does not deploy contracts, create wallets or make a signer autonomous by
itself.

## Install and verify

```sh
npm init -y
npm install --save-exact --ignore-scripts @perkos/agent-sdk@0.8.0
npm ls @perkos/agent-sdk
./node_modules/.bin/nayori-mcp --help
./node_modules/.bin/nayori-custody --help
```

Keep the generated lockfile. Before funding a wallet, compare the package version and integrity
with `npm view @perkos/agent-sdk@0.8.0 version dist.integrity dist.tarball`. Do not use an unpinned
auto-downloading command in a financial agent.

## Included boundaries

- TypeScript reads and transaction builders for identity, STX/sBTC escrow and reputation.
- Browser or externally supplied headless signing; no private key is requested by the SDK.
- Local stdio MCP for existing agents, including opt-in bounded job discovery.
- Optional testnet-only delegated custody with immutable permits, amount/fee limits, nonce guards,
  deny-mode postconditions and durable recovery journals.
- Provider/consumer private-evidence helpers that upload directly to a fixed Nayori S3 capability
  and verify the committed SHA-256/size; OAuth is sent only to Nayori, never to S3.
- x402 STX/sBTC/USDCx foundations and MPP USDCx PaymentAuth helpers.
- Opt-in builders for testnet fee-candidate contracts. Production defaults remain v5/v4.

## Evidence and limits

The stable tree passed typecheck, build, package dry-run and 415 tests. QA job `u18` exercised the
real SDK/MCP private-evidence lifecycle and finished with escrow zero and an exact 980/20 sBTC
split. A separate controlled mainnet `sbtc-commerce-v4 u2` canary passed 50/50 checks against the
same default contract generation, but it ran from the repository runner before stable npm
publication and must not be described as a `0.8.0` registry E2E.

All those actors are `internal-team-operated-not-m2-adoption`. External developer use, independent
wallet activity and external security review require separate evidence. The local custody service
remains testnet-only; mainnet signatures stay with the developer's own wallet or signing service.

## Publication gate

Publication occurs only from the human-merged `main` commit on the operator Mac. Run the complete
gate, inspect `npm pack --dry-run --json`, publish with public access and `latest`, then install from
the registry in a clean directory and record the returned integrity. Local publication has no
GitHub OIDC provenance attestation; commit, tarball integrity and clean-install evidence provide
the reproducibility chain.
