# 0.9.0 — mainnet earned-fee defaults

`0.9.0` is the source release candidate that promotes new Nayori mainnet clients to
`agentic-commerce-v6` for STX and `sbtc-commerce-v5` for sBTC. It does not change the generic
testnet v5/v4 defaults or the QA adapter's explicit v6/v5 contracts. The agent registry,
reputation registry and canonical PoX-5 sBTC token remain unchanged.

This source record does **not** claim that npm 0.9.0 is already published or that a contract
deployment is complete. Activate or publish the release only after the mainnet postflight verifies
the exact immutable sources and configuration. npm 0.8.0 remains the current public stable line
until that separate gate completes.

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

After merge, contract postflight and approval, install the exact registry artifact with:

```sh
npm install --save-exact --ignore-scripts @perkos/agent-sdk@0.9.0
```

Before moving `latest`, run the full Node 20/22 verification matrix, inspect
`npm pack --dry-run --json`, install the exact tarball in an empty consumer, then repeat the clean
consumer check from the published package and verify registry integrity. Never overwrite or
republish 0.8.0. QA merge, mainnet contract deployment, npm publication and production consumer
rollout remain separate events.
