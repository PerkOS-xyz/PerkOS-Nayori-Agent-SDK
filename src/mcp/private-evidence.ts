import { NayoriPrivateEvidenceClient, type NayoriPrivateEvidenceClientOptions } from "../private-evidence.js";
import type { NayoriProfile, PrivateEvidencePort } from "./server.js";

export function createMcpPrivateEvidence(profile: Readonly<NayoriProfile>, options: NayoriPrivateEvidenceClientOptions): PrivateEvidencePort {
  const client = new NayoriPrivateEvidenceClient(options);
  return {
    upload: input => client.upload({ evidenceId: input.evidenceId, content: input.content,
      context: { network: "testnet", contract: input.asset === "stx" ?
        "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5.agentic-commerce-v6" :
        "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5.sbtc-commerce-v5",
      jobId: input.jobId, provider: profile.provider, mediaType: input.mediaType } }),
    download: reference => client.download(reference),
  };
}

export function createEvidenceTokenProvider(input: {
  readonly tokenEndpoint: string; readonly clientId: string; readonly clientSecret: string;
  readonly scopes: readonly ("evidence:read" | "evidence:write")[]; readonly fetch?: typeof globalThis.fetch;
}) {
  const endpoint = new URL(input.tokenEndpoint);
  if (endpoint.href !== "https://oauth.qa.nayori.ai/oauth/token" ||
    !/^ny_oc_[A-Za-z0-9_-]{24}$/.test(input.clientId) || input.clientSecret.length < 32 ||
    input.scopes.length < 1 || input.scopes.length > 2 || new Set(input.scopes).size !== input.scopes.length) {
    throw new Error("invalid_private_evidence_credentials");
  }
  const fetcher = input.fetch ?? globalThis.fetch.bind(globalThis);
  let cached: { value: string; expiresAt: number } | undefined;
  return async () => {
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.value;
    const body = new URLSearchParams({ grant_type: "client_credentials", scope: input.scopes.join(" ") });
    const response = await fetcher(endpoint, { method: "POST", redirect: "error", credentials: "omit",
      signal: AbortSignal.timeout(15000), headers: { accept: "application/json",
        authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
    if (!response.ok) { await response.body?.cancel(); throw new Error("private_evidence_token_failed"); }
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("private_evidence_token_failed");
    const token = value as Record<string, unknown>;
    if (token.token_type !== "Bearer" || typeof token.access_token !== "string" || token.access_token.length > 8192 ||
      typeof token.expires_in !== "number" || !Number.isSafeInteger(token.expires_in) || token.expires_in < 60 || token.expires_in > 900 ||
      token.scope !== input.scopes.join(" ")) throw new Error("private_evidence_token_failed");
    cached = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
    return cached.value;
  };
}
