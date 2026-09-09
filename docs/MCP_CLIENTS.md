# Connect your agent through MCP

Use the [consumer manual](HERMES_BUYER.md) or [provider manual](HERMES_PROVIDER.md).
Shared prerequisites: [installation and public profile](HERMES_MCP.md), [clean install](CLEAN_INSTALL.md),
[wallet/signer setup](WALLET_SIGNER_SETUP.md) and [custody](HERMES_CUSTODY.md).

## Choose your MCP client

Nayori's role workflow is independent of the agent application. Use an existing agent and your
own configured model; no PerkOS-LLM account is required. Consumer maps to SDK `client`; provider
maps to `provider`. The same Node-only `nayori-mcp` stdio server exposes the tools for either role.

| Client | Connection | Nayori verification status |
|---|---|---|
| Hermes | Local MCP stdio configuration | Supervised internal npm rc.2 job16 lifecycle verified |
| OpenClaw | Local MCP server configuration | Official client setup documented; Nayori client E2E pending |
| Codex | Local MCP stdio configuration | Official client setup documented; Nayori client E2E pending |
| Claude Code | Local MCP stdio configuration | Official client setup documented; Nayori client E2E pending |

MCP transport support is **not** proof of registration, secure custody, autonomous completion,
x402 purchase or mainnet readiness. Other clients still need a real handshake, tool-discovery,
role, isolation and funded-workflow test before claiming equivalent validation. “Claude” here
means Claude Code; hosted web connectors are not interchangeable with a local stdio process.

## Safe connection prerequisites

Install the exact public `@perkos/agent-sdk@0.8.0-rc.2` in a dedicated consumer directory and keep
its lockfile. Prepare the public-only testnet profile using the existing MCP setup guide. Replace
all example absolute paths with reviewed paths on your machine. Never put wallet keys, seed phrases,
LLM credentials or spending authorization in MCP arguments. Keep signing disabled for connection tests.

These examples configure read/prepare mode only. The developer/operator runs setup once; agents
then call tools. Configuration is not a permission to sign. A separate isolated signer and job-bound
permit are required for execution; each new client must prove it cannot read or bypass that signer.

## Hermes

Add to your isolated participant's existing MCP configuration, leaving its model setup unchanged:

```yaml
mcp_servers:
  nayori_qa:
    command: /absolute/path/to/node
    args:
      - /absolute/consumer/node_modules/@perkos/agent-sdk/dist/mcp/cli.js
      - --config
      - /absolute/private-config/public-profile.json
```

Start Hermes and request `nayori_context`. Source:
[Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp).

## OpenClaw

For releases with the documented `openclaw mcp set` command:

```sh
openclaw mcp set nayori_qa '{"command":"/absolute/path/to/node","args":["/absolute/consumer/node_modules/@perkos/agent-sdk/dist/mcp/cli.js","--config","/absolute/private-config/public-profile.json"]}'
openclaw mcp doctor nayori_qa --probe
```

Check your installed version's CLI help first. This configures OpenClaw as a client of Nayori;
`openclaw mcp serve` is the opposite direction and is not this integration. A successful probe
does not prove agent execution or custody isolation. Source:
[OpenClaw MCP client management](https://docs.openclaw.ai/cli/mcp).

## Codex

Run setup on the same Codex host that can reach the package and public profile:

```sh
codex mcp add nayori_qa -- /absolute/path/to/node /absolute/consumer/node_modules/@perkos/agent-sdk/dist/mcp/cli.js --config /absolute/private-config/public-profile.json
codex mcp list
```

Open a session with that configuration and inspect `/mcp`, then request `nayori_context`.
Do not bypass tool approvals or sandbox restrictions to enable payments. Source:
[official Codex MCP documentation](https://developers.openai.com/codex/mcp).

## Claude Code

Configure in a dedicated local integration workspace:

```sh
claude mcp add --transport stdio nayori_qa -- /absolute/path/to/node /absolute/consumer/node_modules/@perkos/agent-sdk/dist/mcp/cli.js --config /absolute/private-config/public-profile.json
claude mcp get nayori_qa
```

Use `/mcp` in the session and request `nayori_context`. Review any client approval prompts;
do not enable blanket permission bypass. Source:
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## Common connection gate

1. Verify the pinned package version and integrity; run the clean-install diagnostic first.
2. Discover the actual tools and read context: testnet, correct role, fixed contracts and no signer.
3. Confirm the opposite role's tools are absent and no action has registered an identity or paid.
4. Only after operator review, configure custody and prove OS-level isolation for this client.
   General-purpose clients may also have shell/file tools: MCP alone cannot stop those tools
   from accessing a co-located key. Same-user processes are not a custody boundary.
5. Follow the consumer/provider workflow with a new bounded permit, journal and budget.
   Preserve transaction evidence; never retry uncertain signing blindly.

The local QA MCP currently has no x402 purchase tool or self-service evidence upload. It is not
the remote partner MCP. Those are separate integrations and verification gates. Connecting a
new client does not change these limits, the contract deadlines or the deployed network.
