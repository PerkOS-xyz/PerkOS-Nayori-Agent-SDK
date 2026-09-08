/** Operator-owned QA authorization. Never constructed from an LLM tool argument. */
import { createHash } from "node:crypto";
import { parseConfirmationPolicy, DEFAULT_CONFIRMATION_POLICY, type ConfirmationPolicy } from "../confirmation-policy.js";
import { parseProfile, QA_CONTRACTS, type HermesProfile } from "../mcp/server.js";
import { prepareEvaluationJob, prepareEvaluationSubmission, type EvaluationCriterion,
  type EvaluationEvidence } from "../evaluation-commitments.js";

export const GAS_PER_ACTION = 5000n;
export const ACTIONS = ["register", "create", "set-budget", "fund", "assign", "submit", "finalize"] as const;
export type Action = typeof ACTIONS[number];
export interface Permit {
  readonly version: 1 | 2;
  readonly confirmationPolicy?: Readonly<ConfirmationPolicy>;
  readonly id: string;
  readonly profile: Readonly<HermesProfile>;
  readonly asset: "stx" | "sbtc";
  readonly amount: string;
  readonly gasBudget: string;
  readonly expiresAt: string;
  readonly expiredAt: string;
  readonly jobId: string | null;
  readonly description: string;
  readonly acceptanceCriteria: readonly EvaluationCriterion[];
  readonly agentName: string;
  readonly actions: readonly Action[];
  readonly evidenceOrigins: readonly string[];
  readonly serviceFeeConsent: "200bps-net-after-evaluation";
}
export interface ExecutionRequest { readonly action: Action; readonly evidence?: readonly EvaluationEvidence[] }
export function guard(ok: unknown): asserts ok { if (!ok) throw new Error("custody_guard_failed"); }
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  guard(value && typeof value === "object" && !Array.isArray(value));
  const r = value as Record<string, unknown>;
  guard(Object.keys(r).length === keys.length && keys.every(k => Object.hasOwn(r, k)));
  return r;
}
export function positive(value: unknown): bigint {
  guard(typeof value === "string" && /^[1-9][0-9]{0,38}$/.test(value));
  const n = BigInt(value); guard(n < 2n ** 128n); return n;
}
export function hash(value: unknown): string {
  // Objects entering this function are reconstructed in a fixed field order.
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function commitmentInput(p: Permit) {
  return { network: "testnet" as const, asset: p.asset,
    contract: p.asset === "stx" ? QA_CONTRACTS.stxCommerce : QA_CONTRACTS.sbtcCommerce,
    client: p.profile.client, evaluator: p.profile.evaluator,
    description: p.description, acceptanceCriteria: p.acceptanceCriteria };
}
export async function parsePermit(value: unknown): Promise<Readonly<Permit>> {
  const version = (value as { version?: unknown } | null)?.version;
  const r = object(value, ["version", "id", "profile", "asset", "amount", "gasBudget", "expiresAt",
    "expiredAt", "jobId", "description", "acceptanceCriteria", "agentName", "actions", "evidenceOrigins", "serviceFeeConsent",
    ...(version === 2 ? ["confirmationPolicy"] : [])]);
  guard((r.version === 1 || r.version === 2) && typeof r.id === "string" && /^[a-z0-9-]{1,64}$/.test(r.id));
  const profile = parseProfile(r.profile);
  guard(r.asset === "stx" || r.asset === "sbtc");
  guard(positive(r.amount) <= (r.asset === "stx" ? 100000n : 1000n));
  guard(positive(r.gasBudget) <= GAS_PER_ACTION * 7n);
  positive(r.expiredAt);
  guard(r.jobId === null || positive(r.jobId) > 0n);
  guard(typeof r.expiresAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(r.expiresAt)
    && Number.isFinite(Date.parse(r.expiresAt)) && new Date(r.expiresAt).toISOString() === r.expiresAt);
  guard(typeof r.description === "string" && typeof r.agentName === "string" && /^[\w -]{1,64}$/.test(r.agentName));
  guard(r.serviceFeeConsent === "200bps-net-after-evaluation");
  guard(Array.isArray(r.actions) && r.actions.length > 0 && new Set(r.actions).size === r.actions.length);
  const allowed = profile.role === "client" ? ACTIONS.filter(a => a !== "submit") : ["register", "submit"];
  guard(r.actions.every(a => allowed.includes(a)));
  guard(profile.role !== "provider" || r.jobId !== null);
  guard(r.jobId === null ? r.actions.includes("create") : !r.actions.includes("create"));
  guard(Array.isArray(r.evidenceOrigins) && r.evidenceOrigins.length <= 5 && r.evidenceOrigins.every(o => {
    if (typeof o !== "string") return false;
    const url = new URL(o); return url.protocol === "https:" && url.origin === o && !url.username && !url.password;
  }));
  guard(Array.isArray(r.acceptanceCriteria));
  const criteria = r.acceptanceCriteria.map(v => {
    const c = object(v, ["id", "requirement", "verification"]);
    guard([c.id, c.requirement, c.verification].every(v => typeof v === "string"));
    return Object.freeze({ id: c.id as string, requirement: c.requirement as string, verification: c.verification as string });
  });
  const p: Permit = { version: r.version, id: r.id, profile, asset: r.asset, amount: r.amount as string,
    gasBudget: r.gasBudget as string, expiresAt: r.expiresAt, expiredAt: r.expiredAt as string,
    jobId: r.jobId as string | null, description: r.description, acceptanceCriteria: Object.freeze(criteria),
    agentName: r.agentName, actions: Object.freeze([...r.actions] as Action[]),
    evidenceOrigins: Object.freeze([...r.evidenceOrigins] as string[]), serviceFeeConsent: r.serviceFeeConsent,
    ...(r.version === 2 ? { confirmationPolicy: parseConfirmationPolicy(profile.network, r.confirmationPolicy) } : {}) };
  await prepareEvaluationJob(commitmentInput(p));
  return Object.freeze(p);
}
export function permitConfirmationPolicy(p: Permit): Readonly<ConfirmationPolicy> {
  return parseConfirmationPolicy(p.profile.network, p.version === 1 ? DEFAULT_CONFIRMATION_POLICY : p.confirmationPolicy);
}
export async function parseExecution(value: unknown, p: Permit, jobId: string | null): Promise<ExecutionRequest> {
  guard(value && typeof value === "object");
  const action = (value as Record<string, unknown>).action;
  const r = object(value, action === "submit" ? ["action", "evidence"] : ["action"]);
  guard(p.actions.includes(r.action as Action));
  if (r.action !== "submit") return { action: r.action as Action };
  guard(jobId && Array.isArray(r.evidence) && r.evidence.length > 0 && r.evidence.length <= 5);
  let bytes = 0;
  const evidence = r.evidence.map(item => {
    const e = object(item, ["id", "uri", "sha256", "mediaType", "sizeBytes"]);
    guard(typeof e.uri === "string" && p.evidenceOrigins.includes(new URL(e.uri).origin));
    guard(e.mediaType === "text/plain" || e.mediaType === "application/json");
    guard(Number.isSafeInteger(e.sizeBytes) && Number(e.sizeBytes) >= 0 && Number(e.sizeBytes) <= 8192);
    bytes += Number(e.sizeBytes);
    return { id: e.id, uri: e.uri, sha256: e.sha256, mediaType: e.mediaType, sizeBytes: e.sizeBytes } as EvaluationEvidence;
  });
  guard(bytes <= 16000);
  await prepareEvaluationSubmission({ ...commitmentInput(p), provider: p.profile.provider, jobId, evidence });
  return { action: "submit", evidence };
}
