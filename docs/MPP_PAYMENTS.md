# MPP PaymentAuth payments with USDCx on Stacks

Nayori implements the `Payment` HTTP authentication scheme as a second commerce protocol beside
x402. The initial profile follows the official MPP `method="usdc"`, `intent="charge"` draft for a
direct USDCx SIP-010 transfer on Stacks. It supports testnet and mainnet token identities, while
the hosted service controls which networks can actually settle.

This SDK release provides the interoperable protocol envelope and pure transaction verification.
It does not authenticate merchants, query the live account nonce, persist replay state, broadcast,
wait for confirmation, or deliver a paid resource. Those controls belong to Nayori Platform.

Official references:

- [Payment HTTP Authentication Scheme](https://github.com/tempoxyz/mpp-specs/blob/main/specs/core/draft-httpauth-payment-00.md)
- [USDC charge method, including USDCx on Stacks](https://github.com/tempoxyz/mpp-specs/blob/main/specs/methods/usdc/draft-usdc-charge-00.md)
- [OpenAPI payment discovery](https://github.com/tempoxyz/mpp-specs/blob/main/specs/extensions/draft-payment-discovery-01.md)

## Safe offline quickstart

The example creates a short-lived USDCx challenge, validates its HTTP header, applies the existing
Nayori spending policy and builds an unsigned `OnChainOnly` Stacks transaction. It performs no
network request, contains no private key, requests no wallet approval and does not broadcast:

```bash
npm run quickstart:mpp
```

## Server: issue a Payment challenge

The server first creates and authenticates a request-bound Nayori quote. The quote ID is also the
stateful MPP challenge ID, allowing the hosted layer to look up and consume the exact quote once.

```ts
import {
  createNayoriMppUsdcStacksChallenge,
  createNayoriX402Quote,
} from "@perkos/agent-sdk";

const quote = await createNayoriX402Quote({
  quoteId: "nq_01H...",
  merchantId: "merchant-research",
  network: "testnet",
  asset: "usdcx",
  amount: 100_000n,
  payTo: merchantStacksAddress,
  method: "POST",
  url: "https://api.nayori.ai/api/mpp/v1/research",
  body: JSON.stringify({ topic: "Stacks" }),
  issuedAt: now,
  expiresAt: now + 300,
});

const { challenge, paymentRequest, wwwAuthenticate } =
  await createNayoriMppUsdcStacksChallenge({
    quote,
    realm: "api.nayori.ai",
    description: "Nayori research request",
  });

return new Response(problemBody, {
  status: 402,
  headers: {
    "Cache-Control": "no-store",
    "Content-Type": "application/problem+json",
    "WWW-Authenticate": wwwAuthenticate,
  },
});
```

Nayori challenges explicitly select `header="Payment-Authorization"`. This preserves ordinary
`Authorization: Bearer ...` for OAuth while carrying the payment credential separately. The
challenge also includes the RFC 9530 SHA-256 body digest and an RFC 3339 expiry.

## Client: inspect, authorize and sign

Parse the challenge and present its exact network, asset, amount, recipient, description and expiry
to the payer. Reuse `NayoriX402PaymentPolicy` and `createNayoriX402PaymentIntent` to enforce the
same asset, recipient, origin, amount, fee and session limits used by x402. Then call
`buildNayoriMppUnsignedPaymentTransaction` instead of the generic x402 builder; this selects the
`OnChainOnly` anchor mode required by the MPP Stacks profile.

Delegate the returned bytes to Leather (`stx_signTransaction` with `broadcast: false`) or an
application-owned KMS/HSM signer. After signing, construct the standard MPP credential:

```ts
import {
  createNayoriMppUsdcStacksCredential,
  encodeNayoriMppCredentialHeader,
} from "@perkos/agent-sdk";

const credential = createNayoriMppUsdcStacksCredential({
  challenge,
  source: `stacks:2147483648:${payerTestnetAddress}`,
  transaction: signedTransactionHex,
});

await fetch(protectedUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${oauthAccessToken}`,
    "Content-Type": "application/json",
    "Payment-Authorization": encodeNayoriMppCredentialHeader(credential),
  },
  body: protectedRequestBody,
});
```

The credential is RFC 8785 canonical JSON encoded as unpadded base64url. Its Stacks transaction is
the SIP-005 consensus serialization encoded as standard padded base64, as required by the USDC
method draft. `transactionFormat="stacks_transaction_v1"` is emitted explicitly.

## Server: verify before settlement

```ts
const credential = decodeNayoriMppCredentialHeader(
  request.headers.get("Payment-Authorization") ?? ""
);
const verified = await verifyNayoriMppUsdcStacksPayment({
  credential,
  expectedChallenge: challengeFromTrustedQuote,
  trustedQuote,
  request: actualProtectedRequest,
});
```

The pure verifier checks:

- exact challenge echo and binding to the trusted request quote;
- canonical JCS/base64url envelopes and strict profile fields;
- official mainnet or testnet USDCx contract, token and six-decimal identity;
- CAIP-10 payer source, Stacks version and chain ID;
- canonical SIP-005 transaction bytes and `OnChainOnly` anchor mode;
- standard single-signature authorization with a low-s origin signature;
- exact SIP-010 `transfer` arguments, request fingerprint memo and payer/recipient/amount;
- deny mode and one exact `SentEq` fungible-token post-condition.

The hosted settlement layer must then check current nonce/balance and token controls, atomically
reserve the challenge and replay key, simulate or preflight, broadcast the exact verified bytes,
reconcile ambiguous submissions, wait for its confirmation threshold and only then deliver the
resource. A successful response carries an encoded `Payment-Receipt`:

```ts
const receipt = createNayoriMppUsdcStacksReceipt({
  challengeId: verified.challengeId,
  reference: confirmedTransactionId,
  network: verified.network,
  externalId: verified.quoteId,
});

response.headers.set("Payment-Receipt", encodeNayoriMppReceiptHeader(receipt));
```

Never issue a success receipt for a wallet approval, local hash, mempool acceptance or unconfirmed
transaction. Sponsorship is intentionally disabled in this initial profile. Mainnet settlement must
remain disabled until the external review and production release gates are complete.
