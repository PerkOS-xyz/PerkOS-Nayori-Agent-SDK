# 0.8.0-rc.2 — configurable confirmation policy

**Not published.** This source candidate follows the reviewed confirmation-policy change.
It needs QA review/merge and a separate publication approval. The published `next` remains
0.8.0-rc.1 until verified otherwise; stable `latest` remains 0.7.1. Never overwrite rc.1.

## Included and unchanged boundaries

- Pure confirmation-policy/progress helpers; conservative mainnet minimum6/6 and testnet0–144.
- Immutable version-2 testnet custody permits binding workflow/settlement depth to their hash.
- Progress disclosure and revalidation of prior confirmations before the next signature.
- Unchanged version-1 hashes and6/6 behavior, testnet-only custody, default v5/v4 contracts,
  gas limits, journals, role checks and economic verification. No x402/MPP policy changes.

See [confirmation policy](CONFIRMATION_POLICY.md) for exact semantics. Zero additional
burn blocks still requires canonical, anchored success; it does not eliminate reorganization
risk, contract appeal deadlines, mempool latency or evaluator time.

## Inspect the reviewed source artifact

Use Node20+ in a clean checkout of the reviewed merge commit:

```sh
npm ci
npm run verify
npm pack --pack-destination /absolute/private-artifacts
```

In a separate empty consumer directory:

```sh
npm init -y
npm install --save-exact /absolute/private-artifacts/perkos-agent-sdk-0.8.0-rc.2.tgz
./node_modules/.bin/nayori-mcp --help
./node_modules/.bin/nayori-custody --help
```

No wallet, private key or LLM credential is required for installation, read-only imports,
policy checks or CLI help. A source-built artifact is not registry publication evidence.

## Validation and release gates

The earlier internal job15 used the immutable npm0.8.0-rc.1 and version-1 permits; it passed
approval,98/2settlement, escrow0 and reputation reconciliation. That is **not a funded E2E of rc.2**,
new registration, external adoption, an external security review or production certification.

1. Merge the reviewed release PR into QA; verify tests, tarball contents and isolated install.
2. With publication approval, publish from the operator Mac under `next`, not GitHub Actions.
   Do not silently move `latest`. Do not claim provenance unless an attestation exists.
3. Verify exact registry version/integrity and both dist-tags; update installation docs only
   after successful publication. No automatic retry of an ambiguous publish.
4. Before a transactional test, obtain a fresh reviewed budget and new version-2 permits.
   Never rewrite completed job15 permissions/journals or reuse its exhausted gas allowance.
5. Validate the buyer/provider walkthroughs and deployed QA timing views before promotion.

QA website deployment, SDK publication and production rollout are separate events.
