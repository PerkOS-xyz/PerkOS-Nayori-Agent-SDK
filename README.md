# `@perkos/agent-sdk`

TypeScript SDK for agent identity, escrow settlement, and reputation on Stacks.

PerkOS gives AI agents a programmable path to register, hire, fund work with STX or sBTC,
submit deliverables, settle escrow, and build job-linked reputation.

This repository is the continuation of `PerkOS-xyz/PerkOS-Agent-SDK`, renamed to connect the
public SDK with the Nayori product identity. The npm package remains `@perkos/agent-sdk` and the
complete Git history, releases, issues, and pull requests are preserved.

> Status: 0.5.0 developer release. Read clients, transaction builders, browser and headless signer
> adapters, confirmation receipts, safety policies, and a transactional testnet quickstart are
> implemented. The x402 v2 client and Stacks facilitator foundations are implemented; this release
> adds wallet-linked OAuth and MCP support for the planned invite-only testnet pilot. Hosted rollout,
> external review and adoption evidence remain before Milestone 2 completion. The direct x402
> profile includes request-bound pure verification
> and payer-side intent, policy, Leather, and remote-signer foundations for STX, sBTC, and USDCx.
> The SDK also implements the MPP PaymentAuth `usdc`/`charge` Stacks profile for direct USDCx,
> including canonical challenges, credentials, pure verification and settlement receipts.
> Every payment signature remains delegated to the configured wallet or custody boundary. Mainnet
> facilitator settlement remains disabled.

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Install

```bash
npm install @perkos/agent-sdk
```

To develop from source:

```bash
git clone https://github.com/PerkOS-xyz/PerkOS-Nayori-Agent-SDK.git
cd PerkOS-Nayori-Agent-SDK
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

The facilitator example uses public Hiro v3 transaction and event data to inspect the historical
M1 mainnet funding transaction. It proves the verifier fails closed when that otherwise matching
proof is outside its payment window; it does not write replay state or submit a transaction:

```bash
npm run quickstart:x402:facilitator
```

The payer quickstart creates a request-bound USDCx intent, reserves explicit spending and fee
limits, and builds a canonical unsigned Stacks transaction. It contains no private key, performs no
network call, and does not request a wallet signature or broadcast:

```bash
npm run quickstart:x402:payer
```

The MPP PaymentAuth quickstart creates a standard `WWW-Authenticate: Payment` USDCx challenge,
applies the same payer policy and builds an unsigned `OnChainOnly` Stacks transaction. It is
offline, contains no private key and does not request a wallet signature or broadcast:

```bash
npm run quickstart:mpp
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

## Invite-only partner OAuth and MCP

`NayoriPartnerClient` enrolls an invited partner without taking custody of a wallet. It requests a
single-use challenge, delegates the exact plaintext to Leather through `stx_signMessage`, submits
the signature and returns the generated OAuth client secret once. OAuth authorizes API/MCP access
only; every payment remains a separate wallet-signed transaction.

```ts
import { request } from "@stacks/connect";
import {
  NayoriPartnerClient,
  createStacksConnectPartnerSigner,
} from "@perkos/agent-sdk";

const partners = new NayoriPartnerClient();
const credentials = await partners.enroll({
  invitationToken,
  walletAddress: connectedTestnetAddress,
  signMessage: createStacksConnectPartnerSigner(request),
});

// Move the one-time secret directly into the application's secret manager.
const token = await partners.requestToken({
  clientId: credentials.clientId,
  clientSecret: credentials.clientSecret,
  scopes: ["mcp:invoke"],
});

const tools = await partners.callMcp({
  accessToken: token.accessToken,
  method: "tools/list",
});
```

See [Partner pilot](docs/PARTNER_PILOT.md) for the complete enrollment, scope and secret-handling
boundary.

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

The proof produced here is client-side confirmation evidence, not authorization by itself. Use the
facilitator below to independently inspect the Stacks transaction, match its payment fields, apply
a confirmation policy, and consume it through a replay store.

## Direct x402 payments on Stacks

The separate `stacks-signed-tx-v1` profile covers immediate pay-per-call resources. It uses the
official x402 v2 `exact` scheme and explicit `upfront` flow because the facilitator must commit the
signed Stacks transaction before the resource handler runs. It supports:

| Asset | Wire `asset` | Canonical internal identity | Atomic unit |
|---|---|---|---|
| STX | `STX` | CAIP-19 `slip44:5757` | micro-STX |
| sBTC | canonical `address.contract` | CAIP-19 SIP-010 | satoshi |
| USDCx | canonical `address.contract` | CAIP-19 SIP-010 | 10^-6 USDCx |

Create a short-lived request quote and compatibility-first requirement without a wallet or network
call:

```ts
import {
  createNayoriX402PaymentRequirements,
  createNayoriX402Quote,
} from "@perkos/agent-sdk";

const quote = await createNayoriX402Quote({
  quoteId: "quote-weather-001",
  merchantId: "merchant-weather",
  network: "testnet",
  asset: "usdcx",
  amount: 100_000n,
  payTo: "ST...",
  method: "POST",
  url: "https://api.example.com/v1/weather",
  body: JSON.stringify({ city: "Miami" }),
  issuedAt: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 300,
});

const requirement = await createNayoriX402PaymentRequirements(quote);
```

The quote fingerprint is placed in the 34-byte Stacks/SIP-010 memo, so the origin signature binds
the transaction to the HTTP method, canonical URL, body digest, network, asset, exact amount,
recipient, merchant, and expiry. `verifyNayoriX402DirectPayment` then validates the x402 envelope,
trusted quote, actual request, canonical transaction encoding, origin signature, payer, network,
memo, transfer template, amount, recipient, token contract, function arguments, deny mode, and
exact post-condition.

The verifier is intentionally pure: it does not authenticate the merchant, validate a quote
signature, read balances/nonces, simulate, persist replay state, sponsor, broadcast, confirm, or
deliver a resource. A hosted facilitator must perform those controls before using the verified
plan. For origin-signed sponsored transactions the result omits `transactionId` until a sponsor
adds its signature; `transactionHash` identifies only the supplied serialization.

`NayoriX402PaymentClient` completes the payer side without weakening those boundaries. It creates
an immutable `PaymentIntent`, applies recipient/origin/asset and amount/fee limits, constructs the
canonical unsigned transfer, delegates signing to `LeatherSigner` (`broadcast: false`) or a
`PolicySigner` backed by external custody, and verifies the signed result before returning the exact
facilitator request body. See [`docs/X402_PAYMENTS.md`](docs/X402_PAYMENTS.md) for both integrations.

Direct payments and `perkos-escrow-v1` are complementary. Use direct payments for immediate
resources and escrow for jobs that require delivery, evaluation, payout, or reputation.

## MPP PaymentAuth with USDCx on Stacks

MPP is a separate standards-based commerce path beside x402. Nayori implements the official
`Payment` HTTP authentication scheme with `method="usdc"`, `intent="charge"` and the direct Stacks
USDCx profile. The server issues a canonical `WWW-Authenticate: Payment` challenge and selects
`Payment-Authorization` for the payment credential, leaving `Authorization: Bearer` available for
OAuth.

```ts
import {
  createNayoriMppUsdcStacksChallenge,
  createNayoriMppUsdcStacksCredential,
  encodeNayoriMppCredentialHeader,
} from "@perkos/agent-sdk";

const { challenge, wwwAuthenticate } =
  await createNayoriMppUsdcStacksChallenge({
    quote: trustedUsdcxQuote,
    realm: "api.nayori.ai",
    description: "Nayori paid agent request",
  });

const credential = createNayoriMppUsdcStacksCredential({
  challenge,
  source: `stacks:2147483648:${payerAddress}`,
  transaction: walletSignedTransactionHex,
});

console.log(wwwAuthenticate);
console.log(encodeNayoriMppCredentialHeader(credential));
```

The verifier reuses Nayori's exact request-bound Stacks transaction checks and adds the MPP rules:
RFC 8785 envelopes, CAIP-10 source, canonical official USDCx identity, `OnChainOnly`, standard
single-signature authorization and low-s signing. Replay persistence, nonce/balance preflight,
broadcast, confirmations, receipt delivery and merchant authentication remain hosted Platform
responsibilities. See [MPP payments](docs/MPP_PAYMENTS.md) for the complete flow and trust boundary.

## x402 v2 Stacks facilitator

`PerkOSX402Facilitator` implements the official `SchemeNetworkFacilitator` interface. It reloads
the transaction and events from Hiro, then matches the successful contract call, payer, commerce
contract, decoded `job-funded` event, exact STX/sBTC transfer, job, amount, token, block metadata,
confirmation depth, and payment-window freshness. Its `settle` method does not broadcast another
transaction: for the upfront flow it atomically consumes the already-confirmed funding proof.

```ts
import { x402Facilitator } from "@x402/core/facilitator";
import {
  InMemoryX402ReplayStore,
  PerkOSX402Facilitator,
  STACKS_X402_NETWORKS,
} from "@perkos/agent-sdk";

const stacks = new PerkOSX402Facilitator({
  config: perkos.config,
  replayStore: new InMemoryX402ReplayStore(),
  minConfirmations: 2,
});
const facilitator = new x402Facilitator().register(
  STACKS_X402_NETWORKS.mainnet,
  stacks
);
```

The in-memory replay store is only for tests, examples, local development, and a single-process
demo. Production must inject a durable shared implementation whose `consume` operation is atomic,
such as a database unique constraint or Redis `SET NX`.

The current Stacks proof is an already-public funding transaction rather than a request-bound
off-chain authorization. Freshness and one-time consumption prevent stale reuse, but a party that
obtains the proof before settlement could try to consume it first. Do not use this release for a
high-value production paywall until request binding is added through a payer signature/challenge
or facilitator-submitted signed transaction.

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
- x402 settlement verifies current chain evidence and atomically consumes each funding txid once.
- MPP USDCx credentials echo a request-bound challenge and require a canonical, low-s,
  `OnChainOnly` Stacks transfer; hosted settlement must still consume challenge and replay keys
  atomically before broadcast.
- Partner OAuth enrollment signs an exact, short-lived, invitation-bound message in the wallet;
  the SDK normalizes the public signature but never receives a private key.
- OAuth client secrets and access tokens are application secrets. The SDK returns them to the
  caller but does not persist, log or refresh them automatically.

This package has not yet completed the external security review required for PerkOS Milestone 2.
Do not treat the developer release as audited software.

See [Architecture](docs/ARCHITECTURE.md), [x402 payments](docs/X402_PAYMENTS.md),
[MPP payments](docs/MPP_PAYMENTS.md), [Partner pilot](docs/PARTNER_PILOT.md) and
[Security](SECURITY.md) for the trust boundaries and
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
