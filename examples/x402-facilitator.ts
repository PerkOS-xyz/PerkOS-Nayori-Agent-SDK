import {
  HiroX402TransactionSource,
  InMemoryX402ReplayStore,
  PerkOSX402Facilitator,
  createPerkOSX402PaymentRequired,
  resolveConfig,
  type PaymentPayload,
} from "@perkos/agent-sdk";

const transaction =
  "0xb710a9560803fccd2ecd0f20ffbe784efb9476eaa2cedcf74c8dcba975387e2e";
const payer = "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH";
const blockHeight = 8_886_273;
const blockHash =
  "0x9c19ca3e008b3b645f155b74c70d525978dbda41caec92b93b60b6b61185c51c";
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
  amount: 100n,
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
    amount: "100",
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
