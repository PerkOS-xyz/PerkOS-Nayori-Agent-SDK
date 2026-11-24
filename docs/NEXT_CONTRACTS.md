# Next contract generation

The SDK supports the next Nayori contracts beside the current generation
(`sbtc-commerce-v5`, `agentic-commerce-v6`, `reputation-registry-v3`, `agent-registry`). Jobs on
the current contracts keep working through `PerkOSClient`; the next generation has its own
`NayoriNextClient` and `NayoriNextTransactionBuilder`.

**Status: live** on mainnet and testnet since 2026-11-24 (Clarity 6). The defaults point at the
live deployments (`NAYORI_NEXT_DEPLOYERS`), so no deployer needs to be configured:

| Network | Deployer | Treasury | Appeal authority |
|---|---|---|---|
| mainnet | `SP2BM4WCNQM286PFHPGA1BG2YXER0PCG1PKQ5MF1X` | `SMFE58EKCK5ZPD7YCYM1CQY7K3H8SEXQH7C3YT8S` (multisig) | `SM3950RVR364J25ZRFFNHB5TCNJ7VKPKKGD4N2RP9` (multisig) |
| testnet | `ST3MRPNX0VNWYRSJ07PNTASE5BZ9K5XE57ARZ39DY` | `STHV38DZX23VB42EX9PE44S3WCC20DNC3V62T4N3` | `ST12SP3EXFGP6GNK0WJ9GKJ2NSHE9243MHG4JBHPS` |

```ts
import { NayoriNextClient } from "@perkos/agent-sdk";

const nayori = new NayoriNextClient({
  network: "mainnet",
  signer,
  spendingPolicy: { maxPerTransaction: { sbtc: 100_000n }, maxPerSession: { sbtc: 500_000n } },
});
```

Pass `deployer` only to target another deployment, for example a local devnet.

## What changes

- **No token argument.** The sBTC escrow and the applications contract call canonical sBTC
  internally (`SM3VDX...sbtc-token` on mainnet, `SN3VMH...sbtc-token` on testnet). The SDK only
  uses the token id in post-conditions.
- **Budget at creation.** `create-job` takes the evaluator, budget, delivery and review windows
  and the description; there is no `set-budget`. Bounds: sBTC 1,000 to 100,000,000 sats, STX
  1,000,000 to 100,000,000,000 micro-STX, delivery 144 to 4,320 and review 12 to 1,008 Bitcoin
  blocks. Builders reject out-of-range input with `details.clarityCode` set to the contract error.
- **Lifecycle.** `fundJob`, `nameProvider`, `acceptJob`, `submitWork`, `recordDecision`,
  `recordDefaultApproval`, `appeal`, `resolveAppeal`, `settleJob`, `refundNoDelivery`,
  `closeUnfunded`, `rateProvider` (client only, score 1 to 5) and `retryReputation`. Statuses run
  from 0 `open` to 10 `expired` (`NAYORI_NEXT_JOB_STATUS`).
- **Parties are the signer.** Calls through another contract need an allowance:
  `allowContractCaller({ caller, target, until })`, sent directly by the party.
- **Reputation is raw data.** `getProviderStats` returns completed, rejected, not-delivered,
  settled value per asset, distinct clients and the rating sum and count.
- **Agents and applications.** `registerAgent({ name, uri })` registers the signing wallet;
  `applyToJob` (sBTC jobs, deposit 100 to 1,000,000 sats), `withdrawApplication`,
  `declineApplication` and `releaseApplication`.

## Post-conditions (deny mode)

| Call | Post-conditions |
|---|---|
| `fund-job` | client sends exactly the budget |
| `resolve-appeal`, `settle-job`, `refund-no-delivery` | escrow contract sends exactly the budget |
| `apply-to-job` | applicant sends exactly the deposit; applications contract sends at most the deposit (refund of a displaced lower entry) |
| `withdraw`, `decline`, `release` | applications contract sends exactly the recorded deposit |
| all other calls | none (no funds move) |

`NayoriNextClient` reads the live job or application before these calls, so the amounts match
what the contract will move.
