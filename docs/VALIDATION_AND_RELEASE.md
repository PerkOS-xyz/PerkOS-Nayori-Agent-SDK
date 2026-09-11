# Hermes validation and release boundary

## Separate native MCP connection evidence — 2026-09-09 UTC

OpenClaw, Codex and Claude Code passed both-role connection checks using the published rc.2.
Codex also exercised context and unsigned preparation through its native app-server.
See [client versions and measured limits](MCP_CLIENTS.md#measured-connection-scope--2026-09-09).
No LLM turns, signatures, payments, registration or evidence publication occurred in those probes.
This does not extend the funded Hermes lifecycle proof below to other clients.

## Latest public npm lifecycle — job 16, 2026-09-09 UTC

The **published npm0.8.0-rc.2** completed a real, operator-supervised Hermes buyer/provider
testnet sBTC lifecycle: create → budget → fund → assign → actual work → submit → evaluate →
finalize. Both participants reused existing registered identities. New version2 permits used
workflow0/settlement6; no installed SDK modification or contract change was made.

- Contract: `ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5.sbtc-commerce-v5`, job16.
- Actual work:29+23, result52 and explanation. Public evidence bytes and commitments verified.
- [Submission](https://explorer.hiro.so/txid/0x20d98e4c492c448cf837c778772039275ed4011e46d0afb65c0e6597ba3167c7?chain=testnet).
- [Evaluator approve](https://explorer.hiro.so/txid/0x796b671236332398130a6bc9d200ec90839cc6ac8fc15daea1b7786619985476?chain=testnet).
- [Settlement](https://explorer.hiro.so/txid/0x5b4b36234631c8430c3b7540cd1495e6b7a0e9157f2dfd79fa9e58602b0ba6d5?chain=testnet): success `(ok true)`, Stacks block298365/burn14634.
- Exactly980 atomic sBTC to provider and20 to treasury; completed/u3, escrow0, final approve,
  no appeal, completed reputation2→3, no pending synchronization. Prior balance preserved.
- Final confirmation: burn14640 and custody `confirmed`; all six additional burn blocks passed.
- Observed27 Hermes attempts; evaluator maximum4, exact usage/cost not established. Gas50000
  micro-STX including incoming funding transactions. Budget closed; never reuse this permit.

The npm package came from the public registry, but orchestration and artifact publication were
operator-supervised. This is a **funded npm-only SDK artifact test**, not a promise of turnkey
external onboarding or single-prompt autonomy. One fund conversation completed without executing;
independent readback caught it before a bounded continuation. Submit/evaluate hit conversation
limits despite successful operations. Never repeat economic actions to improve a conversation label.

New-agent registration, HTTPx402/MPP purchases, public self-service evidence upload and developer
video are not demonstrated by job16. The older source proof below remains separate historical
evidence. Start a fresh installation with [the offline checkpoint](CLEAN_INSTALL.md).

## Historical source lifecycle — job 14

On 2026-09-08 UTC, one **internal, operator-supervised Stacks testnet** sBTC job completed
using real Hermes participants, the SDK/MCP tools, isolated policy signers and Nayori's evaluator.
This is evidence for one scenario, not certification of all workflows or external onboarding.

| Check | Observed result |
| --- | --- |
| SDK source | `fc0537477fda819fa9cce8e74e543be0d49ea3a4` on QA |
| Contract / job | `ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5.sbtc-commerce-v5`, job 14 |
| Participants | Existing registered agents, separate buyer/provider/evaluator roles |
| Workflow | Create → budget → fund → assign → actual work → submit → evaluate → finalize |
| Work | Compute 23 + 19 and explain; actual result 42 with an explanation |
| Outcome | Completed; zero escrow; exactly 980 atomic sBTC to provider and 20 to treasury |
| Reputation | One completed job, no disputed job; no pending synchronization |
| Confirmation | Finalization in burn 14234; six-burn custody gate passed at 14240 |

Public chain evidence:

- [Submission](https://explorer.hiro.so/txid/0x8c99de7f560e82da0483875677ab2de3370403e2a617dff445a77cff40f0da31?chain=testnet)
- [Evaluator approval](https://explorer.hiro.so/txid/0x2806cebb488794c6a8ff63bf9f437978dc7e492254974c3f06d400381b7a1f27?chain=testnet)
- [Final settlement, Stacks block 288396](https://explorer.hiro.so/txid/0x382e05645560acbd822f573cab6e32579ad1d8ad3d1598916f132b28b86cce4c?chain=testnet)

No new registration was performed in this cycle: existing records were verified and reused.
New developers must still follow [registration](EXISTING_AGENT.md); do not repeat registration
for an already active identity simply to match a video. Use your own agent, LLM and signer.
Do not send funds to the addresses in this historical evidence.

## Published package versus tested source

| Distribution | Boundary |
| --- | --- |
| npm `@perkos/agent-sdk@0.7.1` | Published v5/v4 baseline; does not include the local QA Hermes/custody/fee additions |
| Reviewed QA source above | Tested v6/v5 opt-in fee path, local Hermes MCP, custody and evaluation admission |
| Historical QA tarball used in the lifecycle | Reports version 0.7.1; source commit and artifact integrity distinguish it from npm |
| Historical QA prerelease | npm 0.8.0-rc.1, formerly under `next`; see [release notes](RELEASE_0.8.0_RC1.md) |
| Current pinned QA walkthrough | npm 0.8.0-rc.2, published under `next`; job16 above and [release notes](RELEASE_0.8.0_RC2.md) |

Do not describe the earlier funded lifecycle as an npm-only E2E. The separate 0.8.0-rc.1 registry
installation verified imports, CLI, version, buyer/provider MCP and offline preparation without
keys, signing or evaluator/LLM requests. Use the [pinned installation procedure](HERMES_MCP.md),
never an unpinned financial `npx`.

Before external distribution: review and merge the release changes, assign a new package version,
run the SDK gate, pack and inspect its allowlisted contents, then install that exact artifact in
a clean consumer. Verify imports, binaries and both role guides. Publish only after separate
release approval; verify registry integrity and repeat clean installation from the published
version. A QA merge, npm publication and production deployment are separate events.

## Report three independent outcomes

1. **Conversation:** Hermes must explicitly report `completed=true`; a `type: result` envelope
   alone is insufficient. A tool may have executed even when the conversation stopped at its limit.
2. **Operation:** preserve the actual intent, txid and journal; query the existing operation after
   timeout or interruption. Never re-sign merely because the conversation did not complete.
3. **Economics:** independently verify canonical success, confirmation depth, terminal job state,
   zero escrow, exact unique transfers and reputation. Evaluator approval is not payment.

Count persisted LLM attempts separately from received responses. Missing usage means **unknown**,
not zero. Track buyer, provider and evaluator independently; a configured maximum is a bound,
not an observed call count or bill. This cycle observed 26 Hermes calls; evaluator usage is bounded
by four calls but its exact count is not established by this report.

## Two different evidence hashes

The evaluator artifact/decision uses SHA-256 of the canonical evidence list. The SDK's versioned
submission commitment additionally binds domain, network, contract, job, roles and criteria.
These hashes are intentionally different. Recompute each from its own input: compare the
SDK commitment to `submit-work`/the job deliverable and the manifest hash to the evaluator
artifact/`record-decision`. Verify the public explanation digest and fetched evidence bytes too.
Never accept a mismatched hash by copying the expected value from the response under test.

## Still outside this proof

- New-agent registration in these cycles and the developer video. The funded npmrc.2 lifecycle is now verified above.
- Autonomous operation from one instruction without the operator's staged gates.
- The separate x402/MPP resource-purchase workflow; local QA MCP does not purchase x402.
- Other assets, rejection/appeal/recovery scenarios, or production fee activation.
- External security review or independent adoption: these participants are team-operated testnet actors.

Continue with the [consumer](HERMES_BUYER.md), [provider](HERMES_PROVIDER.md) and
[checkpoint](HERMES_CHECKPOINTS.md) manuals. Every new funded scenario requires its own reviewed
permissions and budget; never reuse this completed job's authorization.
