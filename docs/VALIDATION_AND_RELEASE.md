# Hermes validation and release boundary

## What was verified

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
| Published QA prerelease | npm 0.8.0-rc.1 under `next`; clean registry installation and offline role checks passed; see [release notes](RELEASE_0.8.0_RC1.md) |

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

- A new funded npm-only lifecycle, new-agent registration in this cycle, and the developer video.
- Autonomous operation from one instruction without the operator's staged gates.
- The separate x402/MPP resource-purchase workflow; local QA MCP does not purchase x402.
- Other assets, rejection/appeal/recovery scenarios, or production fee activation.
- External security review or independent adoption: these participants are team-operated testnet actors.

Continue with the [buyer](HERMES_BUYER.md), [provider](HERMES_PROVIDER.md) and
[checkpoint](HERMES_CHECKPOINTS.md) manuals. Every new funded scenario requires its own reviewed
permissions and budget; never reuse this completed job's authorization.
