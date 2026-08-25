import {
  createPerkOSX402PaymentRequired,
  decodePaymentRequiredHeader,
  encodePaymentRequiredHeader,
  resolveConfig,
} from "@perkos/agent-sdk";

const config = resolveConfig({ network: "mainnet" });
const paymentRequired = createPerkOSX402PaymentRequired(config, {
  resource: {
    url: "https://agent.example/jobs/7/fund",
    description: "Fund an existing PerkOS agent job escrow",
    mimeType: "application/json",
    serviceName: "Nayori",
    tags: ["agents", "escrow"],
  },
  asset: "sbtc",
  jobId: 7n,
  amount: 25_000n,
});

const header = encodePaymentRequiredHeader(paymentRequired);
const decoded = decodePaymentRequiredHeader(header);

console.log({
  headerName: "PAYMENT-REQUIRED",
  header,
  decoded,
  note: "Envelope-only example: no wallet, transaction, or facilitator is used.",
});
