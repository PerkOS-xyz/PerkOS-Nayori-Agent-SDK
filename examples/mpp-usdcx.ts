import {
  NayoriX402PaymentPolicy,
  buildNayoriMppUnsignedPaymentTransaction,
  createNayoriMppUsdcStacksChallenge,
  createNayoriX402PaymentIntent,
  createNayoriX402PaymentRequirements,
  createNayoriX402Quote,
  decodeNayoriMppChallengeHeader,
  decodeNayoriMppUsdcStacksRequest,
} from "@perkos/agent-sdk";

const payer = "ST1THWXQ8368SDN2MJGE4BMDKMCHZ2GSVTSQDA7QF";
const payerPublicKey =
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const payTo = "ST3AZN3BSQYJ5VWMNG92N88Z4G9498VYSHDZD9EK";
const now = Math.floor(Date.now() / 1_000);
const protectedRequest = {
  method: "POST",
  url: "https://api.nayori.ai/api/mpp/v1/research",
  body: JSON.stringify({ topic: "Stacks agent commerce" }),
} as const;

const quote = await createNayoriX402Quote({
  quoteId: "nq_mpp_quickstart_001",
  merchantId: "merchant-research",
  network: "testnet",
  asset: "usdcx",
  amount: 100_000n,
  payTo,
  ...protectedRequest,
  issuedAt: now,
  expiresAt: now + 300,
});
const challenge = await createNayoriMppUsdcStacksChallenge({
  quote,
  realm: "api.nayori.ai",
  description: "Nayori agent research request",
});
const paymentRequirements = await createNayoriX402PaymentRequirements(quote);
const intent = await createNayoriX402PaymentIntent({
  quote,
  paymentRequirements,
  request: protectedRequest,
  payer,
  publicKey: payerPublicKey,
  fee: 300n,
  nonce: 0n,
  nowSeconds: now,
});
const policy = new NayoriX402PaymentPolicy(
  {
    allowedNetworks: ["testnet"],
    allowedAssets: ["usdcx"],
    allowedRecipients: [payTo],
    allowedOrigins: ["https://api.nayori.ai"],
    allowedMerchantIds: ["merchant-research"],
    maxPerTransaction: { usdcx: 100_000n },
    maxPerSession: { usdcx: 500_000n },
    maxFeePerTransaction: 500n,
    maxFeePerSession: 2_500n,
  },
  () => now
);
const authorization = policy.reserve(intent);
const unsignedTransaction = await buildNayoriMppUnsignedPaymentTransaction(intent);
const parsedChallenge = decodeNayoriMppChallengeHeader(challenge.wwwAuthenticate);
const paymentRequest = decodeNayoriMppUsdcStacksRequest(parsedChallenge.request);

console.log(
  JSON.stringify(
    {
      status: "ready-for-wallet-signature",
      protocol: "MPP PaymentAuth",
      challengeHeader: parsedChallenge.header,
      method: parsedChallenge.method,
      intent: parsedChallenge.intent,
      profile: paymentRequest.methodDetails.type,
      network: paymentRequest.methodDetails.stacks.network,
      currency: paymentRequest.currency,
      amount: paymentRequest.amount,
      unsignedTransactionBytes: unsignedTransaction.length / 2,
      policyRemaining: authorization.remainingThisSession.toString(),
      walletBroadcast: false,
      serverSettlementRequired: true,
    },
    null,
    2
  )
);

authorization.release();
