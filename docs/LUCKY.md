# Lucky Stock Packs — V1

Status: implemented, disabled until explicitly initialized, funded, reviewed and enabled onchain. Not deployed or validated with live user funds. Random is the default.

## User flow

Purchases create the existing $10 refundable sealed pack entitlements. Mode is chosen at opening, not irreversibly at purchase; no Lucky payout or rollover availability is promised by buying a sealed pack. Gifts transfer only sealed packs. Earned packs retain Random opening and their full $10 stock budget.

Random: existing verifiable stock selection; post-fee allocation buys the stock automatically after opening.

Lucky: owner explicitly opens a purchased pack with fixed V1 odds. It charges the batch's previously disclosed pack fee once (2% for current configuration), non-refundable after opening. A $10 pack risks $9.80. Fees are never charged again on Bank or Roll Over. Network, ORAO and execution costs remain separate. Owner sees the selected company and resolved USDC allocation; stock has NOT been bought yet. Bank authorizes stock purchase. Roll Over risks that allocation with independent fresh randomness and the same odds, retaining the selected stock. Only one rollover is permitted. On the second result, Bank is the only continuation.

| Post-fee multiplier | Probability |
| --- | ---: |
| 0.25x | 4% |
| 0.5x | 20% |
| 1x | 64% |
| 1.5x | 8% |
| 2x | 4% |

Theoretical return per roll: 95% of the post-fee allocation, before execution costs. For a $10 purchased pack at 2% fee, average first-roll stock budget is $9.31; expected reserve growth $0.49, protocol fee $0.20. These are expectations, not individual or aggregate guarantees. Multipliers use the post-fee allocation; repeated rolls can produce less than 25% of the original purchase. Integer rounding below one micro-USDC remains in reserve.

## Custody and state transitions

- `LuckyPool` is a separate program-derived authority with its own USDC ATA. It has an independent enable flag (initially false) and maximum stake (initially 20 USDC). No Earn or order account can fund it.
- Every first opening moves one net stake from the reserve to the pack ATA. Combined with the user's net stake, that physically escrows the maximum 2x payout before the transaction succeeds. Fee transfer, request and escrow debit are atomic.
- Every rollover similarly tops up the current allocation with an equal reserve allocation before requesting fresh randomness. Reserve insufficiency rejects the entire transaction. The prior Bank option survives a failed rollover.
- Reserved liabilities are held in pack ATAs, not in the reserve ATA. Admin withdrawals can only withdraw unallocated pool cash to the configured treasury.
- Resolution is permissionless and uses canonical ORAO account owner/PDA/seed/client checks. Stock and payout selection use separate hash domains and rejection sampling. No user-supplied result or odds are accepted.
- `Pending -> LuckyReady -> Selected -> Settled`. First `LuckyReady` optionally becomes a second `Pending`. Ordinary Random resolve/refund paths reject Lucky accounts. Worker does not settle `LuckyReady`; explicit owner Bank is required.
- Unused maximum-payout escrow returns to the pool at resolution. The resolved reward remains in its pack ATA while awaiting the owner, including during a pause. Banking and eligible timeout recovery remain available while paused. Direct Jupiter delivery waits until execution is enabled and the protocol is unpaused.
- Unfulfilled randomness after the configured timeout may refund the current stake, returning the top-up to the pool. Initial pack fee is not refunded. A fulfilled request must resolve even after timeout and cannot be refunded as an unfulfilled request. A previously resolved reward cannot be reset to its original purchase value.
- Bank starts a fresh settlement deadline. If stock delivery fails until expiry, the owner can recover the resolved USDC budget. The worker obtains a bounded Jupiter quote and the contract swaps pack escrow directly to the owner. No solver reimbursement or Pyth feed is required for this pack path. Quote or route failure cannot justify a reduced allocation or discretionary reroll. See PACK_EXECUTION.md for the explicit quote-service trust model.
- Existing program ID has not been deployed. Pack account layout adds fields; deploying these bytes over a preexisting layout would require migration, not a blind upgrade.

## Verification

`npm run contracts:build` builds the SBF binary, rejects stack errors, regenerates IDL/client types, and runs arithmetic plus runtime tests. `npm test` includes fixed table, bounds, reserve capacity and request parsing coverage.

New runtime cases cover escrow conservation, VRF client binding, denied ordinary-path bypass, permissionless resolution, duplicate rejection, owner-only Bank, Bank while paused, insufficient delivery rollback, no repeat fee, timeout recovery, and refusal to erase fulfilled outcomes after expiry.

The local snapshot test `deployed_orao_lucky_reserves_before_open_and_allows_only_one_rollover` executes the snapshotted ORAO mainnet binary to create actual local requests. It rejects a reserve short by one micro-USDC, disabled opening and duplicate actions, validates exact balances/fees and bounds rollover count. Fulfillments are explicit local fixtures: this is not live oracle fulfillment or mainnet execution evidence.

Run with `.cache/mainnet-snapshot/accounts.json` present:

```sh
SBF_OUT_DIR="$PWD/target/deploy" cargo test -p stockroom --test runtime deployed_orao_lucky -- --ignored --test-threads=1
```

`npm run lucky:simulate` runs synthetic seeded scenarios, never production outcome selection. In 200 runs of 1,000 attempts at $10 each, up to 20 concurrent first rolls, a $100 reserve rejected openings in all runs. With the revised 4/20/64/8/4 odds, a $1,000 reserve had no opening or rollover rejections and no runs ended below starting capital in these sampled scenarios. One of 200 $100 bank-only runs ended below starting capital. This is not proof of capital adequacy. Operating costs, malicious oracle behavior, correlated participation, and real execution failures are outside that simulation. Mathematical safety comes from escrow checks, not the simulation's average result.

## Operations and launch gates

All `lucky:pool` commands plan by default; `--execute` is required to mutate mainnet. Uses the local admin key only, never Vercel.

```sh
npm run lucky:pool -- status
npm run lucky:pool -- initialize
npm run lucky:pool -- fund --amount=1000
npm run lucky:pool -- enable --max-stake=20
npm run lucky:pool -- disable
npm run lucky:pool -- withdraw --amount=100
```

Funding amount above is an example, not an approved transfer. Rollover is conditional on reserve and maximum stake, clearly shown before first opening. Do not silently alter fixed odds according to pool balance. Lowering caps or pausing cannot confiscate an existing allocation.

Before activation: deploy/verify program, initialize regular protocol and manifest, configure the pack quote authority, set up worker/lookup tables, initialize Lucky disabled, fund explicitly, complete funded smoke tests, and review contracts and jurisdiction-specific gambling requirements. Paid optional Lucky remains chance-based financial wagering; a toggle does not remove those requirements. Keep Lucky disabled independently while enabling verified Random/Earn features if desired.

Required funded smoke sequence: buy/refund sealed; buy/open Random/deliver; Lucky open/fulfill/Bank/deliver; Lucky open/fulfill/roll/fulfill/Bank/deliver; insufficient reserve rollback; disable with outstanding reward then Bank; unfulfilled timeout recovery; failed-delivery timeout recovery; verify receipts and treasury/pool/pack balances. Never manufacture APY, yield, fulfillment, or delivered holdings for the demo.
