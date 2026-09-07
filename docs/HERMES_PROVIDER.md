# Hermes provider — controlled QA walkthrough

See [QA checkpoints and confirmation handling](HERMES_CHECKPOINTS.md) for the job-bound permit,
STX gas budget, six-burn gate and the difference between a decision and payment. Do not fund
your wallet with sBTC merely to receive a payout or reuse an example job ID.

**Unreleased candidate; funded autonomous onboarding and recording still require validation.**
Use the same job as the [buyer walkthrough](HERMES_BUYER.md), with a different wallet, signer,
Hermes instance and journal. The candidate MCP is not the npm 0.7.1 release.

## 1. Install and prepare your wallet externally

Your Hermes is already installed and working with your own LLM. Keep that setup; this guide
adds Nayori tools without configuring or replacing your model. No PerkOS-LLM account or model
API key shared with Nayori is required. Hermes is an example, not a platform requirement.
Start with [existing-agent onboarding](EXISTING_AGENT.md) and the separate
[operator wallet/signer checklist](WALLET_SIGNER_SETUP.md). Never put model credentials in
tool arguments or recordings. Your agent's model is separate from Nayori's evaluator.

Follow [MCP installation](HERMES_MCP.md) with the exact reviewed tarball/source hash. Create,
back up and restore-check your own testnet wallet outside the SDK and Hermes. Fund only
authorized STX network fees; a provider does not need to send sBTC to receive a job payment.
Never give Hermes your key or the buyer/evaluator/treasury keys. Follow the separate-UID,
filesystem, socket and capability restrictions in [custody setup](HERMES_CUSTODY.md).

Configure `role: provider`. The operator permit must reference the buyer's confirmed job ID,
same criteria, identities, amount and expiry, with only `register` and `submit`. Start with
signing disabled and confirm tool context and custody status. Allow evaluation separately only
if this operator consents to enqueueing review of this job.

## 2. Confirm assignment and perform the work

1. With explicit low-value testnet permission, enable the isolated signer and request `register`.
   Confirm the transaction and agent record. Wallet creation is not registration.
2. Read the job using `nayori_get_job`. Confirm provider equals your address, status is funded,
   escrow equals the agreed gross amount and client/evaluator/treasury/criteria are correct.
3. Do not self-assign or work against missing escrow. Ask the buyer to resolve mismatches.
4. Have the real Hermes perform the agreed task. Preserve its actual output, including errors;
   do not substitute a canned result and call it autonomous execution.
5. Publish the small evidence artifact through the operator-approved QA evidence workflow.
   This MCP does not include an upload tool. The pilot accepts evidence only from the fixed
   evaluator QA HTTPS origin; publishing to arbitrary hosts is not supported in this bridge.
6. Compute the actual artifact's SHA-256, MIME and byte count. Prepare its manifest with
   `nayori_prepare_submission`. Preparation hashes the manifest and does not verify remote bytes.
7. Request `nayori_execute` with `action: submit` and the exact evidence manifest. Confirm the
   saved transaction and job submission, including the configured six subsequent burn blocks.

## 3. Request public evaluation, without internal credentials

Append `--enable-qa-evaluation` to provider MCP arguments after the custody socket/permit
configuration. If Hermes uses tool filtering, add the exact names `nayori_request_evaluation`
and `nayori_evaluation_status`. Without this operator flag the tools are absent.

Call `nayori_request_evaluation` with the same asset, jobId, description, acceptanceCriteria
and evidence used for commitments. It checks the permitted job, confirmed submission and
on-chain identities/budget/commitments, then uses the deterministic job-scoped evaluation ID.
It sends no bearer token, wallet key or additional payment. The evaluator independently checks
eligibility and evidence bytes; no agent can approve itself through this endpoint.

If a response times out, call `nayori_evaluation_status` with asset and jobId before retrying.
Do not change the evidence or create another job to bypass a failed review. Admission is not
approval; evaluator `confirmed` is not proof that escrow has been paid out.

## 4. Verify outcome and payment

Read the decision and explanation through the public evaluation/chain evidence surfaces. The
buyer finalizes after the real appeal deadline when no appeal exists. This provider pilot does
not expose finalize, appeal or admin actions. If a rejection needs appeal, involve the operator
and supported app/SDK appeal workflow; do not claim the restricted MCP handles it automatically.

Check the terminal job, escrow zero, exact payout to your wallet, treasury fee and reputation.
For approved 1000 sBTC units and 200 bps, net payment is 980 and treasury receives 20. The
fee remains within escrow until settlement. Do not infer success from an HTTP 202 or txid alone.

## 5. Recording and current boundaries

Record the same job from the provider's perspective: installation, external wallet setup
without showing secrets, registration, assignment check, actual work, evidence, submission,
evaluation status and payment. Show public transaction links and label waiting-period edits.
The x402 resource-purchase walkthrough is a separate pending integration; do not describe
evaluation admission as an x402 payment. Our internal controlled agents are not external adoption.
