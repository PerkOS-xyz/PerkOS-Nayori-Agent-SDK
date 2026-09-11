import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { NayoriPrivateEvidenceClient } from "../src/private-evidence.js";

const contract = "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5.sbtc-commerce-v5";
const provider = "ST2BM9VVGXFWKQ0HPYRM5CA6QWJE8G21WNFYG6GJG";
const objectId = "59e377ce-9ee3-46bd-9ecf-95bd54dc068f";
const content = "private synthetic QA evidence";
const digest = createHash("sha256").update(content).digest("hex");

describe("Nayori private evidence client", () => {
  it("uploads directly to S3, never forwards OAuth, and returns a commitment-safe locator", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); calls.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith("/prepare")) return Response.json({ id: objectId,
        upload: { url: "https://perkos-nayori-qa-evidence-123456789012.s3.us-east-1.amazonaws.com/", fields: { key: "private-evidence/testnet/id", policy: "signed" } } }, { status: 201 });
      if (url.startsWith("https://perkos-nayori-qa-evidence-123456789012.s3.us-east-1.amazonaws.com")) return new Response(null, { status: 204 });
      if (url.endsWith("/complete")) return Response.json({ id: objectId, sha256: digest });
      throw Error("unexpected");
    });
    const client = new NayoriPrivateEvidenceClient({ accessToken: async () => "t".repeat(32), fetch: transport });
    const result = await client.upload({ evidenceId: "answer", content,
      context: { network: "testnet", contract, jobId: "17", provider, mediaType: "text/plain" } });
    expect(result).toEqual({ id: "answer", uri: `https://api.qa.nayori.ai/v1/private-evidence/${objectId}`,
      sha256: digest, mediaType: "text/plain", sizeBytes: Buffer.byteLength(content) });
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe(`Bearer ${"t".repeat(32)}`);
    expect(new Headers(calls[1]!.init?.headers).get("authorization")).toBeNull();
    expect(calls[1]!.init?.body).toBeInstanceOf(FormData);
  });

  it("downloads through a fresh capability and verifies exact bytes", async () => {
    const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/download")) return Response.json({ url: "https://perkos-nayori-qa-evidence-123456789012.s3.us-east-1.amazonaws.com/object?signature=short" });
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      return new Response(content, { headers: { "content-type": "text/plain" } });
    });
    const client = new NayoriPrivateEvidenceClient({ accessToken: async () => "t".repeat(32), fetch: transport });
    const bytes = await client.download({ id: "answer", uri: `https://api.qa.nayori.ai/v1/private-evidence/${objectId}`,
      sha256: digest, mediaType: "text/plain", sizeBytes: Buffer.byteLength(content) });
    expect(new TextDecoder().decode(bytes)).toBe(content);
  });

  it("surfaces bounded backpressure without retrying prepare", async () => {
    const transport = vi.fn(async () => Response.json({ error: "private_evidence_temporarily_unavailable" },
      { status: 503, headers: { "retry-after": "7" } }));
    const client = new NayoriPrivateEvidenceClient({ accessToken: async () => "t".repeat(32), fetch: transport });
    await expect(client.prepare({ network: "testnet", contract, jobId: "17", provider, sha256: digest,
      mediaType: "text/plain", sizeBytes: Buffer.byteLength(content) })).rejects.toMatchObject({
        code: "temporarily_unavailable", retryAfterSeconds: 7,
      });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin locators before requesting a capability", async () => {
    const transport = vi.fn();
    const client = new NayoriPrivateEvidenceClient({ accessToken: async () => "t".repeat(32), fetch: transport });
    await expect(client.download({ id: "answer", uri: `https://evil.example/v1/private-evidence/${objectId}`,
      sha256: digest, mediaType: "text/plain", sizeBytes: Buffer.byteLength(content) })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
