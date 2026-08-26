import {
  HiroX402TransactionSource,
  InMemoryX402ReplayStore,
  PerkOSX402Facilitator,
  createPerkOSX402PaymentRequired,
  resolveConfig,
  type PaymentPayload,
} from "@perkos/agent-sdk";

const transaction =
  "0xaf4129fe46fc913fda7b9fa87543f05fc5f4430b9b5f26a46f9c3032ea0fcbd4";
const payer = "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH";
const blockHeight = 8_650_821;
const blockHash =
  "0x46786964695d632ce40d54e5a94f5e74bcaf4fc995ff45c9ae913be0020e402d";
const config = resolveConfig({ network: "mainnet" });
const paymentRequired = createPerkOSX402PaymentRequired(config, {
  resource: {
    url: "https://nayori.example/evidence/m1-job-1",
    description: "Read-only x402 verifier evidence",
    mimeType: "application/json",
    serviceName: "Nayori",
  },
  asset: "sbtc",
  jobId: 1n,
  amount: 10_000n,
  maxTimeoutSeconds: 3_600,
});
const paymentPayload: PaymentPayload = {
  x402Version: 2,
  resource: paymentRequired.resource,
  accepted: paymentRequired.accepts[0]!,
  payload: {
    transaction,
    payer,
    jobId: "1",
    amount: "10000",
    asset: "sbtc",
    commerceContract: config.contracts.sbtcCommerce,
    blockHeight,
    blockHash,
  },
};
const transactionSource = new HiroX402TransactionSource({ network: "mainnet" });
const facilitator = new PerkOSX402Facilitator({
  config,
  transactionSource,
  replayStore: new InMemoryX402ReplayStore(),
});

const verification = await facilitator.verify(
  paymentPayload,
  paymentRequired.accepts[0]!
);
if (verification.isValid || verification.invalidReason !== "payment_expired") {
  throw new Error(
    `Expected the historical proof to be rejected as expired, received ${JSON.stringify(verification)}`
  );
}

console.log({
  transaction,
  observedContract: config.contracts.sbtcCommerce,
  observedAsset: paymentRequired.accepts[0]!.asset,
  observedAmount: paymentRequired.accepts[0]!.amount,
  verification,
  note:
    "The facilitator matched the public funding call and transfer events, then failed closed because this historical transaction is outside the x402 payment window. No state was changed.",
});
