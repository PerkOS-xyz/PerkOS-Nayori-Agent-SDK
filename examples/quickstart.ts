import { PerkOSClient } from "@perkos/agent-sdk";

const network = process.env.PERKOS_NETWORK === "testnet" ? "testnet" : "mainnet";
const client = new PerkOSClient({ network });

const [agents, stxJobs, sbtcJobs, configuredSbtc] = await Promise.all([
  client.getAgentCount(),
  client.getJobCount("stx"),
  client.getJobCount("sbtc"),
  client.getConfiguredSbtcToken(),
]);

console.log({
  network,
  agents: agents.toString(),
  stxJobs: stxJobs.toString(),
  sbtcJobs: sbtcJobs.toString(),
  configuredSbtc,
});
