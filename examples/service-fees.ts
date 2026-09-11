import {
  PerkOSClient,
  quoteServiceFee,
  type AmountLike,
  type PaymentAsset,
} from "../src/index.js";

/** Signer-free report. It neither grants consent nor broadcasts a transaction. */
export async function inspectEarnedServiceFee(
  client: PerkOSClient,
  asset: PaymentAsset,
  jobId: AmountLike
) {
  if (!client.supportsServiceFees(asset))
    return { kind: "no-service-fee-generation" as const };
  const job = await client.getJob(asset, jobId);
  if (!job) throw new Error("Job not found");
  const fees = await client.getJobServiceFee(asset, jobId);
  const quote = quoteServiceFee(job.budget);
  return {
    kind: "earned-service-fee" as const,
    asset,
    jobId: job.id.toString(),
    gross: quote.gross.toString(),
    potentialFee: quote.fee.toString(),
    netIfEvaluated: (fees.waiver ? quote.gross : quote.net).toString(),
    treasury: fees.treasury,
    chargedFee: (fees.settlement?.chargedFee ?? 0n).toString(),
    refundedFee: (fees.settlement?.refundedFee ?? 0n).toString(),
    refundOutstanding:
      !!fees.waiver &&
      !!fees.settlement &&
      fees.settlement.chargedFee > fees.settlement.refundedFee,
    gas: "Separate STX network fee",
  };
}
