# Operator-owned wallet and signer preparation

This is a separate operator checklist, **not a Nayori wallet-generation or custody service**.
Your existing agent and LLM are already running. Return to [agent onboarding](EXISTING_AGENT.md)
after preparing a signer. Nayori never needs your private key or model-provider credentials.

## Existing wallet or new wallet

Reuse a dedicated testnet signer if it meets these controls. Otherwise create a dedicated wallet
using your reviewed Stacks-compatible wallet tooling or a separately maintained Stacks.js operator
utility. Verify the dependency/version and network; do not ask an LLM to invent a key or use a
public test fixture. Keep generation and recovery outside the Nayori SDK and agent's tool set.

1. Store the key in your own protected signer storage, outside repositories and agent-readable
   files. Encrypt backups under operator control. A mode-0600 file alone is not an encrypted backup.
2. Verify restoration derives the same public testnet address before funding. Never show the key
   or recovery phrase in tickets, prompts, logs, terminal recordings or documentation.
3. Give each independently operated buyer/provider a separate identity and signer boundary.
   Keep transaction sender and the intended registered metadata wallet aligned; registry ownership
   follows `creator` (transaction sender), not an arbitrary metadata wallet.
4. Fund only the test assets and STX network fees needed for the authorized test. Do not send
   mainnet assets to an example/fixture or assume a displayed testnet balance is spendable mainnet value.

## Human-approved or autonomous signatures

- A browser wallet can request human approval through the SDK's browser signer interface.
- An autonomous agent requests a bounded operation from **your own signer service**. An
  operator-maintained Stacks.js implementation can validate, construct and sign transactions.
  This library option is not a turnkey managed signing service supplied by Nayori.
- Integrate your signer through the documented `PerkOSSigner` interface or the reviewed QA
  custody bridge. A callback that loads a key in the LLM's process is not an isolation boundary.

Before enabling autonomous signing, enforce:

- Authenticated caller and role; allowed network, contracts, functions and recipients.
- Explicit per-operation amount, total budget, expiry, asset and STX gas caps.
- Exact arguments/post-conditions; no arbitrary transaction bytes or module paths selected by an LLM.
- Separate OS identity/process and private mounts; no shared key access, sudo or Docker socket.
- Durable intent/nonce/txid journal and serialized use of one wallet across workers.
- Stop on ambiguous signing/broadcast; inspect chain/mempool before retrying, never delete the journal.
- An operator-controlled disable switch; test denied actions with signing off first.

SDK spending policies are per-process checks, not a replacement for persistent signer-side
authorization. The candidate [custody guide](HERMES_CUSTODY.md) documents a restricted QA example;
it is not a general-purpose production custody service or externally audited wallet manager.

## Safe handoff to the agent

Provide only public network/identity/configuration and the restricted tool or authenticated IPC
entry point. Keep signer credentials out of prompts and tool arguments. Prove that an allowed
testnet registration can be requested, a forbidden role/action is denied and the agent cannot
read key material. Then continue with [registration and confirmation](EXISTING_AGENT.md#4-register-and-verify-the-agent).
