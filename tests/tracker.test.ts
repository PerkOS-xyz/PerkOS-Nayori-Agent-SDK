import { describe, expect, it, vi } from "vitest";
import { PerkOSError, TransactionTracker } from "../src/index.js";

const TXID = `0x${"34".repeat(32)}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TransactionTracker", () => {
  it("treats a transaction not yet indexed as pending", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    const tracker = new TransactionTracker({
      network: "testnet",
      fetch,
      now: () => 0,
    });

    await expect(tracker.getStatus(TXID)).resolves.toMatchObject({
      txid: TXID,
      network: "testnet",
      status: "pending",
      observedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(fetch).toHaveBeenCalledWith(
      `https://api.testnet.hiro.so/extended/v3/transactions/${TXID}`,
      { headers: { accept: "application/json" } }
    );
  });

  it("normalizes a successful v3 transaction response", async () => {
    const tracker = new TransactionTracker({
      network: "mainnet",
      fetch: async () =>
        jsonResponse({
          status: "success",
          block: { height: 123, hash: "0xblock" },
          result: { hex: "0x0703", repr: "(ok u3)" },
        }),
      now: () => Date.UTC(2026, 7, 5),
    });

    await expect(tracker.getStatus(TXID)).resolves.toMatchObject({
      status: "success",
      blockHeight: 123,
      blockHash: "0xblock",
      result: { hex: "0x0703", repr: "(ok u3)" },
    });
  });

  it("hydrates a missing v3 Clarity result from transaction detail", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          block: { height: 456, hash: "0xblock" },
          result: null,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          tx_status: "success",
          tx_result: { hex: "0x0701", repr: "(ok u2)" },
        })
      );
    const tracker = new TransactionTracker({ network: "testnet", fetch });

    await expect(tracker.getStatus(TXID)).resolves.toMatchObject({
      status: "success",
      blockHeight: 456,
      result: { hex: "0x0701", repr: "(ok u2)" },
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      `https://api.testnet.hiro.so/extended/v3/transactions/${TXID}`,
      { headers: { accept: "application/json" } }
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `https://api.testnet.hiro.so/extended/v1/tx/${TXID}`,
      { headers: { accept: "application/json" } }
    );
  });

  it.each([
    ["abort_by_response", "abort"],
    ["dropped_replace_by_fee", "dropped"],
  ] as const)("maps %s to %s", async (apiStatus, expected) => {
    const tracker = new TransactionTracker({
      network: "testnet",
      fetch: async () => jsonResponse({ status: apiStatus }),
    });

    await expect(tracker.getStatus(TXID)).resolves.toMatchObject({
      status: expected,
    });
  });

  it("polls until a terminal status and reports every observation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "pending" }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          result: { hex: "0x0703", repr: "(ok true)" },
        })
      );
    const sleep = vi.fn(async () => undefined);
    const onStatus = vi.fn();
    const tracker = new TransactionTracker({
      network: "testnet",
      fetch,
      sleep,
    });

    await expect(
      tracker.waitForConfirmation(TXID, {
        pollIntervalMs: 50,
        timeoutMs: 1_000,
        onStatus,
      })
    ).resolves.toMatchObject({ status: "success" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50, undefined);
    expect(onStatus).toHaveBeenCalledTimes(2);
  });

  it("returns a bounded timeout receipt", async () => {
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(100).mockReturnValue(100);
    const tracker = new TransactionTracker({
      network: "testnet",
      fetch: async () => jsonResponse({ status: "pending" }),
      now: clock,
    });

    await expect(
      tracker.waitForConfirmation(TXID, { timeoutMs: 50, pollIntervalMs: 10 })
    ).resolves.toMatchObject({ status: "timeout", txid: TXID });
  });

  it("supports cancellation and rejects invalid API responses", async () => {
    const controller = new AbortController();
    controller.abort();
    const tracker = new TransactionTracker({
      network: "testnet",
      fetch: async () => jsonResponse({ status: "mystery" }),
    });

    await expect(
      tracker.waitForConfirmation(TXID, { signal: controller.signal })
    ).rejects.toMatchObject({ code: "CONFIRMATION_FAILED" });
    await expect(tracker.getStatus(TXID)).rejects.toBeInstanceOf(PerkOSError);
  });

  it("wraps malformed JSON returned by the transaction API", async () => {
    const tracker = new TransactionTracker({
      network: "testnet",
      fetch: async () => new Response("not-json", { status: 200 }),
    });

    await expect(tracker.getStatus(TXID)).rejects.toMatchObject({
      code: "CONFIRMATION_FAILED",
      message: "Transaction API returned invalid JSON.",
    });
  });
});
