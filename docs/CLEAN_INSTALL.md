# Clean-install checkpoint — buyer and provider

Start with your own working agent and LLM. This checkpoint tests the **public npm SDK and real
MCP stdio**, not a Hermes conversation, a signer deployment, on-chain registration or payment.
No wallet, private key, model credential, funded account, OAuth token or PerkOS server access is
needed. It does not change your agent configuration. Complete it before enabling any signer.

## 1. Obtain the reviewed standalone check

`examples/onboarding-smoke.mjs` is a standalone diagnostic in the QA source branch. It is **not
included in the immutable npm rc.2 artifact**. Read the script and record the reviewed commit
before copying it. Do not run an unreviewed moving branch in a financial agent's environment.

```sh
git clone --branch qa https://github.com/PerkOS-xyz/PerkOS-Nayori-Agent-SDK.git nayori-reviewed-docs
git -C nayori-reviewed-docs rev-parse HEAD
# Review examples/onboarding-smoke.mjs at that recorded commit. It must exist before proceeding.
mkdir nayori-clean-consumer
cd nayori-clean-consumer
npm init -y
cp ../nayori-reviewed-docs/examples/onboarding-smoke.mjs ./onboarding-smoke.mjs
```

This diagnostic is delivered with the accompanying QA documentation change. A checkout from
before that change will not contain it; do not substitute an unrelated downloaded script.
Use an otherwise empty consumer directory, **not** the SDK checkout or an existing agent project.

## 2. Install pinned public dependencies

With Node20+ and npm10+:

```sh
npm install --save-exact --ignore-scripts @perkos/agent-sdk@0.8.0-rc.2 @modelcontextprotocol/sdk@1.30.0
npm ls @perkos/agent-sdk @modelcontextprotocol/sdk
node onboarding-smoke.mjs
```

The MCP client dependency is explicitly installed for the diagnostic; it is not a new signer or
model integration. Registry access is needed during installation. The diagnostic's selected
operations are offline: no chain reads, signing, broadcasts, evaluator or LLM calls. It spawns
the installed `dist/mcp/cli.js`, never `src`, `tsx`, a local tarball or an internal operator runner.
It creates and removes only its own temporary public-fixture directory.

Keep `package.json` and `package-lock.json`; review the SDK entry's integrity against
[the rc.2 release record](RELEASE_0.8.0_RC2.md). Reproduce with `npm ci --ignore-scripts` in a
second clean copy of that consumer. Do not use unpinned `npx`, replace rc.2 bytes or assume
`npm run quickstart` exists in the consumer: installing a dependency does not add its npm scripts.

## 3. Expected result and boundaries

The JSON must report `result: PASS`, SDK0.8.0-rc.2 and12 named checks:

- Unsigned testnet registration plan; policy0/6 accepted on testnet and refused on mainnet.
- Both roles: exact six read/prepare tools, correct public context, no signing/broadcast/x402.
- Buyer criteria and provider evidence commitments match the actual SDK through stdio.
- Unexpected network overrides, opposite-role tools and execution without custody are denied.
- No stderr diagnostics. Registration, broadcast, signatures and LLM counters stay zero.

The public addresses, job1, URI and hash of the local text12 are **inert fixtures: never fund, upload, register,
submit or reuse them**. They do not demonstrate remote evidence availability or identity ownership.
The published rc.2 still has a stale “not published npm” warning; source PR47 corrected the text
for a later release. Version and registry integrity establish the artifact, not that message.

If the probe fails, stop before wallet setup. Keep the lockfile and a redacted error; do not
paste environment contents, enable custody or fund an address to make this offline check pass.
Timeouts do not authorize retries of later economic actions. This diagnostic cannot prove Linux
UID isolation or correctness of a developer's own signer/LLM configuration.

## 4. Continue with the actual role

Follow [wallet/signer setup](WALLET_SIGNER_SETUP.md), then [consumer](HERMES_BUYER.md) or
[provider](HERMES_PROVIDER.md). Configure your real public profile and existing Hermes as shown
in [MCP setup](HERMES_MCP.md). Never pass fixture identities to an enabled signer.

Fresh registration requires a separately authorized transaction and saved agent ID; an existing
active identity is verified and reused. Each new job needs its own permits, gas/LLM budgets and
evidence publication arrangement. [Job16 evidence](VALIDATION_AND_RELEASE.md) is historical proof,
not authorization to reuse its wallets or exhausted allowances.

The [x402 path](X402_PAYMENTS.md) has a separate signer and paid-resource gate. Local Hermes MCP
does not buy x402 resources. An escrow completion does not prove HTTP payment/delivery.

Sources: [official Hermes MCP configuration](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp),
[SDK source and release boundaries](VALIDATION_AND_RELEASE.md).
