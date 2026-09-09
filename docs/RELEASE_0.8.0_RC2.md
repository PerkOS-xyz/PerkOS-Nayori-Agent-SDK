# 0.8.0-rc.2 — configurable confirmation policy

**Published on npm under `next` on 2026-09-09 UTC.** Stable `latest` remains 0.7.1.
The operator-authorized publication used the exact reviewed VPS artifact from QA merge
`e89ce2949b58392b073ab1b1f357c8a4d8667903`, published from the Mac without provenance attestation.
Never overwrite rc.1 or rc.2. The immutable package retains its pre-publication documentation;
this source note records the verified registry state.

```sh
npm install --save-exact @perkos/agent-sdk@0.8.0-rc.2
```

Verified registry integrity:
`sha512-1I4Fva8P+HbBpxxtECocb0j8AuoBhEEaW5nH0EBXmZCV7TA5TjRhPZAozdpsiMObTd9KBb56H7ab6SeNJJK6hQ==`.
Downloaded tarball SHA-256:
`f079d44fc0c60f64da302df9ec0d61af56d865410ce80993ff0c7871d85f715d`.
Source validation: 369 tests, typecheck/build and isolated tarball consumer checks passed.
An independent clean installation from the public registry passed 12 checks covering import,
confirmation-policy limits/progress and both CLI help entrypoints, with no credentials,
signatures, broadcasts or LLM calls. The first install saw stale registry metadata; retry with a
fresh cache succeeded after the accepted publication propagated. The package was not republished.

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

1. Completed: QA merge, source tests, tarball inspection and isolated install.
2. Completed: approved publication from the operator Mac under `next`, not GitHub Actions.
   `latest` was not moved. No provenance attestation is claimed.
3. Completed: exact registry version/integrity, downloaded bytes and both dist-tags verified.
   Do not retry or republish an already accepted release.
4. Before a transactional test, obtain a fresh reviewed budget and new version-2 permits.
   Never rewrite completed job15 permissions/journals or reuse its exhausted gas allowance.
5. Validate the buyer/provider walkthroughs and deployed QA timing views before promotion.

QA website deployment, SDK publication and production rollout are separate events.
