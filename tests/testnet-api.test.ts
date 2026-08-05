import { describe, expect, it, vi } from "vitest";
import { fetchChainTip } from "../examples/testnet-api.js";

describe("testnet example API", () => {
  it("reads the current Stacks node info endpoint", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ stacks_tip_height: 4_200_000 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(
      fetchChainTip("https://api.testnet.hiro.so/", fetch)
    ).resolves.toBe(4_200_000n);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.testnet.hiro.so/v2/info",
      { headers: { accept: "application/json" } }
    );
  });

  it("rejects malformed chain-height responses", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ stacks_tip_height: "unknown" }), {
        status: 200,
      })
    );

    await expect(fetchChainTip("https://api.testnet.hiro.so", fetch)).rejects.toThrow(
      "valid stacks_tip_height"
    );
  });
});
