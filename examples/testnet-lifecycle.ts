/**
 * Role-separated QA example. Preview is offline; live actions require explicit consent.
 * No evaluator key, fake deliverable, automatic retries or mainnet path.
 */
import { mkdirSync, readFileSync, rmdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { PerkOSClient, prepareEvaluationJob, prepareEvaluationSubmission, evaluationJobId,
  type CriteriaCommitmentInput, type EvaluationEvidence, type PerkOSSigner, type ServiceFeeAcceptance,
} from "@perkos/agent-sdk";
import { QuickstartJournal, checkpointedTransaction, intentHash } from "./testnet-journal.js";

const DEPLOYER = "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5";
const API = "https://api.testnet.hiro.so";
const contracts = {
  stxCommerce: `${DEPLOYER}.agentic-commerce-v6` as const,
  sbtcCommerce: `${DEPLOYER}.sbtc-commerce-v5` as const,
};
const steps = ["register", "create", "set-budget", "fund", "assign", "submit", "evaluate", "status", "finalize"] as const;
type Step = typeof steps[number];
interface RunConfig extends Omit<CriteriaCommitmentInput, "contract"> {
  role: "client" | "provider";
  provider: string;
  treasury: string;
  amount: string;
  expiredAt: string;
  jobId?: string;
  agentName?: string;
  evidence?: readonly EvaluationEvidence[];
}
function ensure(ok: boolean, reason: string): asserts ok { if (!ok) throw new Error(reason); }
function loadRun(path: string): RunConfig {
  ensure(isAbsolute(path), "absolute_config_required");
  const input = JSON.parse(readFileSync(path, "utf8")) as RunConfig;
  ensure(input.network === "testnet" && ["stx", "sbtc"].includes(input.asset), "testnet_only");
  ensure(["client", "provider"].includes(input.role), "invalid_role");
  ensure([input.client, input.provider, input.evaluator, input.treasury].every(value => /^ST[A-Z0-9]{20,41}$/.test(value)) &&
    new Set([input.client, input.provider, input.evaluator, input.treasury]).size === 4, "distinct_testnet_roles_required");
  ensure(/^[1-9][0-9]*$/.test(input.amount) && BigInt(input.amount) <= (input.asset === "sbtc" ? 1000n : 100000n), "test_amount_cap");
  ensure(/^[1-9][0-9]*$/.test(input.expiredAt), "expiry_required");
  ensure(input.jobId === undefined || /^[1-9][0-9]*$/.test(input.jobId), "invalid_job_id");
  return input;
}
async function tip() {
  const response = await fetch(API + "/v2/info", { redirect: "error", signal: AbortSignal.timeout(15000) });
  ensure(response.ok, "testnet_unavailable");
  const info = await response.json() as Record<string, unknown>;
  ensure(info.network_id === 2147483648, "wrong_network");
  const burn = info.burn_block_height;
  ensure(typeof burn === "number" && Number.isSafeInteger(burn) && burn >= 0, "invalid_burn_height");
  const stacks = info.stacks_tip_height;
  ensure(typeof stacks === "number" && Number.isSafeInteger(stacks) && stacks >= 0, "invalid_stacks_height");
  return { burn: BigInt(burn), stacks: BigInt(stacks) };
}
function print(value: unknown) {
  console.log(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item, 2));
}
async function main() {
  const action = process.env.PERKOS_ACTION ?? "preview";
  if (action === "preview") {
    print({ mode: "offline-preview", network: "testnet", contracts, steps,
      note: "Client creates/funds/assigns; provider submits actual evidence. The isolated evaluator records a decision; finalize waits for the appeal deadline. No signer or network used." });
    return;
  }
  ensure(steps.includes(action as Step), "unknown_action");
  const step = action as Step;
  ensure(process.env.PERKOS_CONFIRM_TESTNET_BROADCAST === "yes" || step === "status", "explicit_testnet_consent_required");
  const run = loadRun(process.env.PERKOS_RUN_CONFIG ?? "");
  const contract = run.asset === "stx" ? contracts.stxCommerce : contracts.sbtcCommerce;
  const input = { ...run, contract };
  const prepared = await prepareEvaluationJob(input);
  const wallet = run.role === "client" ? run.client : run.provider;
  const amount = BigInt(run.amount);
  const id = run.jobId ? BigInt(run.jobId) : undefined;
  const config = { network: "testnet" as const, apiUrl: API, contracts,
    spendingPolicy: { allowedNetworks: ["testnet"] as const, allowedAssets: [run.asset],
      maxPerTransaction: { [run.asset]: amount }, maxPerSession: { [run.asset]: amount } } };
  const reader = new PerkOSClient(config);
  const { burn, stacks } = await tip();
  if (step === "status") {
    ensure(id !== undefined, "job_id_required");
    const job = await reader.getJob(run.asset, id);
    const decision = await reader.getDecision(run.asset, id);
    const escrow = await reader.getEscrowBalance(run.asset, id);
    print({ job, decision, escrow, burn,
      note: "A decision is not a payout. Confirm settlement transfers and reputation separately." });
    return;
  }
  ensure(!["create", "set-budget", "fund", "assign", "finalize"].includes(step) || run.role === "client", "client_role_required");
  ensure(step !== "submit" || run.role === "provider", "provider_role_required");
  ensure(["register", "create"].includes(step) || id !== undefined, "job_id_required");
  const acceptance: ServiceFeeAcceptance = { gross: amount, basisPoints: 200,
    treasury: run.treasury, rejectionRefund: "net-after-evaluation" };
  if (["fund", "submit"].includes(step)) ensure(
    process.env.PERKOS_ACCEPT_SERVICE_FEE === "200bps-net-after-evaluation", "explicit_service_fee_consent_required");

  async function currentJob() {
    ensure(id !== undefined, "job_id_required");
    const job = await reader.getJob(run.asset, id);
    ensure(!!job && job.client === run.client && job.evaluator === run.evaluator &&
      job.description === prepared.description && job.treasury === run.treasury, "job_snapshot_mismatch");
    return job;
  }
  if (step === "evaluate") {
    const job = await currentJob();
    ensure(job.status === "submitted" && job.provider === run.provider && job.reviewDeadline !== undefined, "job_not_submitted");
    const committed = await prepareEvaluationSubmission({ ...input, jobId: run.jobId!, evidence: run.evidence ?? [] });
    ensure(job.deliverable?.replace(/^0x/, "") === Buffer.from(committed.deliverable).toString("hex"), "evidence_mismatch");
    // An explicit QA origin is required. No bearer token or evaluator key is used.
    const endpoint = new URL(process.env.PERKOS_EVALUATOR_URL ?? "");
    ensure(endpoint.protocol === "https:" && !endpoint.username && !endpoint.password &&
      endpoint.pathname === "/" && !endpoint.search && !endpoint.hash, "https_evaluator_origin_required");
    const response = await fetch(new URL("/v1/evaluations", endpoint), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(120000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commitmentVersion: "1", evaluationId: await evaluationJobId({
        network: "testnet", contract, jobId: run.jobId! }), network: "testnet", asset: run.asset, contract, jobId: run.jobId,
        job: { client: run.client, provider: run.provider, evaluator: run.evaluator,
          status: "submitted", description: job.description, reviewDeadlineBurn: job.reviewDeadline.toString() },
        acceptanceCriteria: run.acceptanceCriteria, evidence: run.evidence }),
    });
    ensure(response.status === 202, "evaluation_not_admitted");
    print({ admitted: true, evaluationId: await evaluationJobId({ network: "testnet", contract, jobId: run.jobId! }),
      note: "Queued is not approved or paid. Poll the evaluation status and the on-chain job." });
    return;
  }

  const journalPath = process.env.PERKOS_JOURNAL ?? "";
  ensure(isAbsolute(journalPath), "absolute_journal_required");
  // Atomic directory lock across processes. A crash deliberately leaves it for manual reconciliation.
  const lock = journalPath + ".lock";
  mkdirSync(lock, { mode: 0o700 });
  let journal: QuickstartJournal | undefined;
  try {
    journal = new QuickstartJournal(journalPath);
    const key = step + ":" + (["register", "create"].includes(step) ? "new" : run.jobId!);
    const intent = intentHash({ step, run, contract });
    const activeJournal = journal;
    const send = async () => {
      if (step === "create") ensure(BigInt(run.expiredAt) > stacks, "expired_job");
      if (!["register", "create"].includes(step)) {
        const job = await currentJob();
        ensure(job.budget === amount || step === "set-budget", "budget_mismatch");
        if (step === "set-budget") ensure(job.status === "open", "job_not_open");
        if (step === "fund") {
          ensure(job.status === "open" && await reader.getEscrowBalance(run.asset, id!) === 0n, "escrow_not_empty");
          const policy = await reader.getServiceFeePolicy(run.asset);
          ensure(policy.configured && policy.basisPoints === 200 && policy.treasury === run.treasury, "fee_policy_mismatch");
        }
        if (step === "assign") ensure(job.status === "funded" && !job.provider, "job_not_assignable");
        if (step === "submit") ensure(job.status === "funded" && job.provider === run.provider, "job_not_assigned_to_provider");
        if (step === "finalize") {
          const decision = await reader.getDecision(run.asset, id!);
          ensure(job.status === "decision-pending" && !!decision && !decision.appealedBy &&
            !decision.finalDecision && burn > decision.appealDeadline, "waiting_for_appeal_deadline_or_resolution");
        }
      }
      const signerPath = process.env.PERKOS_SIGNER_MODULE ?? "";
      ensure(isAbsolute(signerPath), "absolute_signer_module_required");
      const module = await import(pathToFileURL(signerPath).href) as { signer?: PerkOSSigner };
      const signer = module.signer;
      ensure(!!signer && await signer.getAddress() === wallet, "signer_role_mismatch");
      const client = new PerkOSClient({ ...config, signer: {
        getAddress: () => signer.getAddress(),
        signAndBroadcast: async plan => ({ txid: await checkpointedTransaction(
          activeJournal, key, intent, async () => (await signer.signAndBroadcast(plan)).txid,
        ) }),
      } });
      if (step === "register") return (await client.registerAgent({
        name: run.agentName ?? "Nayori QA participant", description: "Controlled QA participant", wallet, endpoints: [],
      })).txid;
      if (step === "create") return (await client.createJob({
        asset: run.asset, evaluator: run.evaluator, expiredAt: BigInt(run.expiredAt), description: prepared.description,
      })).txid;
      if (step === "set-budget") return (await client.setBudget({ asset: run.asset, jobId: id!, amount })).txid;
      if (step === "fund") return (await client.fundJob({ asset: run.asset, jobId: id!, amount, serviceFeeAcceptance: acceptance })).txid;
      if (step === "assign") return (await client.assignProvider({ asset: run.asset, jobId: id!, provider: run.provider })).txid;
      if (step === "submit") {
        const committed = await prepareEvaluationSubmission({ ...input, jobId: run.jobId!, evidence: run.evidence ?? [] });
        return (await client.submitWork({ asset: run.asset, jobId: id!, deliverable: committed.deliverable,
          serviceFeeAcceptance: acceptance })).txid;
      }
      return (await client.finalizeDecision(run.asset, id!)).txid;
    };
    // A prior signed attempt bypasses mutable preflight and only confirms its saved txid.
    const prior = journal.lookup(key, intent);
    const txid = prior ? await checkpointedTransaction(journal, key, intent, async () => {
      throw new Error("unexpected_retry");
    }) : await send();
    const confirmation = await reader.confirm(txid, { timeoutMs: 120000, pollIntervalMs: 10000 });
    print({ step, txid, status: confirmation.status, result: confirmation.result?.repr, block: confirmation.blockHeight });
    ensure(confirmation.status === "success", "not_confirmed_success_do_not_resend");
  } finally { journal?.close(); rmdirSync(lock); }
}
main().catch(() => {
  // Raw signer/network/schema errors can contain credentials. Details belong in operator diagnostics.
  console.error("Quickstart stopped safely. Verify config, on-chain state and journal before retrying; never delete an ambiguous attempt to resend.");
  process.exitCode = 1;
});
