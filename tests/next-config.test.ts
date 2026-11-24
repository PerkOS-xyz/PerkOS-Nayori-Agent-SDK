import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEPLOYMENTS,
  NAYORI_NEXT_DEPLOYMENTS,
  NAYORI_NEXT_DEPLOYERS,
  PerkOSError,
  describeNayoriNextError,
  quoteNayoriNextFee,
  resolveNayoriNextConfig,
} from "../src/index.js";

const TESTNET_DEPLOYER = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";

describe("next contract generation config", () => {
  it("defaults to the live deployments", () => {
    expect(NAYORI_NEXT_DEPLOYERS).toEqual({
      mainnet: "SP2BM4WCNQM286PFHPGA1BG2YXER0PCG1PKQ5MF1X",
      testnet: "ST3MRPNX0VNWYRSJ07PNTASE5BZ9K5XE57ARZ39DY",
    });
    for (const network of ["mainnet", "testnet"] as const) {
      const config = resolveNayoriNextConfig({ network });
      expect(config.deployed).toBe(true);
      expect(config.contracts.escrowSbtc).toBe(
        `${NAYORI_NEXT_DEPLOYERS[network]}.nayori-escrow-sbtc`
      );
      expect(NAYORI_NEXT_DEPLOYMENTS[network].deployed).toBe(true);
    }
  });

  it("uses canonical sBTC per network", () => {
    expect(resolveNayoriNextConfig({ network: "mainnet" }).contracts.sbtcToken).toBe(
      "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"
    );
    expect(resolveNayoriNextConfig({ network: "testnet" }).contracts.sbtcToken).toBe(
      "SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token"
    );
  });

  it("points every contract at a configured deployer", () => {
    const config = resolveNayoriNextConfig({ network: "testnet", deployer: TESTNET_DEPLOYER });
    expect(config.deployed).toBe(true);
    expect(config.contracts).toMatchObject({
      permissions: `${TESTNET_DEPLOYER}.nayori-permissions`,
      roles: `${TESTNET_DEPLOYER}.nayori-roles`,
      reputation: `${TESTNET_DEPLOYER}.nayori-reputation`,
      escrowSbtc: `${TESTNET_DEPLOYER}.nayori-escrow-sbtc`,
      escrowStx: `${TESTNET_DEPLOYER}.nayori-escrow-stx`,
      agents: `${TESTNET_DEPLOYER}.nayori-agents`,
      applications: `${TESTNET_DEPLOYER}.nayori-applications`,
    });
  });


  it("rejects a deployer from the other network", () => {
    expect(() =>
      resolveNayoriNextConfig({ network: "mainnet", deployer: TESTNET_DEPLOYER })
    ).toThrow(PerkOSError);
  });

  it("leaves the current generation defaults untouched", () => {
    expect(DEFAULT_DEPLOYMENTS.mainnet.sbtcCommerce).toMatch(/\.sbtc-commerce-v5$/);
    expect(DEFAULT_DEPLOYMENTS.mainnet.stxCommerce).toMatch(/\.agentic-commerce-v6$/);
  });

  it("describes contract error codes and quotes the 2% fee", () => {
    expect(describeNayoriNextError(308n)?.name).toBe("ERR_INVALID_BUDGET");
    expect(describeNayoriNextError(607)?.contract).toBe("applications");
    expect(describeNayoriNextError(999)).toBeUndefined();
    expect(quoteNayoriNextFee(1_000n)).toEqual({ budget: 1_000n, fee: 20n, net: 980n });
    expect(quoteNayoriNextFee("1049")).toEqual({ budget: 1_049n, fee: 20n, net: 1_029n });
  });
});
