# Earn, orders and Stock Packs

Implemented in `programs/stockroom`, `crates/stockroom-math`, `src/lib/protocol`, and `services/solver`. This describes code behavior, not evidence of a live deployment. See MAINNET.md for release limits.

## Custody and accounting

Each owner position has a PDA, USDC ATA and Kamino share ATA. Only fixed Kamino deposit/withdraw instructions can use its signer seeds. Tracked share and cash deltas exclude unsolicited donations. All monetary accounting uses checked integer base units; USDC has six decimals.

Realized gross yield is actual redeemed USDC above the tracked cost basis. A 10% configurable-at-initialization protocol share is snapshotted per position; a basis-point remainder carries across realizations so repeated small harvests do not evade fees. Net yield stays separate from principal. Redeployed fee reserves are tracked separately to avoid charging them as new yield. Permissionless harvesting requires sufficient actual yield, a cooldown and enough protocol fee reserve to protect principal from redeposit overhead. Vault losses retain a high-water cost basis; no synthetic positive yield is credited.

Owner withdrawal/cancellation redeems tracked shares, settles fees, and pays available principal and claimable net yield. There is no Stockroom cancellation penalty; venue costs and previously disclosed generated-yield fees may apply. Pausing new activity does not give the administrator custody of owner withdrawals.

Packs destination with Auto Packs allocates `claimable / 10_000_000` sealed entitlements, deducting exactly the allocated net yield and preserving the remainder. It never takes principal. Stocks destination settles claimable yield into the chosen manifest stock, with oracle-checked delivery. Auto Packs can be disabled and preferences can be saved independently of a new deposit.

Limit and DCA deposits accept only USDC. Limit execution cannot exceed the owner's price cap, including slippage. DCA enforces due times, remaining steps and expiry. Canceling requires the owner signer. The application displays actual positions instead of sample active orders.

## Purchased and earned packs

Purchased batches escrow `quantity × 10_000_000` USDC. Each pack reserves a 2% protocol fee (200,000 base units); settlement exchanges 9,800,000 base units for stock. Earned packs escrow 10,000,000 net-yield base units, pay zero additional protocol opening fee and use the full value for stock. Network, account-rent and ORAO request costs are disclosed separately.

Gift transfers move sealed value into a new recipient-owned batch with the original manifest/source/fee terms. Messages are bounded. Opening requires the current owner signature, decrements the sealed count, creates a unique pack PDA, and requests a fresh ORAO VRF seed bound to that pack and owner. A worker cannot secretly pick the stock or initiate opening for the owner.

Resolution verifies the ORAO program owner, seed, client and fulfillment. Deterministic rejection sampling maps verified randomness to equal manifest-stock odds. Manifest contents freeze at activation; administrators cannot rewrite the possible outcomes of an existing pack. Stock delivery and USDC settlement occur atomically. The program verifies the actual received token delta, so transfer fees cannot reduce the promised minimum. Token-2022 UI multipliers scale oracle units using exact integer representations.

Unopened sealed packs can be refunded. Pending/selected packs can be refunded after their configured timeout if not settled; ORAO/network costs already spent are not refunded. Replays and wrong-owner actions fail. Entitlements and receipts are program accounts, not NFTs.

## Current UI scope

Deposit/withdraw, preferences, Market/Limit/DCA preparation, multi-quantity pack purchases, gifting, individual opening, refunds, real receipts and Portfolio are wired to transaction preparation, review, wallet signing and confirmation. Bulk opening still uses individual explicit openings; a single-review open-all queue and the unzipped artwork transition are not completed. Historical portfolio USD valuation remains unavailable. These UI limitations do not fabricate onchain activity.
