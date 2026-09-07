/** Optional public QA admission. Never holds evaluator credentials or wallet keys. */
import { evaluationJobId, prepareEvaluationJob, prepareEvaluationSubmission,
  type EvaluationCriterion, type EvaluationEvidence } from "../evaluation-commitments.js";
import type { PerkOSClient } from "../client.js";
import type { CustodyPort } from "../custody/socket.js";
import type { HermesProfile } from "./server.js";

export const QA_EVALUATOR = "https://evaluator.qa.nayori.ai";
const MAX = 32768;
function check(ok: unknown): asserts ok { if (!ok) throw new Error("qa_evaluation_guard_failed"); }
export interface EvaluationInput {
  asset: "stx" | "sbtc"; jobId: string; description: string;
  acceptanceCriteria: EvaluationCriterion[]; evidence: EvaluationEvidence[];
}
export interface EvaluationPort {
  request(input: EvaluationInput): Promise<unknown>;
  status(asset: "stx" | "sbtc", jobId: string): Promise<unknown>;
}
export function qaEvaluation(profile: Readonly<HermesProfile>, custody: CustodyPort,
  reader: Pick<PerkOSClient, "getJob" | "getEscrowBalance">,
  contracts: { stxCommerce: string; sbtcCommerce: string },
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): EvaluationPort {
  check(profile.role === "provider" && profile.network === "testnet");
  const contractsByAsset = { stx: contracts.stxCommerce, sbtc: contracts.sbtcCommerce };
  async function binding(asset: "stx" | "sbtc", jobId: string, mutating: boolean) {
    check((asset === "stx" || asset === "sbtc") && /^[1-9][0-9]{0,38}$/.test(jobId) && BigInt(jobId) < 2n ** 128n);
    const permit = await custody.status() as Record<string, unknown>;
    check(permit && permit.asset === asset && permit.jobId === jobId && permit.profile &&
      Object.entries(profile).every(([k, v]) => (permit.profile as Record<string, unknown>)[k] === v));
    check(typeof permit.amount === "string" && /^[1-9][0-9]*$/.test(permit.amount) &&
      BigInt(permit.amount) <= (asset === "sbtc" ? 1000n : 100000n));
    if (mutating) {
      check(permit.enabled === true && typeof permit.expiresAt === "string" && Date.now() < Date.parse(permit.expiresAt));
      check(Array.isArray(permit.operations) && permit.operations.some(e => e && e.action === "submit" && e.state === "confirmed"));
    }
    const contract = contractsByAsset[asset];
    return { contract, amount: BigInt(permit.amount), expiresAt: String(permit.expiresAt), id: await evaluationJobId({ network: "testnet", contract, jobId }) };
  }
  async function http(path: string, init?: RequestInit): Promise<{ code: number; data: Record<string, unknown> }> {
    const response = await fetchImpl(QA_EVALUATOR + path, { ...init, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { accept: "application/json", ...(init?.method === "POST" ? { "content-type": "application/json" } : {}) } });
    check([200, 202, 404].includes(response.status));
    check(Number(response.headers.get("content-length") ?? 0) <= MAX && response.body);
    const stream = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) { const next = await stream.read(); if (next.done) break;
        length += next.value.byteLength; check(length <= MAX); chunks.push(next.value); }
    } finally { await stream.cancel(); stream.releaseLock(); }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    check(data && typeof data === "object" && !Array.isArray(data));
    return { code: response.status, data: data as Record<string, unknown> };
  }
  function summary(data: Record<string, unknown>, id: string, contract: string, asset: string, jobId: string) {
    check(data.id === id && data.network === "testnet" && data.contract === contract && data.asset === asset && data.jobId === jobId);
    check(["queued", "leased", "blocked", "decision_ready", "broadcast_failed", "broadcast", "confirmed"].includes(String(data.status)));
    check(data.txid === undefined || typeof data.txid === "string" && /^(0x)?[a-f0-9]{64}$/.test(data.txid));
    // Do not reflect arbitrary public explanations, URLs, error text or response fields into the agent.
    return { evaluationId: id, asset, jobId, status: data.status, ...(data.txid ? { txid: data.txid } : {}),
      network: "testnet", settlementVerified: false, evidenceBytesVerified: false,
      note: "Evaluator status is not escrow settlement. Verify the on-chain decision, deadlines and payout separately." };
  }
  return {
    async status(asset, jobId) {
      const { contract, id } = await binding(asset, jobId, false);
      const result = await http("/v1/evaluations/" + id);
      if (result.code === 404) { check(result.data.error === "evaluation_not_found"); return { evaluationId: id, status: "not-found", settlementVerified: false }; }
      check(result.code === 200); return summary(result.data, id, contract, asset, jobId);
    },
    async request(input) {
      const { asset, jobId, description, acceptanceCriteria, evidence } = input;
      const { contract, amount, id, expiresAt } = await binding(asset, jobId, true);
      check(Array.isArray(evidence) && evidence.length > 0 && evidence.length <= 5);
      let total = 0;
      for (const e of evidence) {
        const url = new URL(e.uri);
        check(url.origin === QA_EVALUATOR && !url.username && !url.password && !url.hash);
        check(Number.isSafeInteger(e.sizeBytes) && e.sizeBytes >= 0 && e.sizeBytes <= 8192 &&
          (e.mediaType === "text/plain" || e.mediaType === "application/json")); total += e.sizeBytes;
      }
      check(total <= 16000);
      const common = { network: "testnet" as const, asset, contract, client: profile.client,
        evaluator: profile.evaluator, description, acceptanceCriteria };
      const prepared = await prepareEvaluationJob(common);
      const submission = await prepareEvaluationSubmission({ ...common, provider: profile.provider, jobId, evidence });
      const job = await reader.getJob(asset, BigInt(jobId));
      check(job && job.id === BigInt(jobId) && job.asset === asset && job.client === profile.client &&
        job.provider === profile.provider && job.evaluator === profile.evaluator && job.treasury === profile.treasury &&
        job.budget === amount && job.description === prepared.description &&
        job.deliverable?.replace(/^0x/, "") === Buffer.from(submission.deliverable).toString("hex"));
      // Lookup first: a retry after an HTTP timeout must reuse the server's deterministic durable ID.
      const prior = await http("/v1/evaluations/" + id);
      if (prior.code === 200) return summary(prior.data, id, contract, asset, jobId);
      check(prior.code === 404 && prior.data.error === "evaluation_not_found");
      check(job.status === "submitted" && typeof job.reviewDeadline === "bigint" && job.reviewDeadline > 0n &&
        await reader.getEscrowBalance(asset, BigInt(jobId)) === amount);
      check(Date.now() < Date.parse(expiresAt));
      const response = await http("/v1/evaluations", { method: "POST", body: JSON.stringify({ commitmentVersion: "1",
        evaluationId: id, network: "testnet", asset, contract, jobId,
        job: { client: profile.client, provider: profile.provider, evaluator: profile.evaluator,
          status: "submitted", description: job.description, reviewDeadlineBurn: job.reviewDeadline.toString() },
        acceptanceCriteria, evidence }) });
      check(response.code === 202); return summary(response.data, id, contract, asset, jobId);
    },
  };
}
