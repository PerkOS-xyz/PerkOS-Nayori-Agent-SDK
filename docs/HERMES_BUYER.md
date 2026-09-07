# Hermes buyer — controlled QA walkthrough

**Unreleased candidate; not yet a completed funded autonomous onboarding.** Follow this with a
separate provider operator. Do not substitute mainnet URLs or assume the published npm 0.7.1
contains these tools. This guide is the recording checklist, not evidence that every step passed.

## 1. Operator prerequisites

### Bring your working agent

Your Hermes is already installed and working with your own LLM. Keep that configuration;
this guide adds Nayori tools, not a model provider. No PerkOS-LLM account, model migration or
model API key shared with Nayori is required. Hermes is an example, not a platform requirement.
Start with [existing-agent onboarding](EXISTING_AGENT.md) and the separate
[operator wallet/signer checklist](WALLET_SIGNER_SETUP.md). Keep model credentials out of
prompts, MCP arguments and recordings. Your agent's model is separate from Nayori's evaluator.

- Create and back up a dedicated Stacks testnet wallet **outside Nayori and outside Hermes**.
  Use your own Stacks.js signer or the reviewed isolated custody pilot. Wallet creation,
  key recovery and funding remain operator responsibilities, not SDK tools.
- Verify the restored key derives the expected address before funding. Never display keys,
  recovery material, environment contents or authorization headers in a recording.
- Keep the buyer key only inside its signer boundary. Hermes must not share that UID,
  key mount, writable policy, Docker socket, sudo or access to the provider's socket.
- Install the exact reviewed QA tarball as described in [MCP setup](HERMES_MCP.md).
  Record source SHA and artifact SHA-256. Do not use unpinned `npx` or confuse candidate
  version 0.7.1 with the different publicly distributed 0.7.1 artifact.

## 2. Configure and verify permissions

Create the public profile with `role: client` and four distinct, verified buyer/provider/
evaluator/treasury addresses. Follow [custody permissions](HERMES_CUSTODY.md) for a short-lived
permit, private journal and socket. Start with signing disabled and no funded key loaded.

The pilot allows at most one job per permit: up to 1000 atomic sBTC units or 100000 micro-STX,
5000 micro-STX gas reserved per action and no more than 35000 total per permit. Limits are
caps, not a live network fee quote. The buyer's six actions normally require a 30000 cap.
Accept the included 200 bps evaluation-earned fee and net refund after evaluated rejection.

Configure Hermes using the exact paths in MCP setup. Verify `nayori_context` reports
testnet, your wallet and the fixed v6/v5 contracts. With custody, verify
`nayori_custody_status` reports the intended permit and zero unexpected operations. A context
response does not prove wallet ownership or successful registration.

## 3. Execute one real job

After operator review, isolation tests, backup and explicit low-value testnet funding:

1. Enable testnet signing in the **signer service**, not in Hermes's environment.
2. Ask Hermes to call `nayori_execute` with `{"action":"register"}`. Confirm the saved txid
   and agent ID. Do not repeat registration under a new permit because a response is slow.
3. Define a real small task and objective acceptance criteria in the operator permit.
   `nayori_prepare_job` previews the commitment; it does not create or authorize a job.
4. Execute `create`, then query custody status until its returned job ID is confirmed.
5. Execute `set-budget`, `fund`, then `assign`, confirming each before the next. In the
   custody pilot confirmation includes six subsequent burn blocks, not six Stacks blocks.
6. Give the confirmed public job ID to the provider operator. The buyer assigns the provider;
   the provider cannot self-assign. The provider verifies escrow before doing work.
7. Track `nayori_get_job`. The provider delivers and, if explicitly enabled, requests public
   QA evaluation. Buyer and provider do not possess the evaluator key.
8. Read the actual on-chain decision and appeal deadline. For an unappealed decision, call
   buyer `finalize` only after the deadline. The pilot blocks appealed jobs for human handling.
9. Independently inspect transaction events, terminal state, zero escrow, exact provider/
   treasury payouts and reputation. For approved gross 1000 sBTC units, expect 980 provider
   and 20 treasury under the configured 200 bps policy. A decision alone is not payment.

## 4. Failure and recovery

Query custody/evaluation status before retrying. Preserve the same permit, journal, job and
txid. A reserved operation without saved txid may already have signed: stop and investigate.
Do not delete locks/journals, change nonce, increase gas or authorize a duplicate payment to
make an error disappear. Recovery requires operator review of chain, nonce, mempool and events.

## 5. Separate paid-resource and recording gates

The current MCP does **not** purchase x402 resources. The [x402 paying flow](X402_PAYMENTS.md)
needs its own permission, budget and successful walkthrough before a video claims that
capability. Evaluation admission does not add a second x402 fee to this job.

Record installation, public profile, tool discovery, actual registration/job/funding/assignment,
provider handoff, decision and settlement. Label edited waiting periods. Keep private setup off
screen. Keep the video and internal receipts outside the repository. Our controlled wallets are
`internal-team-operated-not-m2-adoption`, not external grant adoption.
