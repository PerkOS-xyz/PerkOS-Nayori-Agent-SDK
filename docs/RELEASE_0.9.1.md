# 0.9.1 — mainnet evaluation commitments

`0.9.1` is a patch release on the 0.9 line. It changes no contract default, no signer authority and
no on-chain behaviour.

## What changed

- `prepareEvaluationJob`, `prepareEvaluationSubmission` and `evaluationJobId` accept
  `network: "mainnet"` with `SP` principals. In 0.9.0 they accepted only testnet, so an SDK user
  could not create a job that the Nayori managed Evaluator is able to evaluate on mainnet, even
  though the Evaluator itself already accepted mainnet commitments.
- `src/evaluation-commitments.ts` is byte-identical to the Evaluator reference implementation
  again. The two network guards live in `src/contracts.ts`. Testnet hashes are unchanged and a
  mainnet cross-repository fixture is pinned in the tests. Crossed address families are rejected.
- The README and guides bundled in the package describe 0.9.x as the published stable line. The
  0.9.0 tarball still carries pre-publication wording; 0.9.1 replaces it on npm.

## Unchanged boundaries

- Mainnet defaults stay `agentic-commerce-v6` and `sbtc-commerce-v5`; generic testnet stays v5/v4.
- The MCP evaluation tools and the custody pilot remain testnet-only.
- The managed Evaluator's public admission on mainnet is an operator decision outside this SDK.
  A valid commitment is not approval, settlement or a wallet authorization.

## Install

```sh
npm install --save-exact --ignore-scripts @perkos/agent-sdk@0.9.1
```

## Publication record

Filled in after publication: npm dist-tags, tarball integrity and the clean-consumer check.
`0.9.0` is never overwritten or republished.
