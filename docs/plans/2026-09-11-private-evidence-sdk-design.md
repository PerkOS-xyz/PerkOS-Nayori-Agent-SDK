# Private evidence SDK/MCP design

Status: implementation candidate for QA review.

The provider sends bounded text or JSON bytes to the SDK. The SDK hashes the bytes, asks Nayori for
one short-lived direct-S3 POST, uploads without forwarding OAuth, completes the immutable version,
and returns the ordinary evidence manifest consumed by the existing commitment flow. The manifest
uses a stable Nayori HTTPS locator containing only the random evidence ID; it contains no signed URL.

Consumers and the evaluator exchange that locator for a fresh, at-most-60-second signed GET after
OAuth plus current on-chain role authorization. Downloads are size/hash checked again. MCP exposes
only inline bounded content and exact locators; it never accepts filesystem paths, private keys,
arbitrary API origins or signed URLs. `prepare` is never automatically replayed. A temporary 503 is
returned to the operator with bounded retry guidance; retries reauthenticate and reauthorize.

This requires no contract change. QA E2E must prove provider upload, provider and consumer read,
evaluator read, outsider rejection, commitment equality, decision, settlement, fee split and zero
escrow. Internal identities remain `internal-team-operated-not-m2-adoption`.
