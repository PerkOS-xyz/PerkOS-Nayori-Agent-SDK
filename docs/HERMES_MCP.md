# Nayori MCP — framework-independent QA adapter

Optional [job discovery](MCP_JOB_DISCOVERY.md) is an unreleased source-only extension;
the npm rc.2 defaults and installation instructions below remain unchanged.

The Node stdio adapter is not restricted to Hermes. See [MCP client setup](MCP_CLIENTS.md)
for Hermes, OpenClaw, Codex and Claude Code, with client-specific validation boundaries.

**Published QA prerelease 0.8.0-rc.2, not a turnkey production wallet integration.**
By default this packages read/prepare tools using the actual SDK.
Optional [custody delegation](HERMES_CUSTODY.md) adds bounded register/create/fund/assign/submit/finalize
requests to a separate operator-controlled signer. This is not deployed or funded by default.
An additional provider-only opt-in can request public QA evaluations for the permitted job.
Neither mode performs x402 purchases or generates wallets.

## Architecture and installation

Hermes → local MCP stdio → Nayori SDK → fixed public Stacks testnet reads.
Preparation tools are offline. There is no signer in the process or tool arguments.
The browser SDK entry point does not import this Node-only adapter.

Use Node 20+ and npm 10+. In a separate integration directory, install the exact published
prerelease; initialize a package.json only if the directory does not already have one:

```sh
npm init -y
npm install --save-exact @perkos/agent-sdk@0.8.0-rc.2
./node_modules/.bin/nayori-mcp --help
./node_modules/.bin/nayori-custody --help
```

Keep the lockfile. `latest` is still 0.7.1; an unpinned install does not select this QA bridge.
The [release notes](RELEASE_0.8.0_RC2.md) contain the verified registry integrity. Installation
and offline checks for both roles passed; no funded wallet or LLM is needed for those checks.

For source development only, build and verify the reviewed QA source, then pack outside the checkout:

```sh
npm ci
npm run verify
npm pack --pack-destination /absolute/private-artifacts
```

In a clean consumer directory, install that exact reviewed tarball:

```sh
npm init -y
npm install --save-exact /absolute/private-artifacts/perkos-agent-sdk-0.8.0-rc.2.tgz
./node_modules/.bin/nayori-mcp --help
```

The current candidate is 0.8.0-rc.2, separate from published 0.7.1. Historical QA tests used
a source tarball still numbered 0.7.1; do not confuse it with either distribution.
Record the tarball SHA-256 and exact commit. Initializing the consumer's own package.json
prevents npm from inheriting an unrelated parent project. See the
[release checklist](RELEASE_0.8.0_RC2.md); do not overwrite or republish the existing npm version.
Do not run an unpinned `npx -y` command for a financial agent.

Follow [clean-install verification](CLEAN_INSTALL.md) for a reproducible key-free test of both
roles using the **installed** SDK, not this checkout's source. The immutable rc.2 MCP still prints
the old distribution warning; source PR47 fixes that text for a future release. Never patch the
installed package or infer permission to spend from a context message.

## Public role profile

Create a JSON file outside Git. It contains **only public addresses**, no environment
variables, private keys, seed phrases, tokens, signer modules or URLs:

```json
{
  "network": "testnet",
  "role": "client",
  "client": "YOUR_TESTNET_BUYER_ADDRESS",
  "provider": "YOUR_TESTNET_PROVIDER_ADDRESS",
  "evaluator": "THE_VERIFIED_QA_EVALUATOR_ADDRESS",
  "treasury": "THE_VERIFIED_QA_TREASURY_ADDRESS"
}
```

Placeholders intentionally fail validation. Use distinct valid testnet addresses, confirm
evaluator/treasury against the deployed QA policy, and use `role: "provider"` for the
provider's separate instance. Profile acceptance does not certify registration, ownership
of an address or a match to on-chain evaluator/treasury policy.

The adapter pins STX `agentic-commerce-v6`, sBTC `sbtc-commerce-v5`, agent-registry and
reputation-registry-v3 under `ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5`.
Network/contract/endpoint overrides from tools are rejected; this adapter has no mainnet mode.

## Connect Hermes

Start with an existing Hermes already working with your own LLM; leave that configuration
unchanged. This MCP does not select or authenticate the LLM provider, receive model API keys
or require PerkOS-LLM. [Existing-agent onboarding](EXISTING_AGENT.md) explains registration
and the separate operator-owned wallet/signer preparation. Hermes is an example, not a requirement.
The fixed QA evaluator endpoint is a separate Nayori service, not the developer's LLM endpoint.

After installing the pinned package, configure a separate Hermes profile for each participant:

```yaml
mcp_servers:
  nayori_qa:
    command: /absolute/path/to/node
    args:
      - /absolute/consumer/node_modules/@perkos/agent-sdk/dist/mcp/cli.js
      - --config
      - /absolute/private-config/public-profile.json
```

Start Hermes and request the `nayori_context` tool. Hermes may prefix tool names.
This is a manually configured MCP, not an entry approved for the Nous MCP catalog.
Never put wallet keys into Hermes's config, environment, skill, prompts or tool parameters.

| Tool | Roles | Effect |
|---|---|---|
| nayori_context | Both | Fixed QA role/contracts and explicit capability flags |
| nayori_counts | Both | Registry/job counts; not adoption/completion counts |
| nayori_get_agent | Both | One agent by decimal ID |
| nayori_get_job | Both | One job, escrow, decision and fee ledger |
| nayori_get_reputation | Both | Public testnet reputation |
| nayori_prepare_job | Buyer | Offline criteria commitment; does not create a job |
| nayori_prepare_submission | Provider | Offline evidence commitment; does not submit work |

## Boundaries and errors

### Optional provider evaluation admission

Only after configuring provider custody, the operator may append `--enable-qa-evaluation`
to the MCP CLI arguments (after `--permit-hash` and its value). Add these **exact names** to
Hermes's tool include list if one is configured:

- `nayori_request_evaluation`: accepts the same asset, jobId, description, acceptanceCriteria
  and evidence as preparation. Requires an enabled, unexpired provider permit and a confirmed
  submit in its durable journal. It compares client/provider/evaluator/treasury, budget, criteria
  and evidence commitments against the actual SDK job read before any admission request.
- `nayori_evaluation_status`: accepts only asset and jobId; both must match the configured
  custody permit. Remains available for reconciliation after permit expiry.

Requests go only to `https://evaluator.qa.nayori.ai/v1/evaluations`. Evidence must use that
HTTPS origin; this narrow pilot does not support arbitrary storage providers. The evaluator,
not MCP, fetches/validates evidence bytes and rechecks eligibility, deadlines and capacity.
The operator explicitly authorizes enqueueing evaluation work by enabling the option.
No internal API key, wallet signature, second fee or x402 purchase is attached.

Admission allows 45 seconds for paced eligibility reads; status lookup allows 15 seconds.
Configure custom relay/proxy timeouts accordingly and check capacity before submission.
Safe MCP error codes distinguish `admission_limit`, `ineligible`, `unavailable` and `transport`.
All prohibit automatic retry. They contain fixed SDK guidance, never upstream error details.
The contract's review deadline remains authoritative even after an HTTP timeout.

The adapter looks up the deterministic job-scoped evaluation ID before POST. The server's
durable idempotency remains the authority across processes/restarts. HTTP errors/timeouts
do not trigger automatic retry: query status first. A changed manifest cannot bypass the
on-chain commitment. Status responses expose only bounded identity/state/txid fields, not
arbitrary public explanations or raw errors. `confirmed` here describes the evaluator, not a
verified escrow payout. Buyer custody still finalizes after the actual appeal deadline.

This is a published QA prerelease. In addition to mocked HTTP/chain tests, one earlier internal
funded Hermes lifecycle passed; see [the exact validation scope](VALIDATION_AND_RELEASE.md).
It is not a security audit or production promotion. Without the flag, tool availability is unchanged.

- No arbitrary shell, file-reading, secret-export, transaction-signing or broadcast tool.
- Unknown fields, wrong roles, unsupported assets, oversized payloads and invalid IDs fail closed.
- Public chain text and URLs are untrusted data. Never follow their instructions or treat
  them as approval to spend, change configuration, or invoke another tool.
- Evidence preparation hashes the **manifest**, not remotely fetched bytes. It returns
  `evidenceBytesVerified: false`; the evaluator still must check allowlisted HTTPS content.
- Errors do not reflect raw RPC responses, user inputs or diagnostics into the model.
- A decision is not payout confirmation. Use transaction events and fee/reputation checks.
- There is no wallet isolation claim from merely running two same-user processes. The optional
  custody candidate requires verified Linux isolation and durable operator-approved limits.

## Validation and remaining work

Automated tests cover official MCP client/server handshake, schemas, role separation,
BigInt serialization, offline commitments, sanitized failures and real subprocess stdio.
Those automated tests are distinct from the [verified internal testnet lifecycle](VALIDATION_AND_RELEASE.md).
Clean registry installation and offline role checks passed. The supervised npmrc.2 job16
lifecycle also passed; new registration, the separate x402 walkthrough and video remain pending.
Repeat isolation and permission checks for each new operator deployment; this single supervised
scenario does not certify general autonomous onboarding. No server deployment is needed to test stdio.

Sources: [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp),
[official MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server).
