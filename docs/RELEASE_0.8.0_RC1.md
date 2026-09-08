# 0.8.0-rc.1 — QA release candidate

**Published on npm on 2026-09-08 UTC under `next`.** Stable `latest` remains `@perkos/agent-sdk@0.7.1`.
This prerelease packages reviewed QA features for explicit operator testing; it is not a
production promotion or a certification of autonomous operation for every developer.

## Included

- Node-only Hermes-compatible MCP read/prepare tools and optional Linux custody delegation.
- Operator-owned keys, isolated signer identities, immutable permits, bounded budgets and
  durable intent/nonce/txid recovery. Signing remains disabled by default; the pilot is testnet-only.
- Provider-only, job-bound evaluation admission and status with bounded timeouts, sanitized
  errors and deterministic-ID reconciliation. No automatic retries or x402 purchases in this adapter.
- Opt-in STX v6/sBTC v5 fee methods, consent and accounting; default v5/v4 contracts are unchanged.
- Versioned criteria/evidence commitments, absent-reputation handling, role-separated examples
  and buyer/provider manuals. Developers retain their own agent and LLM configuration.

See [verified scope](VALIDATION_AND_RELEASE.md). The earlier internal sBTC lifecycle used
source `fc0537477fda819fa9cce8e74e543be0d49ea3a4`, not this versioned artifact. Packaging
checks do not establish a new funded E2E, fresh registration, external adoption or security audit.

## Install the published prerelease

Use a separate integration directory, initializing its own package.json if needed:

```sh
npm init -y
npm install --save-exact @perkos/agent-sdk@0.8.0-rc.1
./node_modules/.bin/nayori-mcp --help
./node_modules/.bin/nayori-custody --help
```

Registry integrity:

```text
sha512-zkL8mt6/evs7aei1At34Nsn/xHEjyh4iqRDDwkh/AUuAZYauOUBpVMEjRt/YNGpoAOZGJZr1+ftDjeWRZoUEtg==
```

The published artifact matches reviewed source `78892be43727bccc4271aec060842d51f06bb8ff`
(same tree as `e85458a`). Registry installation, lockfile integrity, import, offline registration
plan, CLI help and official MCP stdio buyer/provider checks passed. This involved no wallet
keys, signatures, broadcasts or evaluator/LLM requests. Default v5/v4 contracts are unchanged.

Publication was explicitly authorized from an operator workstation without provenance attestation.
Do not describe this artifact as provenance-backed. Its immutable bundled documents contain the
pre-publication checklist; this repository page records the subsequent publication result.

## Source development and artifact inspection

In a clean checkout of the reviewed candidate commit, use Node 20+ and npm 10+:

```sh
npm ci
npm run verify
npm pack --pack-destination /absolute/private-artifacts
```

Create a separate, empty consumer directory and initialize its own package.json:

```sh
npm init -y
npm install --save-exact /absolute/private-artifacts/perkos-agent-sdk-0.8.0-rc.1.tgz
./node_modules/.bin/nayori-mcp --help
./node_modules/.bin/nayori-custody --help
```

Check the exact package version, import and transaction-plan construction without a signer.
Record source commit, tarball integrity and contents. No private key is needed to install or
prepare a plan. Running custody signing requires separate Linux isolation, permissions and
budget setup; never put keys into MCP, prompts or model tools.

## Gates for future releases

1. Review and merge the QA release PR; build from the exact reviewed commit with a clean tree.
2. Verify SDK tests, package allowlist, absence of secrets, dependency audit and isolated consumer.
3. Obtain publication approval. Use the prerelease `next` tag, never move `latest` implicitly.
   `publishConfig.tag` is `next`; do not override it to `latest` for this candidate.
4. Verify registry version/integrity and that `latest` remains 0.7.1. Repeat isolated installation
   from the exact published version, not an unpinned tag or financial `npx -y` command.
5. Validate both role walkthroughs before recording the developer demo. New funded tests require
   a fresh reviewed budget; never reuse the completed QA job's authorization.

Registry publication and offline installation for 0.8.0-rc.1 are complete. Do not republish it.
QA merge, npm publication, hosted documentation deployment and production promotion are
separate events. x402/MPP resource purchases remain a separate workflow and test scope.
