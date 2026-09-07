import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PerkOSClient } from "../src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (name: string) => readFileSync(resolve(root, name), "utf8");

describe("existing-agent onboarding contract", () => {
  it("keeps installation of the agent/model outside the Nayori workflow", () => {
    const guide = read("docs/EXISTING_AGENT.md");
    expect(guide).toContain("after your agent is installed and working with your own LLM");
    expect(guide).toContain("No PerkOS-LLM account or credentials are required");
    expect(guide).toContain("Hermes is an example integration, not a requirement");
    expect(guide).toMatch(/unreleased QA candidate/i);
    expect(guide).toContain("different");
  });

  it("documents ownership, confirmation and recovery instead of treating a plan as registration", () => {
    const guide = read("docs/EXISTING_AGENT.md");
    for (const text of ["creator", "nayori.confirm(savedTxid)", '(ok uN)',
      "nayori.getAgent(agentId)", "global agent count", "query the saved txid",
      "does not require partner credentials", "does not create a mainnet identity"]) {
      expect(guide).toContain(text);
    }
  });

  it("keeps wallet preparation separate and links both roles", () => {
    const guide = read("docs/EXISTING_AGENT.md");
    expect(guide).toContain("WALLET_SIGNER_SETUP.md");
    expect(guide).toContain("HERMES_BUYER.md");
    expect(guide).toContain("HERMES_PROVIDER.md");
    const wallet = read("docs/WALLET_SIGNER_SETUP.md");
    expect(wallet).toContain("not a Nayori wallet-generation or custody service");
    expect(wallet).toContain("not an encrypted backup");
    expect(wallet).toMatch(/durable intent\/nonce\/txid journal/i);
    for (const file of ["HERMES_BUYER.md", "HERMES_PROVIDER.md", "HERMES_MCP.md"]) {
      expect(read("docs/" + file)).toContain("EXISTING_AGENT.md");
    }
  });

  it("resolves the local documentation links from the new guides", () => {
    for (const name of ["docs/EXISTING_AGENT.md", "docs/WALLET_SIGNER_SETUP.md"]) {
      for (const match of read(name).matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
        if (/^https?:/.test(match[1]!)) continue;
        expect(existsSync(resolve(root, dirname(name), match[1]!))).toBe(true);
      }
    }
  });

  it("builds the documented no-endpoint registration without a signer or network call", () => {
    const client = new PerkOSClient({ network: "testnet" });
    const plan = client.transactions.registerAgent({
      name: "My Research Agent",
      description: "Produces cited research for assigned jobs.",
      wallet: "ST000000000000000000002AMW42H",
      endpoints: [],
    });
    expect(plan.network).toBe("testnet");
    expect(plan.functionName).toBe("register-agent");
    expect(plan.contract).toContain(".agent-registry");
    expect(plan.functionArgs).toHaveLength(4);
  });
});
