import { describe, expect, it, vi } from "vitest";

import {
  NayoriPartnerApiError,
  NayoriPartnerClient,
  createStacksConnectPartnerSigner,
  type NayoriPartnerFetch,
} from "../src/partner.js";

const SIGNATURE = "ab".repeat(65);
const PUBLIC_KEY = `02${"cd".repeat(32)}`;
const WALLET = "ST000000000000000000002AMW42H";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Nayori wallet-linked partner client", () => {
  it("signs the exact server challenge and returns the one-time OAuth client secret", async () => {
    const fetchImpl = vi
      .fn<NayoriPartnerFetch>()
      .mockResolvedValueOnce(
        json({
          challenge: {
            challengeId: `nc_${"a".repeat(32)}`,
            message: "Nayori partner registration\nChallenge: exact",
            expiresAt: "2030-01-01T00:00:00.000Z",
            walletAddress: WALLET,
            network: "testnet",
          },
        }, 201),
      )
      .mockResolvedValueOnce(
        json({
          client: {
            clientId: `ny_oc_${"A".repeat(24)}`,
            clientSecret: `ny_cs_${"B".repeat(43)}`,
            tokenEndpoint: "https://api.nayori.ai/oauth/token",
            scopes: ["quotes:create", "mcp:invoke"],
            walletAddress: WALLET,
          },
        }, 201),
      );
    const signMessage = vi.fn().mockResolvedValue({
      signature: `0x${SIGNATURE}`,
      publicKey: PUBLIC_KEY,
    });
    const client = new NayoriPartnerClient({ fetch: fetchImpl });

    const credentials = await client.enroll({
      invitationToken: `ny_pi_${"C".repeat(43)}`,
      walletAddress: WALLET,
      signMessage,
    });

    expect(signMessage).toHaveBeenCalledWith({
      message: "Nayori partner registration\nChallenge: exact",
      walletAddress: WALLET,
      network: "testnet",
    });
    expect(credentials.clientSecret).toBe(`ny_cs_${"B".repeat(43)}`);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toMatchObject({
      signature: SIGNATURE,
      publicKey: PUBLIC_KEY,
    });
  });

  it("requests a minimum-scope token with client_secret_basic and calls MCP", async () => {
    const fetchImpl = vi
      .fn<NayoriPartnerFetch>()
      .mockResolvedValueOnce(
        json({
          access_token: "signed-access-token",
          token_type: "Bearer",
          expires_in: 300,
          scope: "mcp:invoke",
        }),
      )
      .mockResolvedValueOnce(json({ jsonrpc: "2.0", id: 7, result: { tools: [] } }));
    const client = new NayoriPartnerClient({ fetch: fetchImpl });
    const token = await client.requestToken({
      clientId: `ny_oc_${"A".repeat(24)}`,
      clientSecret: `ny_cs_${"B".repeat(43)}`,
      scopes: ["mcp:invoke"],
    });
    const response = await client.callMcp({
      accessToken: token.accessToken,
      id: 7,
      method: "tools/list",
    });

    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /),
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toContain("scope=mcp%3Ainvoke");
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer signed-access-token",
    });
    expect(response).toMatchObject({ result: { tools: [] } });
  });

  it("adapts Stacks Connect and returns typed API errors without credential contents", async () => {
    const request = vi.fn().mockResolvedValue({
      signature: `0x${SIGNATURE}`,
      publicKey: PUBLIC_KEY,
    });
    const signer = createStacksConnectPartnerSigner(request);
    await expect(
      signer({ message: "exact", walletAddress: WALLET, network: "testnet" }),
    ).resolves.toEqual({ signature: SIGNATURE, publicKey: PUBLIC_KEY });
    expect(request).toHaveBeenCalledWith("stx_signMessage", { message: "exact" });

    const client = new NayoriPartnerClient({
      fetch: vi.fn<NayoriPartnerFetch>().mockResolvedValue(
        json({ error: "invalid_client", error_description: "Client authentication failed." }, 401),
      ),
    });
    await expect(
      client.requestToken({ clientId: "secret-client", clientSecret: "secret-value" }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NayoriPartnerApiError>>({
        status: 401,
        code: "invalid_client",
        message: "Client authentication failed.",
      }),
    );
  });
});
