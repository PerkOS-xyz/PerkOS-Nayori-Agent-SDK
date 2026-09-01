# Full-functional SDK and documentation gate

## Goal

Make the public Nayori onboarding path reproducible before inviting developers, without treating
external adoption, external transactions, or an external contract audit as part of this internal
technical gate.

## Acceptance criteria

- The npm package remains installable from the public registry.
- Every signer-free quickstart exits successfully without requesting a wallet or broadcasting.
- The facilitator example uses immutable public mainnet evidence that matches the active contract,
  asset, amount, payer, job and block metadata before demonstrating fail-closed expiry.
- Documentation identifies version 0.6.0 as the published release and does not call it a release
  candidate.
- Unit tests, typecheck, build and dependency audit remain green.

## Safety boundary

The checks in this gate are read-only or offline. They must not publish npm packages, sign or
broadcast a transaction, change production configuration, or count internal actors as M2 adoption.
