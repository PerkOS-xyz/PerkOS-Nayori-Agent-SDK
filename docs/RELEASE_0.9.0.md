# 0.9.0 — mainnet earned-fee defaults

`0.9.0` is the stable release that promotes new Nayori mainnet clients to
`agentic-commerce-v6` for STX and `sbtc-commerce-v5` for sBTC. It does not change the generic
testnet v5/v4 defaults or the QA adapter's explicit v6/v5 contracts. The agent registry,
`reputation-registry-v3` and canonical PoX-5 sBTC token remain unchanged.

## Publication record

- npm `@perkos/agent-sdk@0.9.0` was published on 2026-09-13 and carries dist-tag `latest`.
  Dist-tag `next` remains the historical `0.8.0-rc.2` prerelease. Verify with
  `npm view @perkos/agent-sdk dist-tags` before an unqualified install.
- The README bundled inside the published 0.9.0 tarball predates this correction: it still
  describes 0.8.0 as the public npm line and 0.9.0 as an unpublished source candidate. Published
  bytes are immutable, so the npm-hosted README can only change through a docs-only `0.9.1`
  republish. That republish is a separate release step that has not been authorized; this record
  does not schedule it. The repository README is the current description.
- Historical wording (before 2026-09-13): this record stated that npm 0.9.0 was not yet published
  and that npm 0.8.0 remained the public stable line until the separate publication gate
  completed. That gate has completed; the [0.8.0 release record](RELEASE_0.8.0.md) stays immutable.

## Behavioral and economic migration

The mainnet default change is intentionally a pre-1.0 minor release. Funding v6/v5 locks the gross
budget. A successful evaluated settlement sends `floor(gross / 50)` (200 bps) to the job-pinned
treasury and the remaining 98% to the provider on approval or back to the client on rejection.
Expiry and review timeout without evaluation earn no fee. Appeal does not charge a second fee.

Both roles explicitly accept the live gross amount, 200 bps, treasury and net-after-evaluation
rejection terms before `fundJob` or `submitWork`. Direct `completeJob` and `rejectJob` are not the
v6/v5 settlement path; use `recordDecision`, optional appeal and the appropriate finalizer.

The escrow x402 requirement now binds the same four fee terms. The payer must configure
`acceptServiceFee` and return strictly `true` after reviewing both those terms and the exact parsed
requirement (asset, job, amount and contract) before the SDK can fund. The high-level client then
rechecks the job and treasury against live contract state before accessing the signer. Missing,
rejected or altered terms fail closed. Direct x402 transfers and MPP are separate and unchanged.

## Existing jobs and explicit overrides

Changing a default does not migrate an existing job. Use the original contract IDs when reading or
settling v5/v4 jobs:

```ts
const historical = new PerkOSClient({
  network: "mainnet",
  contracts: {
    stxCommerce:
      "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH.agentic-commerce-v5",
    sbtcCommerce:
      "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH.sbtc-commerce-v4",
  },
  signer,
});
```

Do not point an old job ID at v6/v5 or infer a job's generation from the installed SDK version.
Custom contract allowlists must also include the intended new principals before use.

## Distribution gate

Install the exact published registry artifact with:

```sh
npm install --save-exact --ignore-scripts @perkos/agent-sdk@0.9.0
```

The gate that preceded the `latest` move on 2026-09-13: run the full Node 20/22 verification
matrix, inspect `npm pack --dry-run --json`, install the exact tarball in an empty consumer, then
repeat the clean consumer check from the published package and verify registry integrity. Never
overwrite or republish 0.8.0 or 0.9.0. QA merge, mainnet contract deployment, npm publication and
production consumer rollout remain separate events.
