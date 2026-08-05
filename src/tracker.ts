import { PerkOSError } from "./errors.js";
import { normalizeTxid } from "./txid.js";
import type {
  ConfirmationOptions,
  PerkOSNetwork,
  TransactionConfirmation,
  TransactionConfirmationStatus,
  TransactionResultValue,
  TransactionTrackerLike,
} from "./types.js";
import { normalizeApiUrl } from "./validation.js";

export type TrackerFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface TransactionTrackerOptions {
  readonly network: PerkOSNetwork;
  readonly apiUrl?: string;
  readonly fetch?: TrackerFetch;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => number;
}

const DEFAULT_API_URL: Readonly<Record<PerkOSNetwork, string>> = {
  mainnet: "https://api.hiro.so",
  testnet: "https://api.testnet.hiro.so",
};

function statusFromApi(value: unknown): Exclude<TransactionConfirmationStatus, "timeout"> {
  if (typeof value !== "string") {
    throw new PerkOSError(
      "CONFIRMATION_FAILED",
      "The transaction API returned no status."
    );
  }
  const status = value.toLowerCase();
  if (status === "success") return "success";
  if (status === "pending" || status === "mempool") return "pending";
  if (status.startsWith("abort")) return "abort";
  if (status.startsWith("drop")) return "dropped";
  throw new PerkOSError(
    "CONFIRMATION_FAILED",
    `The transaction API returned an unknown status: ${value}.`
  );
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function resultFromApi(value: unknown): TransactionResultValue | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const hex = optionalString(record.hex);
  const repr = optionalString(record.repr);
  if (!hex && !repr) return undefined;
  return { ...(hex ? { hex } : {}), ...(repr ? { repr } : {}) };
}

function abortError(): PerkOSError {
  return new PerkOSError(
    "CONFIRMATION_FAILED",
    "Transaction confirmation was cancelled."
  );
}

async function defaultSleep(
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const finish = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class TransactionTracker implements TransactionTrackerLike {
  private readonly network: PerkOSNetwork;
  private readonly apiUrl: string;
  private readonly fetch: TrackerFetch;
  private readonly sleep: (
    milliseconds: number,
    signal?: AbortSignal
  ) => Promise<void>;
  private readonly now: () => number;

  constructor(options: TransactionTrackerOptions) {
    this.network = options.network;
    this.apiUrl = normalizeApiUrl(
      options.apiUrl ?? DEFAULT_API_URL[options.network],
      "TransactionTracker apiUrl"
    );
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  async getStatus(txidInput: string): Promise<TransactionConfirmation> {
    const txid = normalizeTxid(txidInput);
    let response: Response;
    try {
      response = await this.fetch(
        `${this.apiUrl}/extended/v3/transactions/${encodeURIComponent(txid)}`,
        { headers: { accept: "application/json" } }
      );
    } catch (cause) {
      throw new PerkOSError(
        "CONFIRMATION_FAILED",
        "Could not reach the Stacks transaction API.",
        { cause, txid }
      );
    }

    const observedAt = new Date(this.now()).toISOString();
    if (response.status === 404) {
      return {
        txid,
        network: this.network,
        status: "pending",
        observedAt,
      };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new PerkOSError(
        "CONFIRMATION_FAILED",
        `Transaction API returned HTTP ${response.status}.`,
        { txid, status: response.status, body: body.slice(0, 500) }
      );
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch (cause) {
      throw new PerkOSError(
        "CONFIRMATION_FAILED",
        "Transaction API returned invalid JSON.",
        { cause, txid }
      );
    }
    if (!raw || typeof raw !== "object") {
      throw new PerkOSError(
        "CONFIRMATION_FAILED",
        "Transaction API returned an invalid response.",
        { txid, raw }
      );
    }
    const record = raw as Record<string, unknown>;
    const block =
      record.block && typeof record.block === "object"
        ? (record.block as Record<string, unknown>)
        : undefined;
    const status = statusFromApi(record.status ?? record.tx_status);
    let result = resultFromApi(record.result ?? record.tx_result);
    if (!result && status !== "pending") {
      result = await this.getExecutionResult(txid);
    }
    const blockHeight = optionalNumber(block?.height ?? record.block_height);
    const blockHash = optionalString(block?.hash ?? record.block_hash);
    return {
      txid,
      network: this.network,
      status,
      observedAt,
      ...(blockHeight !== undefined ? { blockHeight } : {}),
      ...(blockHash ? { blockHash } : {}),
      ...(result ? { result } : {}),
      raw,
    };
  }

  private async getExecutionResult(
    txid: string
  ): Promise<TransactionResultValue | undefined> {
    try {
      const response = await this.fetch(
        `${this.apiUrl}/extended/v1/tx/${encodeURIComponent(txid)}`,
        { headers: { accept: "application/json" } }
      );
      if (!response.ok) return undefined;
      const raw: unknown = await response.json();
      if (!raw || typeof raw !== "object") return undefined;
      const record = raw as Record<string, unknown>;
      return resultFromApi(record.tx_result ?? record.result);
    } catch {
      return undefined;
    }
  }

  async waitForConfirmation(
    txidInput: string,
    options: ConfirmationOptions = {}
  ): Promise<TransactionConfirmation> {
    const txid = normalizeTxid(txidInput);
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const timeoutMs = options.timeoutMs ?? 10 * 60_000;
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) {
      throw new PerkOSError(
        "CONFIG_INVALID",
        "pollIntervalMs must be at least 1 millisecond."
      );
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
      throw new PerkOSError(
        "CONFIG_INVALID",
        "timeoutMs must be at least 1 millisecond."
      );
    }

    const startedAt = this.now();
    let last: TransactionConfirmation | undefined;
    while (true) {
      if (options.signal?.aborted) throw abortError();
      last = await this.getStatus(txid);
      await options.onStatus?.(last);
      if (last.status !== "pending") return last;

      const elapsed = this.now() - startedAt;
      if (elapsed >= timeoutMs) {
        return {
          ...last,
          status: "timeout",
          observedAt: new Date(this.now()).toISOString(),
        };
      }
      await this.sleep(
        Math.min(pollIntervalMs, Math.max(1, timeoutMs - elapsed)),
        options.signal
      );
    }
  }
}
