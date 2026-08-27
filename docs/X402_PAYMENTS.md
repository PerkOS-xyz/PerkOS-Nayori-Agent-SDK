# Paying Nayori x402 resources

Nayori's payer flow prepares a standard, non-sponsored Stacks transaction for direct STX, sBTC,
or USDCx payment. It binds the payment to the exact HTTP request and returns a body suitable for the
hosted facilitator. The SDK does not broadcast the transaction.

The public Nayori Platform deployment is currently quote-only. Payment verification, settlement,
reconciliation, and delivery remain runtime-disabled until the testnet release gates and external
review are complete. The APIs below are developer foundations, not a claim that production
settlement is live.

## Safe offline quickstart

The included quickstart creates a testnet USDCx quote, deterministic payment intent, policy
reservation, and canonical unsigned transaction. It contains no private key, requests no wallet
approval, performs no network call, and releases the reservation without signing:

```bash
npm run quickstart:x402:payer
```

## Shared payment policy

Both interactive and automated signers use the same mandatory, fail-closed policy:

```ts
import { NayoriX402PaymentPolicy } from "@perkos/agent-sdk";

const policy = new NayoriX402PaymentPolicy({
  allowedNetworks: ["mainnet"],
  allowedAssets: ["sbtc", "usdcx"],
  allowedRecipients: [merchantStacksAddress],
  allowedOrigins: ["https://merchant.example"],
  allowedMerchantIds: ["merchant-research"],
  maxPerTransaction: { sbtc: 25_000n, usdcx: 5_000_000n },
  maxPerSession: { sbtc: 100_000n, usdcx: 20_000_000n },
  maxFeePerTransaction: 5_000n,
  maxFeePerSession: 25_000n,
  minQuoteValiditySeconds: 30,
});
```

All values are atomic units: micro-STX, satoshis, or 10^-6 USDCx. Fee limits are micro-STX.
Authorization reserves the amount and full construction fee before asynchronous signing. A wallet
may return a lower positive origin fee, which is accepted and committed as the actual fee spent;
zero or any fee above the intent is rejected. A valid signature commits usage even if settlement
later becomes ambiguous. Failed or cancelled signing releases it. Active reservations count toward
session limits, so concurrent agents cannot oversubscribe the budget.

## Interactive Leather signing

Connect the wallet with the official `@stacks/connect` package and select its STX address and
compressed public key. Pass the package's `request` function to `LeatherSigner`:

```ts
import { connect, request } from "@stacks/connect";
import {
  LeatherSigner,
  NayoriX402PaymentClient,
} from "@perkos/agent-sdk";

const connection = await connect();
const account = connection.addresses.find(
  (candidate) => candidate.symbol === "STX" || candidate.address.startsWith("S")
);
if (!account) throw new Error("The wallet did not return a Stacks account");

const signer = new LeatherSigner({
  network: "mainnet",
  address: account.address,
  publicKey: account.publicKey,
  request,
});
const payer = new NayoriX402PaymentClient({ signer, policy });

const prepared = await payer.preparePayment({
  signedQuote: quoteResponse.signedQuote,
  quote: quoteResponse.quote,
  paymentRequirements: quoteResponse.paymentRequirements,
  request: protectedRequest,
  fee: quotedFeeMicroStx,
  nonce: currentAccountNonce,
});
```

`LeatherSigner` calls only `stx_signTransaction` with `broadcast: false`. It rejects a wallet result
that contains only a txid because the Nayori facilitator must receive, reserve, and broadcast the
signed bytes exactly once. The client independently verifies the returned origin fee: Leather may
lower it, but cannot increase it above the fee authorized in the payment intent.

## Automated agent signing

`PolicySigner` delegates the cryptographic operation to an application-owned service. The callback
receives the immutable intent and unsigned transaction, never a key:

```ts
import {
  NayoriX402PaymentClient,
  PolicySigner,
} from "@perkos/agent-sdk";

const signer = new PolicySigner({
  network: "mainnet",
  address: agentStacksAddress,
  publicKey: agentCompressedPublicKey,
  sign: async ({ intent, transaction }) => {
    const response = await fetch("https://signer.internal/v1/stacks/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent, transaction }),
    });
    if (!response.ok) throw new Error("The custody policy denied signing");
    return response.json() as Promise<{ transaction: string }>;
  },
});
const payer = new NayoriX402PaymentClient({ signer, policy });
```

Keep the signing service on a private, mutually authenticated boundary. It must independently
validate the intent, enforce its own durable limits and nonce policy, and call a KMS/HSM or isolated
wallet. Do not send a private key to the SDK callback or load one into an LLM/agent process. The
in-process SDK policy is defense in depth; the custody service is the final authorization boundary.

## Submit to the facilitator

After local verification, `prepared.settlementRequest` is exactly the JSON body expected by
`POST /v1/x402/settle`:

```ts
const response = await fetch(`${facilitatorOrigin}/v1/x402/settle`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${merchantCredential}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(prepared.settlementRequest),
});
```

The merchant credential belongs to the protected resource or its trusted backend, not to the payer
agent. In the normal x402 exchange, the payer returns its payment payload to the resource server and
that server calls or proxies the authenticated facilitator operation.

Before releasing a resource, require confirmed settlement and a valid signed settlement receipt.
Do not treat wallet approval, a local txid, a broadcast response, or an unconfirmed mempool entry as
completed payment.
