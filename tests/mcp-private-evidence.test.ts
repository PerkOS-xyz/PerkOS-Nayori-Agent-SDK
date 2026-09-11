import { describe, expect, it, vi } from "vitest";
import { createEvidenceTokenProvider, createMcpPrivateEvidence } from "../src/mcp/private-evidence.js";

const profile = { network: "testnet" as const, role: "provider" as const,
  client: "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5", provider: "ST2BM9VVGXFWKQ0HPYRM5CA6QWJE8G21WNFYG6GJG",
  evaluator: "STBTXHXFXFGMNPXST7A6XQ1WNGC0V6TB6CDDQZB4", treasury: "ST1E7E64H8VSSSGE0RPWF90RRC91MQG7CRQRM1BFX" };

describe("MCP private evidence adapters", () => {
  it("requests and caches only the configured OAuth evidence scopes", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new URLSearchParams(String(init?.body)).get("scope")).toBe("evidence:read evidence:write");
      return Response.json({ access_token: "a".repeat(64), token_type: "Bearer", expires_in: 600,
        scope: "evidence:read evidence:write" });
    });
    const token = createEvidenceTokenProvider({ tokenEndpoint: "https://oauth.qa.nayori.ai/oauth/token",
      clientId: `ny_oc_${"a".repeat(24)}`, clientSecret: "s".repeat(32),
      scopes: ["evidence:read", "evidence:write"], fetch: fetcher });
    expect(await token()).toBe("a".repeat(64)); expect(await token()).toBe("a".repeat(64));
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("binds upload context to the fixed profile and contract", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/prepare")) return Response.json({ id: "59e377ce-9ee3-46bd-9ecf-95bd54dc068f",
        upload: { url: "https://perkos-nayori-qa-evidence-123456789012.s3.us-east-1.amazonaws.com", fields: { key: "fixed" } } }, { status: 201 });
      if (url.includes("s3.us-east-1.amazonaws.com")) return new Response(null, { status: 204 });
      return Response.json({ id: "59e377ce-9ee3-46bd-9ecf-95bd54dc068f",
        sha256: "0db52f4076c082518412afd3dd3576e2cb0c63703fd7fed5e23ade60efef31d9" });
    });
    const port = createMcpPrivateEvidence(profile, { accessToken: async () => "t".repeat(32), fetch: fetcher });
    const result = await port.upload({ evidenceId: "result", asset: "sbtc", jobId: "17", content: "answer", mediaType: "text/plain" });
    expect(result.uri).toContain("/v1/private-evidence/");
    const prepare = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(prepare.context).toMatchObject({ contract: "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5.sbtc-commerce-v5",
      provider: profile.provider, jobId: "17" });
  });
});
