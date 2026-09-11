# Hermes custody — bounded QA execution candidate

Stable 0.8.0 includes [operator-bound confirmation policy](CONFIRMATION_POLICY.md)
for new version-2 permits. Version-1 permits keep their original hashes and six-block behavior;
never mutate an active run or reset its journal. The example below is version 2 with workflow0
and settlement6 for a **new** low-value, explicitly authorized testnet run.

**Available in npm 0.8.0; deployment remains a controlled QA pilot. Do not enable funded wallets before your Linux isolation gate.**
The package includes `nayori-custody`, a separate Node service, and optional delegation from
`nayori-mcp`. No mainnet custody mode exists.

[One supervised internal lifecycle](VALIDATION_AND_RELEASE.md) passed with isolated signers.
That historical evidence does not authorize your deployment, wallet or spending limits.

## Trust boundary

Hermes/MCP → filesystem Unix socket → operator permit + durable ledger → SDK plan → testnet signer.

The service uses the real SDK builders and validation, not an LLM-generated raw transaction.
The model can request an action; it cannot choose network, contract, wallet, recipient, amount,
fee, private-key path, shell command, RPC endpoint, or signer module. The service never executes
job text as instructions. MCP has no private key and does not sign locally.

The **deployment**, not the presence of a socket, establishes isolation:

- Linux only for the custody CLI; signer and Hermes must use **different non-root UIDs**.
- Use a dedicated wallet and one immutable permit/ledger per participant for this pilot. Do not
  reuse the wallet outside the custodian, or run another custodian with another state directory.
- Signer-owned private directories: `0700`; permit, journal and key files: `0600`, single link,
  regular files, no symlinks. Use canonical absolute paths. No `.env` in Hermes or key in arguments.
- IPC directory: signer-owned `0710`, trusted connector group; socket `0660`. Its ancestors
  must let Hermes traverse **only the IPC path**, not the private data directory. Set the signer
  primary group to this connector group so the socket inherits it. Do not give group write access
  to the IPC directory. Unrelated users must not belong to the connector group.
- Hermes must have no sudo, Docker socket, host root, `CAP_SYS_PTRACE`, shared key mount, signer
  UID, writable signer source/dependencies, or access to signer process memory. Disable core dumps.
  Restrict signer egress to the testnet RPC; keep permit/state/code inaccessible to Hermes.
- `--hermes-uid` rejects root/same UID, but **does not attest a running Hermes process or enforce
  container mounts/capabilities**. Verify those operational controls before loading any funded key.

Linux pathname socket permissions govern access; these semantics are not portable to every OS.
See [Linux unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html) and
[Node IPC documentation](https://nodejs.org/docs/latest-v22.x/api/net.html#ipc-support).
Same-UID macOS protocol tests are **not** an isolation proof or an external security review.

## Operator permit

Only the operator writes this JSON, outside Git. All fields below are required; placeholders
intentionally fail validation. Addresses must be distinct, valid testnet principals. `expiresAt`
is UTC wall-clock authorization expiry; `expiredAt` is the job's **Stacks block** expiry.

```json
{
  "version": 2,
  "confirmationPolicy": { "workflowBurnBlocks": 0, "settlementBurnBlocks": 6 },
  "id": "qa-buyer-001",
  "profile": {
    "network": "testnet",
    "role": "client",
    "client": "BUYER_TESTNET_ADDRESS",
    "provider": "PROVIDER_TESTNET_ADDRESS",
    "evaluator": "VERIFIED_QA_EVALUATOR_ADDRESS",
    "treasury": "VERIFIED_QA_TREASURY_ADDRESS"
  },
  "asset": "sbtc",
  "amount": "1000",
  "gasBudget": "30000",
  "expiresAt": "2099-01-01T00:00:00.000Z",
  "expiredAt": "REPLACE_WITH_FUTURE_STACKS_HEIGHT",
  "jobId": null,
  "description": "Compute 7 + 5 and explain the result",
  "acceptanceCriteria": [
    { "id": "sum", "requirement": "Return 12", "verification": "Check arithmetic" }
  ],
  "agentName": "QA buyer",
  "actions": ["register", "create", "set-budget", "fund", "assign", "finalize"],
  "evidenceOrigins": ["https://evaluator.qa.nayori.ai"],
  "serviceFeeConsent": "200bps-net-after-evaluation"
}
```

Replace the illustrative expiry with a short operator-approved window. Maximum escrow is
1000 sBTC units or 100000 micro-STX. Gas is **5000 micro-STX per action**, cumulatively reserved,
maximum 35000 per permit; failed/ambiguous operations do not replenish it. No gas bump or
sponsorship is attempted. Service consent accepts the existing **included 2% evaluation-earned
fee and net refund after evaluated rejection**, not a second x402 charge. Funds stay in escrow
until the contract settles them.

For the provider use a separate wallet/state/socket, role `provider`, the confirmed `jobId`, and
actions `["register", "submit"]`. Client/evaluator/treasury, criteria, budget and job expiry must
match the buyer's job. A provider never gets create/fund/assign/finalize authorization here.

## Start and connect

Install the exact npm 0.8.0 package on each side using [MCP setup](HERMES_MCP.md).
Preserve the lockfile and verify registry integrity against the release notes.
First start with **signing disabled**, without a funded key:

```sh
nayori-custody --permit /private/permit.json --state /private/state \
  --socket /ipc/nayori.sock --key-file /private/wallet-key \
  --hermes-uid 2002
```

Paths/UID are illustrative, not commands to provision the production server. The permit and
state directories must already satisfy permissions. Startup prints only the permit hash and
enabled flag to stderr. The key is read lazily **after** live checks and durable reservation.
After human review and the isolation gate, the operator may explicitly append
`--enable-testnet-signing`. Never give Hermes permission to modify service arguments.

Add to the existing [MCP configuration](HERMES_MCP.md):

```yaml
      - --custody-socket
      - /ipc/nayori.sock
      - --permit-hash
      - OPERATOR_RECORDED_64_HEX_SHA256
```

Two optional tools appear:

| Tool | Purpose |
|---|---|
| `nayori_custody_status` | Reconcile saved txids; show permit, budget, job ID and operations |
| `nayori_execute` | Request one allowed action, e.g. `{"action":"create"}` |

Submit additionally requires the exact evidence manifest schema from `nayori_prepare_submission`.
No `evidence` argument is accepted for other actions. Evidence origins, manifest hash/schema,
MIME and byte declarations are checked, but the signer **does not fetch or verify content bytes**.
The evaluator still must validate those bytes and judge the actual work.

Recommended sequence: buyer register → create → status/confirmed job ID → set-budget → fund →
assign; provider register → submit. Request each new action only after the previous one confirms.
Provider MCP can separately opt into [public QA evaluation admission](HERMES_MCP.md#optional-provider-evaluation-admission)
after a confirmed submission. No LLM API credential, internal evaluator bearer or x402 purchase
is added to custody. After an on-chain decision
and the appeal deadline, the buyer can finalize. Appealed jobs are blocked for human resolution;
this pilot does not expose appeal, refund, review-timeout or administrative actions.

## Recovery and accounting

- One wallet-scoped lock prevents parallel custodian processes using the same state directory.
- Append-only journal: reservation → locally derived txid → canonical confirmation. Each write
  and parent directory entry is fsynced before the next side effect. Gas is never reset on restart.
- Exact duplicate requests return the existing state. Changed evidence for an already attempted
  submit is rejected. Signing/broadcast timeouts, aborted transactions, partial journal writes and
  unknown outcomes block additional spending. Errors never claim that no signature was made.
- Reconciliation requires the saved txid, canonical anchored success, expected contract result,
  and the **bound confirmation policy**. Version 1/default is 6/6; new version 2 can use
  workflow0/settlement6 on testnet. Create binds its returned job ID for subsequent actions.
  Settlement6 reduces reorg risk; it does not eliminate it. Public RPC is a trust dependency.
- A crash leaves a lock. **Never delete/replace a ledger, approve a new permit for the same wallet,
  or remove a lock blindly to retry.** Stop all signer processes; inspect chain nonce, saved txid,
  mempool and events. Preserve evidence and obtain explicit operator recovery authorization.
  This candidate intentionally has no automatic “unlock/retry payment” command.
- Nonce must be idle; another wallet user or pending transaction blocks signing. Postconditions
  are deny-mode; sBTC is pinned to the canonical QA token and v6/v5 contracts.
- Finalization confirmation is not the full E2E acceptance report: independently verify exact
  provider/treasury transfers, zero escrow, outcome and reputation before declaring success.
- Ordinary JavaScript strings cannot guarantee private-key memory erasure. This is a constrained
  software custodian, not an HSM, MPC wallet, audited production signer, or disaster-recovery system.

## Release gates still required

1. Review/merge QA source and validate package integrity.
2. Deploy from the authorized workstation to QA; provision distinct Linux identities and prove
   Hermes cannot read/modify key, permit, journal, code or another role's socket.
3. Crash/restart and concurrency tests across those OS identities, first with unfunded fixtures.
4. Explicitly approved low-value testnet buyer/provider run using **actual Hermes**, including
   evaluator admission, exact payout events and recovery. Internal actors are not M2 adoption.
5. The stable SDK is distributed on npm and both role manuals are available. Complete the
   separate x402 walkthrough and developer video. Production/mainnet require separate approval.
