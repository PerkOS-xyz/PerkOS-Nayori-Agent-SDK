const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JOB = /^[1-9][0-9]{0,38}$/;
const CONTRACT = /^ST[A-Z0-9]{20,41}\.[a-z][a-z0-9-]{0,39}$/;
const PRINCIPAL = /^ST[A-Z0-9]{20,41}$/;

export type NayoriPrivateEvidenceMediaType = "text/plain" | "application/json";
export interface NayoriPrivateEvidenceContext {
  readonly network: "testnet";
  readonly contract: string;
  readonly jobId: string;
  readonly provider: string;
  readonly sha256: string;
  readonly mediaType: NayoriPrivateEvidenceMediaType;
  readonly sizeBytes: number;
}
export interface NayoriPrivateEvidenceReference {
  readonly id: string;
  readonly uri: string;
  readonly sha256: string;
  readonly mediaType: NayoriPrivateEvidenceMediaType;
  readonly sizeBytes: number;
}
export interface NayoriPrivateEvidenceClientOptions {
  readonly origin?: string;
  readonly accessToken: () => Promise<string>;
  readonly fetch?: typeof globalThis.fetch;
}

export class NayoriPrivateEvidenceError extends Error {
  constructor(readonly code: "denied" | "temporarily_unavailable" | "invalid_response", readonly retryAfterSeconds?: number) {
    super(code === "temporarily_unavailable" ? "Nayori private evidence is temporarily unavailable." :
      code === "denied" ? "Nayori private evidence request was denied." : "Nayori private evidence returned an invalid response.");
    this.name = "NayoriPrivateEvidenceError";
  }
}

function ensure(ok: unknown): asserts ok { if (!ok) throw new NayoriPrivateEvidenceError("invalid_response"); }
function origin(value = "https://api.qa.nayori.ai") {
  const url = new URL(value);
  ensure(url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash);
  return url.origin;
}
function qaS3(url: URL) {
  return /^perkos-nayori-qa-evidence-[0-9]{12}\.s3(?:\.us-east-1)?\.amazonaws\.com$/.test(url.hostname) &&
    (url.port === "" || url.port === "443");
}
function context(input: NayoriPrivateEvidenceContext): NayoriPrivateEvidenceContext {
  ensure(input.network === "testnet" && CONTRACT.test(input.contract) && JOB.test(input.jobId) &&
    BigInt(input.jobId) < 2n ** 128n && PRINCIPAL.test(input.provider) && HASH.test(input.sha256) &&
    !/^0+$/.test(input.sha256) && ["text/plain", "application/json"].includes(input.mediaType) &&
    Number.isSafeInteger(input.sizeBytes) && input.sizeBytes >= 1 && input.sizeBytes <= 8192);
  return { network: input.network, contract: input.contract, jobId: input.jobId, provider: input.provider,
    sha256: input.sha256, mediaType: input.mediaType, sizeBytes: input.sizeBytes };
}
function evidenceUri(apiOrigin: string, id: string) {
  ensure(UUID.test(id));
  return `${apiOrigin}/v1/private-evidence/${id}`;
}
function retryAfter(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value || !/^[0-9]{1,3}$/.test(value)) return 1;
  return Math.max(1, Math.min(300, Number(value)));
}
async function json(response: Response): Promise<Record<string, unknown>> {
  if (response.status === 503) throw new NayoriPrivateEvidenceError("temporarily_unavailable", retryAfter(response));
  if (response.status === 401 || response.status === 403 || response.status === 429) throw new NayoriPrivateEvidenceError("denied");
  if (!response.ok) throw new NayoriPrivateEvidenceError("invalid_response");
  const value: unknown = await response.json();
  ensure(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
async function sha256(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", copy.buffer)),
    byte => byte.toString(16).padStart(2, "0")).join("");
}
function verifyText(bytes: Uint8Array, mediaType: NayoriPrivateEvidenceMediaType) {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new NayoriPrivateEvidenceError("invalid_response"); }
  if (mediaType === "application/json") {
    try { JSON.parse(text); } catch { throw new NayoriPrivateEvidenceError("invalid_response"); }
  }
}

/**
 * Bounded direct-S3 client. OAuth is sent only to Nayori; signed POST fields and signed GET URLs
 * are treated as short-lived capabilities and are never retained by this class.
 */
export class NayoriPrivateEvidenceClient {
  readonly origin: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  constructor(private readonly options: NayoriPrivateEvidenceClientOptions) {
    ensure(typeof options.accessToken === "function");
    this.origin = origin(options.origin);
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }
  private async post(path: "prepare" | "complete" | "download", body: unknown) {
    const token = await this.options.accessToken();
    ensure(typeof token === "string" && token.length >= 16 && token.length <= 8192 && !/[\r\n]/.test(token));
    const response = await this.fetchImpl(`${this.origin}/v1/private-evidence/${path}`, {
      method: "POST", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15000),
      headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return json(response);
  }
  async prepare(input: NayoriPrivateEvidenceContext) {
    const prepared = await this.post("prepare", { context: context(input) });
    ensure(typeof prepared.id === "string" && UUID.test(prepared.id));
    ensure(prepared.upload !== null && typeof prepared.upload === "object" && !Array.isArray(prepared.upload));
    const upload = prepared.upload as Record<string, unknown>;
    ensure(typeof upload.url === "string" && upload.fields !== null && typeof upload.fields === "object" && !Array.isArray(upload.fields));
    const uploadUrl = new URL(upload.url);
    ensure(uploadUrl.protocol === "https:" && !uploadUrl.username && !uploadUrl.password && !uploadUrl.hash && qaS3(uploadUrl));
    const fields = upload.fields as Record<string, unknown>;
    ensure(Object.keys(fields).length >= 1 && Object.values(fields).every(v => typeof v === "string"));
    return { id: prepared.id, upload: { url: uploadUrl.toString(), fields: fields as Record<string, string> } };
  }
  async upload(input: { readonly evidenceId: string; readonly content: string | Uint8Array;
    readonly context: Omit<NayoriPrivateEvidenceContext, "sha256" | "sizeBytes"> }): Promise<NayoriPrivateEvidenceReference> {
    ensure(/^[a-zA-Z0-9._-]{1,64}$/.test(input.evidenceId));
    const bytes = typeof input.content === "string" ? new TextEncoder().encode(input.content) : new Uint8Array(input.content);
    ensure(bytes.length >= 1 && bytes.length <= 8192);
    verifyText(bytes, input.context.mediaType);
    const digest = await sha256(bytes);
    const prepared = await this.prepare({ ...input.context, sha256: digest, sizeBytes: bytes.length });
    const form = new FormData();
    for (const [key, value] of Object.entries(prepared.upload.fields)) form.append(key, value);
    form.append("file", new Blob([bytes], { type: input.context.mediaType }));
    const uploaded = await this.fetchImpl(prepared.upload.url, { method: "POST", redirect: "error", credentials: "omit",
      signal: AbortSignal.timeout(30000), body: form });
    if (!uploaded.ok) { await uploaded.body?.cancel(); throw new NayoriPrivateEvidenceError("invalid_response"); }
    await uploaded.body?.cancel();
    const complete = await this.post("complete", { id: prepared.id });
    ensure(complete.id === prepared.id && complete.sha256 === digest);
    return { id: input.evidenceId, uri: evidenceUri(this.origin, prepared.id), sha256: digest,
      mediaType: input.context.mediaType, sizeBytes: bytes.length };
  }
  async download(reference: NayoriPrivateEvidenceReference): Promise<Uint8Array> {
    ensure(/^[a-zA-Z0-9._-]{1,64}$/.test(reference.id) && HASH.test(reference.sha256) &&
      ["text/plain", "application/json"].includes(reference.mediaType) &&
      Number.isSafeInteger(reference.sizeBytes) && reference.sizeBytes >= 1 && reference.sizeBytes <= 8192);
    const locator = new URL(reference.uri);
    ensure(locator.origin === this.origin && locator.pathname.startsWith("/v1/private-evidence/") && !locator.search && !locator.hash);
    const id = locator.pathname.slice("/v1/private-evidence/".length);
    ensure(UUID.test(id));
    const authorized = await this.post("download", { id });
    ensure(typeof authorized.url === "string");
    const signed = new URL(authorized.url);
    ensure(signed.protocol === "https:" && !signed.username && !signed.password && !signed.hash && qaS3(signed));
    const response = await this.fetchImpl(signed, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15000),
      headers: { accept: reference.mediaType } });
    if (!response.ok) { await response.body?.cancel(); throw new NayoriPrivateEvidenceError("invalid_response"); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    ensure(bytes.length === reference.sizeBytes && bytes.length <= 8192 && await sha256(bytes) === reference.sha256);
    verifyText(bytes, reference.mediaType);
    return bytes;
  }
}
