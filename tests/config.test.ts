import { describe, expect, it } from "vitest";
import { DEFAULT_DEPLOYMENTS, PerkOSError, resolveConfig, toUint } from "../src/index.js";

describe("configuration", () => {
  it("uses the current PerkOS mainnet deployment", () => {
    const config = resolveConfig({ network: "mainnet" });

    expect(config.contracts).toEqual(DEFAULT_DEPLOYMENTS.mainnet);
    expect(config.contracts.stxCommerce).toContain(".agentic-commerce-v5");
    expect(config.contracts.sbtcCommerce).toContain(".sbtc-commerce-v4");
    expect(config.contracts.reputationRegistry).toContain(".reputation-registry-v3");
    expect(config.contracts.sbtcToken).toBe(
      "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"
    );
  });

  it("rejects a contract override from the wrong network", () => {
    expect(() =>
      resolveConfig({
        network: "mainnet",
        contracts: {
          agentRegistry:
            "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5.agent-registry",
        },
      })
    ).toThrowError(PerkOSError);
  });

  it("accepts same-network historical overrides without mutating active defaults", () => {
    const historical = resolveConfig({
      network: "testnet",
      contracts: {
        stxCommerce:
          "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5.agentic-commerce-v3",
        sbtcCommerce:
          "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5.sbtc-commerce-v2",
        reputationRegistry:
          "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5.reputation-registry-v3",
      },
    });

    expect(historical.contracts.stxCommerce).toContain(".agentic-commerce-v3");
    expect(historical.contracts.sbtcCommerce).toContain(".sbtc-commerce-v2");
    expect(DEFAULT_DEPLOYMENTS.testnet.stxCommerce).toContain(".agentic-commerce-v5");
    expect(DEFAULT_DEPLOYMENTS.testnet.sbtcCommerce).toContain(".sbtc-commerce-v4");
    expect(DEFAULT_DEPLOYMENTS.testnet.sbtcToken).toBe(
      "SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token"
    );
  });

  it("normalizes a custom API URL", () => {
    const config = resolveConfig({
      network: "testnet",
      apiUrl: "https://api.example.test/",
    });

    expect(config.apiUrl).toBe("https://api.example.test");
  });

  it("requires safe unsigned integer inputs", () => {
    expect(toUint("25000", "amount")).toBe(25_000n);
    expect(() => toUint(Number.MAX_SAFE_INTEGER + 1, "amount")).toThrow(
      "amount must be an unsigned integer"
    );
    expect(() => toUint(0, "amount")).toThrow("greater than zero");
  });
});
