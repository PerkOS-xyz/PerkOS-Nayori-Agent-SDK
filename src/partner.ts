export const NAYORI_PARTNER_SCOPES = [
  "catalog:read",
  "quotes:create",
  "payments:verify",
  "payments:settle",
  "payments:read",
  "mcp:invoke",
] as const;

export type NayoriPartnerScope = (typeof NAYORI_PARTNER_SCOPES)[number];
export type NayoriPartnerNetwork = "testnet" | "mainnet";
export type NayoriPartnerFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type NayoriPartnerChallenge = {
  readonly challengeId: string;
  readonly message: string;
  readonly expiresAt: string;
  readonly walletAddress: string;
  readonly network: NayoriPartnerNetwork;
};

export type NayoriPartnerCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tokenEndpoint: string;
  readonly scopes: readonly NayoriPartnerScope[];
  readonly walletAddress: string;
};

export type NayoriPartnerAccessToken = {
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: number;
  readonly scopes: readonly NayoriPartnerScope[];
};

export type NayoriPartnerMessageSignature = {
  readonly signature: string;
  readonly publicKey: string;
};

export type NayoriPartnerMessageSigner = (input: {
  readonly message: string;
  readonly walletAddress: string;
  readonly network: NayoriPartnerNetwork;
}) => Promise<NayoriPartnerMessageSignature>;

export type StacksConnectMessageRequest = (
  method: "stx_signMessage",
  params: { readonly message: string },
) => Promise<{ readonly signature: string; readonly publicKey: string }>;

export class NayoriPartnerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NayoriPartnerApiError";
  }
}

function apiOrigin(value?: string): string {
  const url = new URL(value ?? "https://api.nayori.ai");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new Error("Nayori partner API origin must use HTTPS outside local development.");
  }
  return url.origin;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is invalid.`);
  return value;
}

function normalizedHex(value: string, pattern: RegExp, label: string): string {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!pattern.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function scopes(value: unknown): NayoriPartnerScope[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (scope) =>
        typeof scope !== "string" ||
        !NAYORI_PARTNER_SCOPES.includes(scope as NayoriPartnerScope),
    )
  ) {
    throw new Error("Nayori partner scopes are invalid.");
  }
  return value as NayoriPartnerScope[];
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown> = {};
  try {
    payload = object(await response.json(), "Nayori API response");
  } catch {
    if (response.ok) throw new Error("Nayori API returned invalid JSON.");
  }
  if (!response.ok) {
    const nested = payload.error && typeof payload.error === "object"
      ? payload.error as Record<string, unknown>
      : null;
    const code =
      (typeof payload.error === "string" && payload.error) ||
      (nested && typeof nested.code === "string" && nested.code) ||
      "nayori_api_error";
    const message =
      (typeof payload.error_description === "string" && payload.error_description) ||
      (nested && typeof nested.message === "string" && nested.message) ||
      `Nayori API returned HTTP ${response.status}.`;
    throw new NayoriPartnerApiError(response.status, code, message);
  }
  return payload;
}

export function createStacksConnectPartnerSigner(
  request: StacksConnectMessageRequest,
): NayoriPartnerMessageSigner {
  return async ({ message }) => {
    const result = await request("stx_signMessage", { message });
    return {
      signature: normalizedHex(result.signature, /^[0-9a-f]{130}$/i, "Leather signature"),
      publicKey: normalizedHex(result.publicKey, /^(02|03)[0-9a-f]{64}$/i, "Leather public key"),
    };
  };
}

export class NayoriPartnerClient {
  readonly origin: string;
  private readonly fetchImpl: NayoriPartnerFetch;

  constructor(options: { readonly origin?: string; readonly fetch?: NayoriPartnerFetch } = {}) {
    this.origin = apiOrigin(options.origin);
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async requestChallenge(input: {
    readonly invitationToken: string;
    readonly walletAddress: string;
  }): Promise<NayoriPartnerChallenge> {
    const response = await this.fetchImpl(`${this.origin}/v1/partners/challenges`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await responseJson(response);
    const challenge = object(payload.challenge, "Nayori partner challenge");
    const network = string(challenge.network, "challenge.network");
    if (network !== "testnet" && network !== "mainnet") {
      throw new Error("challenge.network is invalid.");
    }
    return {
      challengeId: string(challenge.challengeId, "challenge.challengeId"),
      message: string(challenge.message, "challenge.message"),
      expiresAt: string(challenge.expiresAt, "challenge.expiresAt"),
      walletAddress: string(challenge.walletAddress, "challenge.walletAddress"),
      network,
    };
  }

  async register(input: {
    readonly challengeId: string;
    readonly signature: string;
    readonly publicKey: string;
  }): Promise<NayoriPartnerCredentials> {
    const response = await this.fetchImpl(`${this.origin}/v1/partners/register`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: input.challengeId,
        signature: normalizedHex(input.signature, /^[0-9a-f]{130}$/i, "wallet signature"),
        publicKey: normalizedHex(input.publicKey, /^(02|03)[0-9a-f]{64}$/i, "wallet public key"),
      }),
    });
    const payload = await responseJson(response);
    const client = object(payload.client, "Nayori OAuth client");
    return {
      clientId: string(client.clientId, "client.clientId"),
      clientSecret: string(client.clientSecret, "client.clientSecret"),
      tokenEndpoint: string(client.tokenEndpoint, "client.tokenEndpoint"),
      scopes: scopes(client.scopes),
      walletAddress: string(client.walletAddress, "client.walletAddress"),
    };
  }

  async enroll(input: {
    readonly invitationToken: string;
    readonly walletAddress: string;
    readonly signMessage: NayoriPartnerMessageSigner;
  }): Promise<NayoriPartnerCredentials> {
    const challenge = await this.requestChallenge(input);
    if (challenge.walletAddress !== input.walletAddress) {
      throw new Error("Nayori challenge wallet does not match the requested wallet.");
    }
    const signed = await input.signMessage({
      message: challenge.message,
      walletAddress: challenge.walletAddress,
      network: challenge.network,
    });
    const credentials = await this.register({
      challengeId: challenge.challengeId,
      ...signed,
    });
    if (credentials.walletAddress !== input.walletAddress) {
      throw new Error("Nayori OAuth client wallet does not match the enrolled wallet.");
    }
    return credentials;
  }

  async requestToken(input: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly scopes?: readonly NayoriPartnerScope[];
  }): Promise<NayoriPartnerAccessToken> {
    const body = new URLSearchParams({ grant_type: "client_credentials" });
    if (input.scopes?.length) body.set("scope", scopes([...input.scopes]).join(" "));
    const response = await this.fetchImpl(`${this.origin}/oauth/token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${btoa(`${input.clientId}:${input.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    const payload = await responseJson(response);
    if (payload.token_type !== "Bearer") throw new Error("Nayori token type is invalid.");
    if (typeof payload.expires_in !== "number" || !Number.isSafeInteger(payload.expires_in)) {
      throw new Error("Nayori token expiry is invalid.");
    }
    return {
      accessToken: string(payload.access_token, "access_token"),
      tokenType: "Bearer",
      expiresIn: payload.expires_in,
      scopes: scopes(string(payload.scope, "scope").split(" ")),
    };
  }

  async callMcp(input: {
    readonly accessToken: string;
    readonly id?: string | number;
    readonly method: "initialize" | "ping" | "tools/list" | "tools/call";
    readonly params?: unknown;
  }): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.origin}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: input.id ?? 1,
        method: input.method,
        ...(input.params === undefined ? {} : { params: input.params }),
      }),
    });
    return responseJson(response);
  }
}
