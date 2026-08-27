# x402 initial nonce hotfix design

## Problem and boundary

The isolated Nayori testnet E2E connected a newly funded Leather account whose canonical Stacks
account nonce is `0`. SDK 0.3.0 rejected the payment intent before wallet signing because
`createNayoriX402PaymentIntent` parsed the nonce with the shared positive-integer default. A
Stacks nonce is an unsigned sequence number, so zero is valid for the first transaction. The
failed attempt issued one short-lived quote but created no settlement and performed no broadcast.

The fix is deliberately local to x402 payment-intent nonce parsing. Amounts, transaction fees,
asset limits, identifiers and every other positive-only field retain their current validation.
Contracts, transaction construction, signing, verification, settlement and custody boundaries do
not change.

## Selected change

Parse `input.nonce` with the existing `toUint` zero-allowed mode while continuing to parse `fee`
as strictly positive. This preserves canonical decimal serialization and deterministic intent IDs
for both zero and later nonces. Negative values, unsafe numbers, fractional numbers and malformed
strings remain invalid.

Regression coverage must prove that a zero-nonce intent is accepted and serialized as `"0"`, and
that the complete STX payer flow builds, signs and independently verifies a transaction whose
origin nonce is `0n`. Existing mismatch, mutation, replay, policy and all-asset tests remain
unchanged. The package is released as patch version 0.3.1 because it restores valid protocol input
without adding an API or changing behavior for previously accepted values.

After CI and owner review, publish the exact merged artifact, verify npm integrity from a clean
consumer, and pin it in a separate Platform release. Production remains quote-only. The previous
temporary E2E database is discarded, and the controlled run starts again with a fresh merchant,
quote and database so its evidence contains one valid quote and one bounded broadcast attempt.
