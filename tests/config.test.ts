import { describe, expect, it } from "vitest";
import { DEFAULT_DEPLOYMENTS, PerkOSError, resolveConfig, toUint } from "../src/index.js";

describe("configuration", () => {
  it("uses the current PerkOS mainnet deployment", () => {
    const config = resolveConfig({ network: "mainnet" });

    expect(config.contracts).toEqual(DEFAULT_DEPLOYMENTS.mainnet);
    expect(config.contracts.stxCommerce).toContain(".agentic-commerce-v2");
    expect(config.contracts.sbtcCommerce).toContain(".sbtc-commerce");
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

  it("accepts explicit same-network versioned contract overrides without changing defaults", () => {
    const candidate = resolveConfig({
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

    expect(candidate.contracts.stxCommerce).toContain(".agentic-commerce-v3");
    expect(candidate.contracts.sbtcCommerce).toContain(".sbtc-commerce-v2");
    expect(DEFAULT_DEPLOYMENTS.testnet.stxCommerce).toContain(".agentic-commerce-v2");
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
