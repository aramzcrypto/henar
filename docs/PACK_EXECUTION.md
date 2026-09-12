# Pack delivery through Jupiter

Normal flow: owner signs Unpack → ORAO resolves the selected stock → worker obtains a Jupiter route → `swap_pack` invokes the pinned Jupiter program, spends pack escrow, and delivers directly to the owner → confirmed `Settled` receipt drives the visual reveal. The interface does not show a normal pack's selected company while delivery is pending. Selection and transactions remain public onchain.

Lucky flow: owner signs Unpack → allocation resolves into `LuckyReady` → owner explicitly Banks or Rolls Over. Only Bank changes the pack to `Selected` and authorizes stock execution. A rollover requests fresh randomness and never purchases a stock prematurely. Earned packs remain Random, without a pack-opening protocol fee.

## Trust and enforced constraints

`PackExecution` is a canonical PDA configured by the admin. It identifies the quote-service signer, an enable flag, and a maximum USDC budget (setup defaults to 40 USDC, sufficient for two Lucky rounds). Only that signer can call `swap_pack`. Admins can rotate or disable it.

The quote service is trusted for market-price quality. An authorized service could supply a poor quote; onchain slippage checks are relative to its quote, not an independent fair-value oracle. Do not describe this as oracle-equivalent or trustless price verification.

The contract independently enforces:
- selected manifest stock and owner recipient;
- exact allocation spent from the canonical pack USDC account, excluding the separately collected pack fee;
- positive net stock balance increase at least the signed minimum, with all positive price improvement passed to the owner;
- minimum no lower than the pack's slippage tolerance against the quoted output (maximum 1%);
- quote no more than 30 seconds old, not future-dated, and pack not expired;
- configured authority, per-pack budget cap, enabled execution, and unpaused protocol;
- the fixed executable Jupiter router and only the pack PDA's signing privilege inside the CPI;
- one settlement per pack, atomic swap/delivery/fee/receipt. Failed checks roll back every movement in that transaction.

The worker calls Jupiter V2 `/build`, verifies mints, allocation, slippage, minimum, recipient, pack authority, and a 1% price-impact ceiling. It permits only validated idempotent ATA setup, rejects unrelated/cleanup instructions, uses live route lookup tables, and simulates the complete transaction before broadcasting. The price-impact check is offchain quote-service policy, not an independent oracle. Unsupported routes remain pending rather than silently widening tolerances or changing the stock.

## Recovery

A retry fetches a fresh quote for the same stock. It never redraws the stock. Failed transactions leave USDC in escrow. After the pack's timeout, existing owner refund paths recover normal pack funds or the eligible Lucky allocation. Lucky's initial opening fee remains nonrefundable and fulfilled randomness cannot be discarded through an unfulfilled-request refund. Pending signatures are reconciled before another transaction is sent.

`Keep` acknowledges receipt; stocks are already in the user's wallet and need no additional claim transaction. `Trade` opens the delivered stock's trade ticket. The displayed USDC value is actual allocation spent, not a guaranteed future resale value.

## Setup

1. Deploy the checked program paused, initialize/seal the manifest, and configure the protocol lookup table.
2. On the persistent worker, set RPC, Jupiter key, `SOLVER_KEYPAIR_PATH` and `SOLVER_MAX_SETTLEMENT_USDC_BASE_UNITS`. Fund its SOL fees/rent; pack swaps do not require worker USDC inventory.
3. `npm run packs:execution -- enable` prints a plan. `--execute` installs the authority/cap. `disable --execute` stops this execution path. These commands do not unpause the protocol or fund/enable Lucky.
4. Run the worker and bounded funded mainnet verification before public activation. Configure and fund Lucky separately.

No Pyth key is required for this pack path. Existing oracle-verified settlement remains available separately, and position stock fills retain their Pyth checks. `SOLVER_EXECUTE_POSITIONS` defaults off until those paths are verified.

## Evidence and limits

- Exact arithmetic and quote-validation tests reject incorrect amounts, programs, extra signers, recipients, slippage, platform fees and excessive impact.
- Solana runtime fixture uses real SPL transfers to test rollback after overspend, underspend, insufficient delivery; stale/future quotes; unauthorized signer; wrong recipient/router; disabled/capped execution; successful delivery and replay rejection.
- `npm run packs:snapshot` captures an actual mainnet Jupiter BABA route and its deployed Jupiter, DEX and Token-2022 binaries. It never broadcasts. Run:
  `SBF_OUT_DIR="$PWD/target/deploy" cargo test -p stockroom --test runtime deployed_jupiter_pack_swap_delivers_stock_without_pyth -- --ignored --nocapture`
  This test passed locally: 9.80 USDC swapped, 0.20 USDC fee collected, actual output matched the recorded wallet receipt, no Pyth accounts. The test supplies synthetic user/config/escrow accounts and a local lookup table; market state and route binaries are captured from mainnet.
- No funded mainnet end-to-end pack transaction or independent audit has passed. A single route snapshot does not prove every stock, liquidity condition, issuer permission or route will work.
