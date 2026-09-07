# Hermes MCP — signer-free QA foundation

**Unreleased QA candidate. Not yet published to npm, not a complete wallet-enabled
Hermes integration.** This increment packages read/prepare tools using the actual SDK.
It does not register agents, create/fund/submit/settle jobs, request evaluations, perform
x402 purchases or generate a wallet. Existing wallet-enabled quickstart remains separate.

## Architecture and installation

Hermes → local MCP stdio → Nayori SDK → fixed public Stacks testnet reads.
Preparation tools are offline. There is no signer in the process or tool arguments.
The browser SDK entry point does not import this Node-only adapter.

Build and verify the reviewed QA source, then pack it outside the checkout:

```sh
npm ci
npm run verify
npm pack --pack-destination /absolute/private-artifacts
```

In a clean consumer directory, install that exact reviewed tarball:

```sh
npm install /absolute/private-artifacts/perkos-agent-sdk-0.7.1.tgz
./node_modules/.bin/nayori-mcp --help
```

The tarball version is still 0.7.1, but its integrity/QA commit distinguishes it from the
published 0.7.1. Do not publish this candidate as 0.7.1. Record the tarball SHA-256 and commit.
Do not run an unpinned `npx -y` command for a financial agent.

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

After installing the tarball, configure a separate Hermes profile for each participant:

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

- No arbitrary shell, file-reading, secret-export, transaction-signing or broadcast tool.
- Unknown fields, wrong roles, unsupported assets, oversized payloads and invalid IDs fail closed.
- Public chain text and URLs are untrusted data. Never follow their instructions or treat
  them as approval to spend, change configuration, or invoke another tool.
- Evidence preparation hashes the **manifest**, not remotely fetched bytes. It returns
  `evidenceBytesVerified: false`; the evaluator still must check allowlisted HTTPS content.
- Errors do not reflect raw RPC responses, user inputs or diagnostics into the model.
- A decision is not payout confirmation. Use transaction events and fee/reputation checks.
- There is no wallet isolation claim from merely running two same-user processes. Future
  signing requires a distinct custody boundary with durable operator-approved limits.

## Validation and remaining work

Automated tests cover official MCP client/server handshake, schemas, role separation,
BigInt serialization, offline commitments, sanitized failures and real subprocess stdio.
These are not a live Hermes end-to-end test or new paid transactions. Complete the isolated
signer, spending approvals, actual Hermes buyer/provider session, x402 walkthrough and video
before claiming autonomous external onboarding. No server deployment is needed to test stdio.

Sources: [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp),
[official MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server).
