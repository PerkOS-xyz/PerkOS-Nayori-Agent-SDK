import {
  NayoriX402PaymentPolicy,
  buildNayoriX402UnsignedPaymentTransaction,
  createNayoriX402PaymentIntent,
  createNayoriX402PaymentRequirements,
  createNayoriX402Quote,
} from "@perkos/agent-sdk";

const payer = "ST1THWXQ8368SDN2MJGE4BMDKMCHZ2GSVTSQDA7QF";
const payerPublicKey =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const payTo = "ST3AZN3BSQYJ5VWMNG92N88Z4G9498VYSHDZD9EK";
const now = Math.floor(Date.now() / 1_000);
const request = {
  method: "POST",
  url: "https://api.example.com/v1/weather",
  body: JSON.stringify({ city: "Miami" }),
} as const;

const quote = await createNayoriX402Quote({
  quoteId: "quote-payer-quickstart",
  merchantId: "merchant-weather",
  network: "testnet",
  asset: "usdcx",
  amount: 100_000n,
  payTo,
  ...request,
  issuedAt: now,
  expiresAt: now + 300,
});
const paymentRequirements = await createNayoriX402PaymentRequirements(quote);
const intent = await createNayoriX402PaymentIntent({
  quote,
  paymentRequirements,
  request,
  payer,
  publicKey: payerPublicKey,
  fee: 300n,
  nonce: 7n,
  nowSeconds: now,
});
const policy = new NayoriX402PaymentPolicy(
  {
    allowedNetworks: ["testnet"],
    allowedAssets: ["usdcx"],
    allowedRecipients: [payTo],
    allowedOrigins: ["https://api.example.com"],
    allowedMerchantIds: ["merchant-weather"],
    maxPerTransaction: { usdcx: 100_000n },
    maxPerSession: { usdcx: 500_000n },
    maxFeePerTransaction: 500n,
    maxFeePerSession: 2_500n,
  },
  () => now
);
const authorization = policy.reserve(intent);
const unsignedTransaction = await buildNayoriX402UnsignedPaymentTransaction(intent);

console.log(
  JSON.stringify(
    {
      status: "ready-for-signature",
      intentId: intent.intentId,
      quoteId: intent.quoteId,
      asset: intent.asset,
      amount: intent.amount,
      payer: intent.payer,
      payTo: intent.payTo,
      fee: intent.fee,
      nonce: intent.nonce,
      quoteFingerprint: intent.quoteFingerprint,
      unsignedTransactionBytes: unsignedTransaction.length / 2,
      policyRemaining: authorization.remainingThisSession.toString(),
      broadcast: false,
    },
    null,
    2
  )
);

authorization.release();
