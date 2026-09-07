import { getAddressFromPrivateKey, makeContractCall, fetchCallReadOnlyFunction } from "@stacks/transactions";
import { PerkOSClient } from "../client.js";
import { QA_API, QA_CONTRACTS } from "../mcp/server.js";
import { prepareEvaluationJob, prepareEvaluationSubmission } from "../evaluation-commitments.js";
import type { ContractCallPlan } from "../types.js";
import type { CustodyBackend } from "./engine.js";
import { readPrivateFile } from "./ledger.js";
import { GAS_PER_ACTION, commitmentInput, guard } from "./permit.js";

const TOKEN = "SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token";
const contracts = { ...QA_CONTRACTS, sbtcToken: TOKEN } as const;
async function safeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input);
  guard(url.origin === QA_API && !url.username && !url.password && !url.hash);
  return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
}
async function get(path: string): Promise<Record<string, unknown>> {
  const response = await safeFetch(QA_API + path); guard(response.ok);
  guard(Number(response.headers.get("content-length") ?? 0) <= 1048576);
  const text = await response.text(); guard(Buffer.byteLength(text) <= 1048576);
  return JSON.parse(text) as Record<string, unknown>;
}
async function tip() {
  const info = await get("/v2/info"); guard(info.network_id === 2147483648);
  guard(Number.isSafeInteger(info.burn_block_height) && Number.isSafeInteger(info.stacks_tip_height));
  return { burn: BigInt(info.burn_block_height as number), stacks: BigInt(info.stacks_tip_height as number) };
}
/** Fixed testnet backend. Import/construct does not read a key or contact the network. */
export function testnetBackend(keyFile: string): CustodyBackend {
  return {
    async prepare(p, r, jobId) {
      const { burn, stacks } = await tip();
      const wallet = p.profile[p.profile.role], amount = BigInt(p.amount);
      let captured: ContractCallPlan | undefined;
      // SDK execution is intercepted in memory to obtain its validated plan. No signer or broadcaster here.
      const client = new PerkOSClient({ network: "testnet", apiUrl: QA_API, contracts,
        spendingPolicy: { allowedNetworks: ["testnet"], allowedAssets: [p.asset],
          maxPerTransaction: { [p.asset]: amount }, maxPerSession: { [p.asset]: amount } },
        readOnlyTransport: call => {
          guard(call.network === "testnet" && Object.values(contracts).some(c => c === call.contract) && /^get-/.test(call.functionName));
          const [contractAddress, contractName] = call.contract.split(".");
          return fetchCallReadOnlyFunction({ contractAddress: contractAddress!, contractName: contractName!,
            functionName: call.functionName, functionArgs: [...call.functionArgs], senderAddress: call.senderAddress,
            network: "testnet", client: { baseUrl: QA_API, fetch: safeFetch } });
        },
        signer: { getAddress: async () => wallet, signAndBroadcast: async plan => {
          guard(!captured); captured = plan; return { txid: "0x" + "0".repeat(64) };
        } } });
      const input = commitmentInput(p), prepared = await prepareEvaluationJob(input);
      const id = jobId ? BigInt(jobId) : undefined;
      const acceptance = { gross: amount, basisPoints: 200 as const, treasury: p.profile.treasury,
        rejectionRefund: "net-after-evaluation" as const };
      if (r.action === "create") {
        guard(BigInt(p.expiredAt) > stacks);
        const policy = await client.getServiceFeePolicy(p.asset);
        guard(policy.configured && policy.basisPoints === 200 && policy.treasury === p.profile.treasury);
      }
      if (!["register", "create"].includes(r.action)) {
        guard(id !== undefined);
        const job = await client.getJob(p.asset, id);
        guard(job && job.client === p.profile.client && job.evaluator === p.profile.evaluator &&
          job.treasury === p.profile.treasury && job.description === prepared.description && job.expiredAt === BigInt(p.expiredAt));
        guard(r.action === "set-budget" || job.budget === amount);
        const escrow = await client.getEscrowBalance(p.asset, id);
        if (r.action === "set-budget" || r.action === "fund") guard(job.status === "open" && escrow === 0n);
        if (r.action === "assign") guard(job.status === "funded" && !job.provider && escrow === amount);
        if (r.action === "submit") guard(job.status === "funded" && job.provider === p.profile.provider && escrow === amount);
        if (r.action === "finalize") {
          const d = await client.getDecision(p.asset, id);
          guard(job.status === "decision-pending" && job.provider === p.profile.provider && escrow === amount &&
            d && !d.appealedBy && !d.finalDecision && burn > d.appealDeadline);
        }
      }
      if (p.asset === "sbtc" && r.action !== "register") guard(await client.getConfiguredSbtcToken() === TOKEN);
      switch (r.action) {
        case "register": await client.registerAgent({ name: p.agentName, description: "Controlled QA participant", wallet, endpoints: [] }); break;
        case "create": await client.createJob({ asset: p.asset, evaluator: p.profile.evaluator, expiredAt: BigInt(p.expiredAt), description: prepared.description }); break;
        case "set-budget": await client.setBudget({ asset: p.asset, jobId: id!, amount }); break;
        case "fund": await client.fundJob({ asset: p.asset, jobId: id!, amount, serviceFeeAcceptance: acceptance }); break;
        case "assign": await client.assignProvider({ asset: p.asset, jobId: id!, provider: p.profile.provider }); break;
        case "submit": {
          const submission = await prepareEvaluationSubmission({ ...input, provider: p.profile.provider, jobId: jobId!, evidence: r.evidence! });
          await client.submitWork({ asset: p.asset, jobId: id!, deliverable: submission.deliverable, serviceFeeAcceptance: acceptance }); break;
        }
        case "finalize": await client.finalizeDecision(p.asset, id!); break;
      }
      guard(captured); return captured;
    },
    async sign(plan, wallet, expiresAt) {
      await tip();
      const nonce = await get(`/extended/v1/address/${wallet}/nonces`);
      guard(Number.isSafeInteger(nonce.possible_next_nonce) && Number(nonce.possible_next_nonce) >= 0);
      const expected = nonce.last_executed_tx_nonce === null ? 0 : Number(nonce.last_executed_tx_nonce) + 1;
      guard(nonce.last_executed_tx_nonce === null || Number.isSafeInteger(nonce.last_executed_tx_nonce));
      guard(expected === nonce.possible_next_nonce && (nonce.last_mempool_tx_nonce === null ||
        Number.isSafeInteger(nonce.last_mempool_tx_nonce) && Number(nonce.last_mempool_tx_nonce) < expected));
      guard(Array.isArray(nonce.detected_missing_nonces) && nonce.detected_missing_nonces.length === 0);
      // Only reached after durable reservation; private material is never returned to MCP or the journal.
      guard(Date.now() < Date.parse(expiresAt));
      const key = readPrivateFile(keyFile, 256).trim();
      guard(/^[a-fA-F0-9]{64}(01)?$/.test(key) && getAddressFromPrivateKey(key, "testnet") === wallet);
      const [contractAddress, contractName] = plan.contract.split(".");
      const tx = await makeContractCall({ contractAddress: contractAddress!, contractName: contractName!,
        functionName: plan.functionName, functionArgs: [...plan.functionArgs], senderKey: key,
        network: "testnet", nonce: BigInt(expected), fee: GAS_PER_ACTION,
        postConditionMode: "deny", postConditions: [...plan.postConditions] });
      return { txid: "0x" + tx.txid().replace(/^0x/, ""), bytes: tx.serializeBytes() };
    },
    async broadcast(signed) {
      const response = await safeFetch(QA_API + "/v2/transactions", { method: "POST",
        headers: { "content-type": "application/octet-stream" }, body: Buffer.from(signed.bytes) });
      guard(response.ok);
      const txid: unknown = await response.json();
      guard(typeof txid === "string" && "0x" + txid.replace(/^0x/, "") === signed.txid);
    },
    async confirmation(txid) {
      guard(/^0x[a-f0-9]{64}$/.test(txid));
      const tx = await get(`/extended/v1/tx/${txid}`);
      const info = await tip();
      const result = tx.tx_result as { repr?: unknown } | undefined;
      // Six anchored burn confirmations before advancing the wallet workflow; reorg risk is not zero.
      return { success: tx.tx_id === txid && tx.canonical === true && tx.is_unanchored === false &&
        tx.tx_status === "success" && Number.isSafeInteger(tx.burn_block_height) &&
        info.burn >= BigInt(tx.burn_block_height as number) + 6n,
        result: typeof result?.repr === "string" ? result.repr : "" };
    },
  };
}
