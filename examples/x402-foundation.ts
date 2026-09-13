import {
  createPerkOSX402PaymentRequired,
  decodePaymentRequiredHeader,
  encodePaymentRequiredHeader,
  resolveConfig,
} from "@perkos/agent-sdk";

const config = resolveConfig({ network: "mainnet" });
const gross = 25_000n;
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
  amount: gross,
  serviceFeeTerms: {
    gross,
    basisPoints: 200,
    treasury: "SP1NT1V4X6GQR6T32Z8MSMNECZ6GSWX9HZ81SM1Y8",
    rejectionRefund: "net-after-evaluation",
  },
});

const header = encodePaymentRequiredHeader(paymentRequired);
const decoded = decodePaymentRequiredHeader(header);

console.log({
  headerName: "PAYMENT-REQUIRED",
  header,
  decoded,
  note: "Envelope-only example: no wallet, transaction, or facilitator is used.",
});
