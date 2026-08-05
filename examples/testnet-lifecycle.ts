import {
  HeadlessSigner,
  PerkOSClient,
  PerkOSError,
} from "@perkos/agent-sdk";
import type {
  ContractCallPlan,
  PerkOSSigner,
  TransactionConfirmation,
  TransactionReceipt,
} from "@perkos/agent-sdk";

const NETWORK = "testnet" as const;
const DEFAULT_API_URL = "https://api.testnet.hiro.so";
const DRY_RUN_CLIENT = "ST1THWXQ8368SDN2MJGE4BMDKMCHZ2GSVTSQDA7QF";
const DRY_RUN_PROVIDER = "ST3AZN3BSQYJ5VWMNG92N88Z4G9498VYSHDZD9EK";
const DRY_RUN_EVALUATOR = "ST1YXCNCJT2NJZR6G4NYNE6NZ0CPDKPWKVJDRPKTJ";
const DEMO_JOB_ID = 1n;
const DEMO_AMOUNT = 100n;

function json(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, current) =>
      typeof current === "bigint" ? current.toString() : current,
    2
  );
}

function printPlan(label: string, plan: ContractCallPlan): void {
  console.log(`\n${label}`);
  console.log(
    json({
      network: plan.network,
      contract: plan.contract,
      functionName: plan.functionName,
      intent: plan.intent,
      postConditionMode: plan.postConditionMode,
      postConditionCount: plan.postConditions.length,
    })
  );
}

function dryRun(): void {
  const preview = new PerkOSClient({
    network: NETWORK,
    spendingPolicy: {
      allowedNetworks: [NETWORK],
      allowedAssets: ["sbtc"],
      maxPerTransaction: { sbtc: DEMO_AMOUNT },
      maxPerSession: { sbtc: DEMO_AMOUNT },
    },
  });
  const expiresAt = 1_000_000n;
  const plans = [
    [
      "1. Register provider agent",
      preview.transactions.registerAgent({
        name: "PerkOS Testnet Provider",
        description: "Agent SDK transactional quickstart provider",
        wallet: DRY_RUN_PROVIDER,
        endpoints: [{ name: "mcp", url: "https://example.com/mcp" }],
      }),
    ],
    [
      "2. Create sBTC job with distinct provider and evaluator",
      preview.transactions.createJob({
        asset: "sbtc",
        provider: DRY_RUN_PROVIDER,
        evaluator: DRY_RUN_EVALUATOR,
        expiredAt: expiresAt,
        description: "Create a signed testnet lifecycle receipt",
      }),
    ],
    [
      "3. Set job budget",
      preview.transactions.setBudget({
        asset: "sbtc",
        jobId: DEMO_JOB_ID,
        amount: DEMO_AMOUNT,
      }),
    ],
    [
      "4. Fund exact sBTC escrow",
      preview.transactions.fundJob({
        asset: "sbtc",
        jobId: DEMO_JOB_ID,
        amount: DEMO_AMOUNT,
        sender: DRY_RUN_CLIENT,
      }),
    ],
    [
      "5. Provider submits deliverable",
      preview.transactions.submitWork({
        asset: "sbtc",
        jobId: DEMO_JOB_ID,
        deliverable: "ipfs:bafy-perkos-testnet-receipt",
      }),
    ],
    [
      "6. Evaluator releases escrow",
      preview.transactions.completeJob({
        asset: "sbtc",
        jobId: DEMO_JOB_ID,
        amount: DEMO_AMOUNT,
        recipient: DRY_RUN_PROVIDER,
      }),
    ],
    [
      "7. Client rates provider",
      preview.transactions.rateProvider({
        asset: "sbtc",
        jobId: DEMO_JOB_ID,
        score: 5n,
        comment: "Completed through the Agent SDK quickstart",
      }),
    ],
  ] as const;

  console.log("PerkOS sBTC lifecycle: safe testnet preview");
  console.log("No wallet, key, transaction, or network request was used.");
  for (const [label, plan] of plans) printPlan(label, plan);
  console.log("\nFunding policy decision");
  console.log(json(preview.preview(plans[3][1])));
  console.log(
    "\nTo broadcast, copy examples/testnet.env.example, fund all three testnet roles with fee STX, fund the client with testnet sBTC, and set PERKOS_CONFIRM_TESTNET_BROADCAST=yes."
  );
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live testnet mode.`);
  return value;
}

function amountFromEnvironment(): bigint {
  const value = requiredEnvironment("PERKOS_AMOUNT");
  if (!/^\d+$/.test(value) || BigInt(value) === 0n) {
    throw new Error("PERKOS_AMOUNT must be a positive integer number of satoshis.");
  }
  return BigInt(value);
}

async function chainTip(apiUrl: string): Promise<bigint> {
  const response = await fetch(`${apiUrl}/extended/v1/info`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Stacks API returned HTTP ${response.status}.`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new Error("Invalid Stacks API info response.");
  const height = (body as Record<string, unknown>).stacks_tip_height;
  if (typeof height !== "number" || !Number.isSafeInteger(height) || height < 0) {
    throw new Error("Stacks API did not return a valid stacks_tip_height.");
  }
  return BigInt(height);
}

function okUint(confirmation: TransactionConfirmation, label: string): bigint {
  const repr = confirmation.result?.repr;
  const match = repr?.match(/^\(ok u(\d+)\)$/);
  if (!match?.[1]) {
    throw new Error(`${label} did not return an (ok uint) result: ${repr ?? "missing"}.`);
  }
  return BigInt(match[1]);
}

async function broadcastAndConfirm(
  label: string,
  client: PerkOSClient,
  action: () => Promise<TransactionReceipt>
): Promise<TransactionConfirmation> {
  console.log(`\n${label}`);
  const broadcast = await action();
  console.log(`Broadcast: ${broadcast.explorerUrl}`);
  const confirmation = await client.confirm(broadcast, {
    pollIntervalMs: 5_000,
    timeoutMs: 10 * 60_000,
  });
  console.log(`Confirmation: ${confirmation.status}`);
  if (confirmation.status !== "success") {
    throw new PerkOSError(
      "CONFIRMATION_FAILED",
      `${label} ended with ${confirmation.status}.`,
      { txid: confirmation.txid, result: confirmation.result }
    );
  }
  return confirmation;
}

function liveClient(
  signer: PerkOSSigner,
  apiUrl: string,
  amount?: bigint
): PerkOSClient {
  return new PerkOSClient({
    network: NETWORK,
    apiUrl,
    signer,
    ...(amount === undefined
      ? {}
      : {
          spendingPolicy: {
            allowedNetworks: [NETWORK],
            allowedAssets: ["sbtc"],
            maxPerTransaction: { sbtc: amount },
            maxPerSession: { sbtc: amount },
          },
        }),
  });
}

async function liveRun(): Promise<void> {
  const amount = amountFromEnvironment();
  const apiUrl = (process.env.PERKOS_API_URL?.trim() || DEFAULT_API_URL).replace(
    /\/+$/,
    ""
  );
  const clientSigner = new HeadlessSigner({
    network: NETWORK,
    apiUrl,
    privateKeyProvider: () => requiredEnvironment("PERKOS_CLIENT_PRIVATE_KEY"),
  });
  const providerSigner = new HeadlessSigner({
    network: NETWORK,
    apiUrl,
    privateKeyProvider: () => requiredEnvironment("PERKOS_PROVIDER_PRIVATE_KEY"),
  });
  const evaluatorSigner = new HeadlessSigner({
    network: NETWORK,
    apiUrl,
    privateKeyProvider: () => requiredEnvironment("PERKOS_EVALUATOR_PRIVATE_KEY"),
  });
  const [clientAddress, providerAddress, evaluatorAddress, tip] = await Promise.all([
    clientSigner.getAddress(),
    providerSigner.getAddress(),
    evaluatorSigner.getAddress(),
    chainTip(apiUrl),
  ]);
  if (new Set([clientAddress, providerAddress, evaluatorAddress]).size !== 3) {
    throw new Error("Client, provider, and evaluator keys must control distinct addresses.");
  }

  const client = liveClient(clientSigner, apiUrl, amount);
  const provider = liveClient(providerSigner, apiUrl);
  const evaluator = liveClient(evaluatorSigner, apiUrl);
  const expiresAt = tip + 1_000n;
  const run = Date.now().toString(36);

  console.log("PerkOS sBTC lifecycle: LIVE TESTNET MODE");
  console.log(
    json({
      network: NETWORK,
      amountSatoshis: amount,
      client: clientAddress,
      provider: providerAddress,
      evaluator: evaluatorAddress,
      expiresAt,
    })
  );

  await broadcastAndConfirm("1. Register provider agent", provider, () =>
    provider.registerAgent({
      name: `Testnet Provider ${run}`,
      description: "PerkOS Agent SDK transactional quickstart provider",
      wallet: providerAddress,
      endpoints: [{ name: "mcp", url: "https://example.com/mcp" }],
    })
  );
  const created = await broadcastAndConfirm("2. Create sBTC job", client, () =>
    client.createJob({
      asset: "sbtc",
      provider: providerAddress,
      evaluator: evaluatorAddress,
      expiredAt: expiresAt,
      description: `Agent SDK testnet lifecycle ${run}`,
    })
  );
  const jobId = okUint(created, "create-job");
  console.log(`Job ID: ${jobId}`);

  await broadcastAndConfirm("3. Set job budget", client, () =>
    client.setBudget({ asset: "sbtc", jobId, amount })
  );
  await broadcastAndConfirm("4. Fund exact sBTC escrow", client, () =>
    client.fundJob({ asset: "sbtc", jobId, amount })
  );
  await broadcastAndConfirm("5. Provider submits deliverable", provider, () =>
    provider.submitWork({
      asset: "sbtc",
      jobId,
      deliverable: `ipfs:perkos-${run}`,
    })
  );
  await broadcastAndConfirm("6. Evaluator releases escrow", evaluator, () =>
    evaluator.completeJob("sbtc", jobId)
  );
  await broadcastAndConfirm("7. Client rates provider", client, () =>
    client.rateProvider({
      asset: "sbtc",
      jobId,
      score: 5n,
      comment: "Completed through the Agent SDK quickstart",
    })
  );

  const [job, reputation] = await Promise.all([
    client.getJob("sbtc", jobId),
    client.getReputation(providerAddress),
  ]);
  console.log("\nFinal on-chain state");
  console.log(json({ job, reputation }));
}

if (process.env.PERKOS_CONFIRM_TESTNET_BROADCAST === "yes") {
  await liveRun();
} else {
  dryRun();
}
