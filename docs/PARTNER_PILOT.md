# Nayori invite-only partner pilot

The partner pilot exposes the Nayori x402 Platform on Stacks testnet without giving the API or SDK
custody of a wallet. An operator privately creates a single-use invitation for an existing merchant.
The partner binds that invitation to a Stacks address by signing the exact server challenge in
Leather. The server derives the address from the returned public key and atomically consumes both
the invitation and challenge before creating the OAuth client.

## Browser enrollment

Install the SDK and the official Stacks Connect package:

```bash
npm install @perkos/agent-sdk @stacks/connect
```

Use the account already selected by the application. The SDK never selects an account and never
receives a private key:

```ts
import { request } from "@stacks/connect";
import {
  NayoriPartnerClient,
  createStacksConnectPartnerSigner,
} from "@perkos/agent-sdk";

const nayori = new NayoriPartnerClient({ origin: "https://api.nayori.ai" });
const credentials = await nayori.enroll({
  invitationToken,
  walletAddress: selectedTestnetAddress,
  signMessage: createStacksConnectPartnerSigner(request),
});
```

Leather displays the exact challenge. Verify the origin, `testnet` network, merchant, wallet,
challenge identifier and expiration before approving. The client rejects a response bound to a
different wallet. The API independently verifies the recoverable signature and derived address.

`clientSecret` is returned once. Send it directly to an application-owned secret manager. Do not
put the invitation, client secret, access token or wallet signature in source, screenshots, logs,
analytics, issue trackers or prompts.

## Scoped access token

Request only the scopes needed by the current process:

```ts
const token = await nayori.requestToken({
  clientId: credentials.clientId,
  clientSecret: credentials.clientSecret,
  scopes: ["quotes:create", "mcp:invoke"],
});
```

Supported scopes are:

- `catalog:read`
- `quotes:create`
- `payments:verify`
- `payments:settle`
- `payments:read`
- `mcp:invoke`

The API uses `client_credentials` plus `client_secret_basic` and returns a short-lived EdDSA JWT.
The SDK deliberately does not persist or automatically refresh it.

## MCP

The authenticated Streamable HTTP endpoint implements JSON-RPC `initialize`, `ping`, `tools/list`
and `tools/call`. Current tools are `nayori_supported`, `nayori_request_quote` and
`nayori_get_settlement`.

```ts
const response = await nayori.callMcp({
  accessToken: token.accessToken,
  method: "tools/call",
  params: {
    name: "nayori_supported",
    arguments: {},
  },
});
```

`mcp:invoke` opens the MCP endpoint, while a quote or settlement tool also enforces its own
downstream scope and merchant isolation.

## Payment boundary

OAuth and the enrollment signature cannot authorize a payment. For each STX, sBTC or USDCx
payment, create a request-bound quote and let the payer separately inspect and sign the exact Stacks
transaction. Quote issuance, verification, broadcast or `pending` state is not confirmed
settlement. Require the confirmed settlement state and signed receipt before delivery.

The hosted pilot remains Stacks-testnet-only. Mainnet facilitator settlement, sponsorship and
arbitrary resource proxying remain disabled while the external review gate is open.
