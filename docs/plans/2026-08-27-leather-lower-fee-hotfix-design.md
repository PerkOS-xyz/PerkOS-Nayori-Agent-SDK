# Leather lower-fee x402 hotfix design

## Problem, evidence and selected boundary

The controlled Nayori testnet E2E built an unsigned STX transfer with origin nonce `0` and an
authorized fee of `3000` micro-STX. Leather preserved nonce `0`, the standard non-sponsored
authorization, payer, amount, recipient and request-bound memo, but signed the transaction with a
lower fee of `300` micro-STX. Local direct-payment verification passed every canonical payment
check. `NayoriX402PaymentClient` then rejected the result because it required the signed fee to be
exactly equal to the construction-time fee. The failure happened before settlement: the isolated
database contained quotes but zero settlements or broadcasts.

Requiring exact equality is incompatible with a wallet that safely reduces a proposed network
fee. Predicting Leather's final fee is brittle because wallet estimation can change with software
and network conditions. Accepting an arbitrary wallet-selected fee would weaken the agent policy.
The selected rule therefore treats `intent.fee` as the maximum fee authorized for this transaction:
the signed origin fee must be positive and less than or equal to that value. A wallet fee above the
intent remains a hard failure. Payer, nonce, amount, recipient, asset, memo, post-conditions and
non-sponsored authorization remain exact.

This is a patch-level compatibility fix. It does not change contracts, assets, settlement routes,
broadcast behavior, quote validation or production flags. `LeatherSigner` still requests
`broadcast: false`; the SDK still returns a settlement request only after independent local
verification. The public intent field stays named `fee` for API compatibility, while documentation
clarifies that it is the construction fee and upper bound when a signer returns a lower positive
fee.

## Accounting, errors, tests and release

The payment policy initially reserves the full authorized fee so concurrent signing requests
cannot exceed the per-transaction or per-session fee caps. After a signed transaction passes local
verification, the client commits the verified origin fee rather than the reservation amount. The
policy releases the full reservation and adds only the actual fee to `feeSpent`. This preserves
conservative concurrency control while reporting exact session usage. The authorization's
`commit` method gains an optional actual-fee argument; calling it without an argument preserves
the existing exact-fee behavior. An actual fee of zero or above the reservation is rejected and
the reservation remains releasable.

Client error handling distinguishes a fee-limit violation from other intent mismatches without
including transaction bytes. A signed fee above the authorized value produces `SIGNING_FAILED`
and safe details identifying `origin_fee_above_authorized`; nonce, payer or sponsored mismatches
continue to produce the generic intent-mismatch failure. No private key, raw unsigned/signed
transaction or reusable credential is added to errors, logs or documentation.

Regression coverage must prove: exact fees still work; a lower positive Leather/PolicySigner fee
is accepted; `verifiedPayment.originFee` and policy `feeSpent` equal the lower fee; a higher fee is
rejected and releases all reservations; zero actual fee is rejected; direct policy commits without
an override remain backward compatible; and an invalid actual-fee override cannot corrupt usage.
The complete typecheck, test suite, build, audit, package inspection and clean-consumer checks must
pass. Release as SDK `0.3.2`, publish only after owner review and merge, then pin the exact public
artifact in a separate Platform patch. Production remains quote-only throughout. The isolated E2E
is recreated or reset before the next controlled signature so final evidence starts with no stale
settlement state.
