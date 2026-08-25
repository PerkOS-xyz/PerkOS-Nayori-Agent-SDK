# `@perkos/agent-sdk`

TypeScript SDK for agent identity, escrow settlement, and reputation on Stacks.

PerkOS gives AI agents a programmable path to register, hire, fund work with STX or sBTC,
submit deliverables, settle escrow, and build job-linked reputation.

> Status: 0.1.0 developer release. Read clients, transaction builders, browser and headless signer
> adapters, confirmation receipts, safety policies, and a transactional testnet quickstart are
> implemented. The x402 v2 client foundation is implemented; independent resource-server
> verification, MCP adapters, external review, and adoption evidence remain before Milestone 2
> completion.

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Install

```bash
npm install @perkos/agent-sdk
```

To develop from source:

```bash
git clone https://github.com/PerkOS-xyz/PerkOS-Agent-SDK.git
cd PerkOS-Agent-SDK
npm install
npm run verify
npm run quickstart
```

The quickstart performs public read-only calls and does not require a wallet or private key.
Set `PERKOS_NETWORK=testnet` to read the testnet deployment.

The x402 foundation example is also read-only and requires no wallet. It creates and round-trips
the official v2 `PAYMENT-REQUIRED` header for an existing PerkOS escrow job:

```bash
npm run quickstart:x402
```

The transactional quickstart is also safe by default: it only prints a seven-step sBTC testnet
lifecycle and its funding-policy decision.

```bash
npm run quickstart:testnet
```

Live testnet execution requires three distinct funded roles and the exact opt-in documented in
[`examples/testnet.env.example`](examples/testnet.env.example). It confirms every transaction
before moving to the next lifecycle step. The complete flow was verified on testnet with exact
100-satoshi escrow, provider payout, cleared escrow, and reputation update; the
[completion transaction](https://explorer.hiro.so/txid/0x5cf34295641a9291a2b6785d6db95a5c56b4d3b40d4281c86da194acd4c64248?chain=testnet)
is publicly inspectable.

## Read on-chain state

```ts
import { PerkOSClient } from "@perkos/agent-sdk";

const perkos = new PerkOSClient({ network: "mainnet" });

const agentCount = await perkos.getAgentCount();
const sbtcJob = await perkos.getJob("sbtc", 1n);
const escrow = await perkos.getEscrowBalance("sbtc", 1n);
const reputation = await perkos.getReputation(
  "SP000000000000000000002Q6VF78"
);
```

Amounts are returned as `bigint`. sBTC values are satoshis and STX values are micro-STX.

## Build a transaction plan

Builders return explicit, inspectable plans. They do not sign, broadcast, or read environment
variables.

```ts
const plan = perkos.transactions.registerAgent({
  name: "Research Agent",
  description: "Produces cited market research.",
  wallet: "SP...",
  endpoints: [{ name: "mcp", url: "https://agent.example/mcp" }],
});

console.log(plan.contract, plan.functionName, plan.functionArgs);
```

Funding plans require the sender and generate an exact post-condition:

```ts
const plan = perkos.transactions.fundJob({
  asset: "sbtc",
  jobId: 7n,
  amount: 25_000n,
  sender: "SP...",
});
```

Settlement helpers read the job and escrow balance before building exact contract-principal
post-conditions. This protects both wallet-originated and headless transactions from transferring
more than the job requires.

## Browser signer (Leather and other Stacks wallets)

`StacksConnectSigner` adapts the official Stacks Connect request API. The application supplies
the connected address and request function; the SDK forwards the complete plan and never receives
wallet key material.

```ts
import { request } from "@stacks/connect";
import { PerkOSClient, StacksConnectSigner } from "@perkos/agent-sdk";

const signer = new StacksConnectSigner({
  network: "mainnet",
  address: connectedStacksAddress,
  request,
});
const perkos = new PerkOSClient({ network: "mainnet", signer });
```

Install `@stacks/connect` in the browser application. Wallet discovery and account selection stay
at the application boundary so the SDK cannot silently choose an account.

## Headless signer

`HeadlessSigner` requests key material only when deriving the public address or signing. It caches
only the derived address. Use an external secret manager, KMS adapter, or another controlled key
provider; never hardcode production keys.

```ts
import { HeadlessSigner, PerkOSClient } from "@perkos/agent-sdk";

const signer = new HeadlessSigner({
  network: "testnet",
  privateKeyProvider: async () => loadKeyFromSecretManager(),
});

const perkos = new PerkOSClient({ network: "testnet", signer });
```

The callback may return a string or `Uint8Array`. The SDK copies and zeroes its local binary-key
buffer after use; JavaScript strings cannot be reliably erased from memory.

## Confirmation receipts

Broadcast acceptance is not execution success. Confirm through the configured Stacks API before
advancing an automated workflow:

```ts
const broadcast = await perkos.execute(plan);
const confirmation = await perkos.confirm(broadcast, {
  timeoutMs: 10 * 60_000,
  pollIntervalMs: 5_000,
});

if (confirmation.status !== "success") {
  throw new Error(`Transaction ended with ${confirmation.status}`);
}
```

Confirmation status is normalized to `pending`, `success`, `abort`, `dropped`, or `timeout`, with
block and Clarity-result fields when the API supplies them. Polling supports cancellation through
an `AbortSignal`. If the v3 status response omits a terminal Clarity result, the tracker hydrates
that field from the transaction-detail endpoint.

## Spending policy

Funding is fail-closed. Both limits must be configured for every spendable asset:

```ts
const perkos = new PerkOSClient({
  network: "mainnet",
  signer: new WalletSigner(),
  spendingPolicy: {
    allowedAssets: ["sbtc"],
    maxPerTransaction: { sbtc: 50_000n },
    maxPerSession: { sbtc: 150_000n },
  },
});

await perkos.fundJob({
  asset: "sbtc",
  jobId: 7n,
  amount: 25_000n,
});
```

The policy also limits networks and contract principals. Funding attempts without explicit
per-transaction and per-session limits are rejected before the signer is called.

## x402 v2 client foundation

The SDK uses the official `@x402/core` v2 envelope and header codecs while preserving the PerkOS
escrow lifecycle. A protected resource describes an existing, open job and its exact atomic
budget. The scheme client validates that quote against on-chain state, funds it through the
configured SDK signer and spending policy, waits for successful confirmation, and produces the
`PAYMENT-SIGNATURE` payload.

```ts
import { x402Client } from "@x402/core/client";
import {
  PerkOSClient,
  PerkOSX402SchemeClient,
  createPerkOSX402PaymentRequired,
  encodePaymentRequiredHeader,
  toStacksX402Network,
} from "@perkos/agent-sdk";

const perkos = new PerkOSClient({
  network: "mainnet",
  signer,
  spendingPolicy: {
    allowedAssets: ["sbtc"],
    maxPerTransaction: { sbtc: 25_000n },
    maxPerSession: { sbtc: 50_000n },
  },
});

const required = createPerkOSX402PaymentRequired(perkos.config, {
  resource: {
    url: "https://agent.example/jobs/7/fund",
    description: "Fund job 7 escrow",
    mimeType: "application/json",
  },
  asset: "sbtc",
  jobId: 7n,
  amount: 25_000n,
});

const network = toStacksX402Network(perkos.config.network);
const paymentClient = new x402Client()
  .setSpendControls({
    allowedAssets: [
      { network, asset: required.accepts[0].asset, maxAmountPerPayment: "25000" },
    ],
  })
  .register(network, new PerkOSX402SchemeClient({ client: perkos }));

const paymentPayload = await paymentClient.createPaymentPayload(required);
console.log(encodePaymentRequiredHeader(required), paymentPayload);
```

The proof produced here is client-side confirmation evidence, not authorization for a production
paywall. A resource server must independently inspect the Stacks transaction, match the contract
call, payer, job, asset and amount, require its confirmation policy, and prevent replay. That
verifier/facilitator is intentionally a follow-up to this foundation.

## Supported lifecycle

- Register, update, and deactivate agents.
- Read agent records and counts.
- Create STX or sBTC jobs.
- Set a budget and fund escrow.
- Assign a provider and submit a deliverable.
- Complete, reject, or expire a job.
- Rate a provider and read reputation.

## Security model

- Mainnet or testnet must be selected explicitly.
- Contract overrides must match the selected network.
- Funding uses exact sender post-conditions.
- Settlement uses exact escrow-contract post-conditions.
- Agent-controlled payments require transaction and session budgets.
- The core SDK never accepts arbitrary URLs or payment destinations from an LLM.
- `execute` refuses plans created for a different network or signer.
- Broadcast receipts require a valid 32-byte Stacks transaction ID.
- Automated workflows can wait for an explicit terminal confirmation before their next action.
- x402 quotes are bound to the configured network, escrow contract, asset, job, and exact budget.

This package has not yet completed the external security review required for PerkOS Milestone 2.
Do not treat the developer release as audited software.

See [Architecture](docs/ARCHITECTURE.md) and [Security](SECURITY.md) for the trust boundaries and
responsible disclosure process.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

MIT
