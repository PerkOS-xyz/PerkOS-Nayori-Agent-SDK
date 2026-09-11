import type { ContractCallPlan } from "../types.js";
import { QA_CONTRACTS } from "../mcp/server.js";
import { Ledger } from "./ledger.js";
import { GAS_PER_ACTION, guard, hash, parseExecution, permitConfirmationPolicy, type Permit, type ExecutionRequest, type Action } from "./permit.js";
import type { confirmationProgress } from "../confirmation-policy.js";

export interface CustodyBackend {
  prepare(permit: Permit, request: ExecutionRequest, jobId: string | null): Promise<ContractCallPlan>;
  sign(plan: ContractCallPlan, wallet: string, expiresAt: string): Promise<{ txid: string; bytes: Uint8Array }>;
  broadcast(signed: { txid: string; bytes: Uint8Array }): Promise<void>;
  confirmation(txid: string, permit?: Permit, action?: Action): Promise<{ success: boolean; result: string; progress?: ReturnType<typeof confirmationProgress> }>;
}
const FUNCTIONS = { register: "register-agent", create: "create-job", "set-budget": "set-budget",
  fund: "fund-job", assign: "assign-provider", submit: "submit-work", finalize: "finalize-decision" } as const;

export class CustodyEngine {
  private busy = false;
  private poisoned = false;
  private closing = false;
  private progress: Record<string, ReturnType<typeof confirmationProgress>> = {};
  private onIdle: (() => void) | undefined;
  constructor(readonly permit: Permit, private readonly ledger: Ledger,
    private readonly backend: CustodyBackend, private readonly enabled = false,
    private readonly now: () => number = Date.now) {
    guard(ledger.permitHash === hash(permit));
    guard(BigInt(ledger.entries.filter(e => e.state === "reserved").length) * GAS_PER_ACTION <= BigInt(permit.gasBudget));
  }
  private jobId(): string | null { return this.permit.jobId ?? this.ledger.latest("create")?.jobId ?? null; }
  shutdown(): Promise<void> {
    this.closing = true;
    return this.busy ? new Promise(resolve => { this.onIdle = resolve; }) : Promise.resolve();
  }
  private idle() { this.busy = false; this.onIdle?.(); }
  status() {
    return { permitId: this.permit.id, permitHash: hash(this.permit), profile: this.permit.profile,
      enabled: this.enabled && !this.poisoned && !this.closing, asset: this.permit.asset, amount: this.permit.amount,
      expiresAt: this.permit.expiresAt, gasBudget: this.permit.gasBudget, gasPerAction: GAS_PER_ACTION.toString(),
      gasReserved: (BigInt(this.ledger.entries.filter(e => e.state === "reserved").length) * GAS_PER_ACTION).toString(),
      jobId: this.jobId(), actions: this.permit.actions,
      confirmationPolicy: permitConfirmationPolicy(this.permit), confirmationProgress: { ...this.progress },
      operations: this.permit.actions.map(a => this.ledger.latest(a)).filter(Boolean),
      classification: "internal-team-operated-not-m2-adoption", evidenceBytesVerified: false };
  }
  async reconcile(): Promise<ReturnType<CustodyEngine["status"]>> {
    guard(!this.busy && !this.poisoned && !this.closing); this.busy = true;
    try {
      for (const action of this.permit.actions) {
        const e = this.ledger.latest(action);
        if (e?.state !== "signed") continue;
        const c = await this.backend.confirmation(e.txid!, this.permit, action);
        if (c.progress) this.progress[action] = c.progress;
        // Pending, missing, aborted and noncanonical transactions remain blocked. Never rebroadcast.
        if (!c.success) continue;
        let jobId: string | null = null;
        if (action === "create") {
          const match = /^\(ok u([1-9][0-9]*)\)$/.exec(c.result); guard(match); jobId = match[1]!;
        } else if (action === "register") guard(/^\(ok u[1-9][0-9]*\)$/.test(c.result));
        else guard(c.result === "(ok true)");
        this.persist({ ...e, state: "confirmed", jobId });
      }
      return this.status();
    } finally { this.idle(); }
  }
  private persist(entry: Parameters<Ledger["append"]>[0]) {
    try { this.ledger.append(entry); } catch { this.poisoned = true; throw new Error("ledger_reconciliation_required"); }
  }
  async execute(input: unknown): Promise<ReturnType<CustodyEngine["status"]>> {
    guard(!this.busy && !this.poisoned && !this.closing); this.busy = true;
    try {
      const request = await parseExecution(input, this.permit, this.jobId());
      const intent = hash(request), prior = this.ledger.latest(request.action);
      if (prior) { guard(prior.intent === intent); return this.status(); }
      guard(this.enabled && this.now() < Date.parse(this.permit.expiresAt));
      guard(!this.permit.actions.some(a => { const e = this.ledger.latest(a); return e && e.state !== "confirmed"; }));
      // A journal confirmation is historical, not permission to ignore a later reorg.
      for (const action of this.permit.actions) {
        const previous = this.ledger.latest(action);
        if (previous?.state === "confirmed") {
          const checked = await this.backend.confirmation(previous.txid!, this.permit, action);
          if (checked.progress) this.progress[action] = checked.progress;
          guard(checked.success);
        }
      }
      const reserved = BigInt(this.ledger.entries.filter(e => e.state === "reserved").length) * GAS_PER_ACTION;
      guard(reserved + GAS_PER_ACTION <= BigInt(this.permit.gasBudget));
      const plan = await this.backend.prepare(this.permit, request, this.jobId());
      const wallet = this.permit.profile[this.permit.profile.role];
      guard(plan.network === "testnet" && plan.postConditionMode === "deny" && plan.type === "contract-call");
      guard(plan.contract === (request.action === "register" ? QA_CONTRACTS.agentRegistry
        : this.permit.asset === "stx" ? QA_CONTRACTS.stxCommerce : QA_CONTRACTS.sbtcCommerce));
      guard(plan.functionName === FUNCTIONS[request.action] && (!plan.intent.sender || plan.intent.sender === wallet));
      if (request.action === "fund") guard(plan.intent.amount === BigInt(this.permit.amount) && plan.intent.asset === this.permit.asset);
      guard(this.now() < Date.parse(this.permit.expiresAt));
      this.persist({ action: request.action, intent, state: "reserved", txid: null, jobId: null });
      const signed = await this.backend.sign(plan, wallet, this.permit.expiresAt);
      guard(/^0x[a-f0-9]{64}$/.test(signed.txid));
      this.persist({ action: request.action, intent, state: "signed", txid: signed.txid, jobId: null });
      guard(this.now() < Date.parse(this.permit.expiresAt));
      // Even an HTTP timeout after broadcast cannot trigger another signing attempt.
      await this.backend.broadcast(signed);
      return this.status();
    } finally { this.idle(); }
  }
}
