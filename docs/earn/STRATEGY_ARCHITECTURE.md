# Henar Earn — strategy architecture

Status: **experimental, team-funded, public deposits disabled.** Nothing in
this document describes a product that accepts public capital.

Three strategies, built on real protocol mechanics:

| Strategy | Deposit | Return comes from | Protocol |
| --- | --- | --- | --- |
| Earn Stocks | USDC | Lending interest, converted to stock | Kamino |
| Smart Accumulate | USDC | Buying the stock lower, not yield | Meteora DLMM limit orders |
| Range Yield | Stock + USDC | Swap fees while liquidity is in range | Meteora DLMM |

They answer different questions and must not be described interchangeably.
Trade's DCA is time-based and stays where it is; Smart Accumulate is
price-based and lives in Earn.

---

## 1. Protocol findings

Read from the installed SDKs and the protocols' current documentation on
16 September 2026. Where a finding contradicts an assumption, the finding
wins and the design follows it.

### 1.1 Meteora: a one-sided LP position is not a limit order

This is the single most important finding, and it decides how Smart
Accumulate is built.

In a DLMM position, `liquidity_shares` is a pro-rata claim on **whatever a
bin currently holds**, not on the token that was deposited. Deposit USDC
into bins below the active price, let price fall through them, and the bins
now hold stock. If price rises back through those bins, swappers take the
stock and leave USDC: the accumulated stock is **sold back**.

`StrategyParameters` carries `{maxBinId, minBinId, strategyType, singleSidedX}`.
`singleSidedX` chooses which token is deposited. **It does not stop the
reverse conversion, and no flag does.** A one-sided LP position marketed as
permanent accumulation would be a false promise.

`@meteora-ag/dlmm@1.9.14` ships a separate, program-level primitive that does
what the product needs:

    place_limit_order · cancel_limit_order · close_limit_order_if_empty

A limit order is its own account type with its own bin accounting
(`open_order_amount`, `fulfilled_order_amount_x/y`, `order_age`). Fills are
recorded by a monotonically increasing `order_age` counter: once a bin's age
passes the order's recorded age, the order is `Fulfilled` permanently.
Proceeds sit in `fulfilled_order_amount_*` as the output token until the
owner settles them. **Price reversing does nothing.** That is the
non-replenishing guarantee, and Smart Accumulate uses it.

Constraints that follow:

- **Pool eligibility.** A pool is either limit-order mode or liquidity-mining
  mode, never both. `isSupportLimitOrder(lbPair)` must pass. A pool that has
  ever had a reward mint set is permanently excluded.
- **50 bins per order account** (`MAX_BIN_PER_LIMIT_ORDER`), which caps a
  ladder's resolution.
- **No operator delegation at all.** `cancel_limit_order` and
  `close_limit_order_if_empty` require `owner [SIGNER]`. A keeper can *place*
  an order for an owner (`place_limit_order` separates a non-signing `owner`
  from a signing `sender`) but **can never settle or cancel one**. Settlement
  is an owner action, so Henar's runner proposes it and a human signs.
- Limit-order fees (`LIMIT_ORDER_FEE_SHARE`, 50%) settle together with
  principal on cancel. There is no separate claim.

Verified live for the candidate pools — all six support limit orders:

| Pool | binStep | Active price | Limit orders |
| --- | --- | --- | --- |
| NVDAx/USDC `F4inHs4R…` | 25 | $214.16 | supported |
| QQQx/USDC `eV4ogmq1…` | 20 | $667.32 | supported |
| SPYx/USDC `9AbQxo8j…` | 20 | $762.91 | supported |
| MSFTx/USDC `6wqFAm78…` | 25 | $498.03 | supported |
| HOODx/USDC `AiKXdE3v…` | 50 | $111.04 | supported |

### 1.2 Meteora: LP position authority

For Range Yield, a position created with `initializePositionByOperator`
carries three roles, verified against the SDK and IDL:

| Role | Can do |
| --- | --- |
| `owner` | Everything. Receives **all** withdrawn principal. |
| `operator` | Add and remove liquidity after `lock_release_point`. **Withdrawn principal is force-routed to the owner's token accounts** — the operator cannot send it to itself. No path in the SDK lets an operator close a position. |
| `feeOwner` | Receives claimed swap fees. |

`enablePositionPermissionlessClaimFee` lets the owner set a bit after which
**anyone** may sign a fee claim, with proceeds still going to `feeOwner`.
That is the right shape for an unprivileged keeper: it can harvest fees and
it can never touch principal.

Two SDK defects to work around in `initializePositionByOperator`:

1. `positionWidth` is accepted and then ignored — a constant 70 is passed.
   Since width is a PDA seed, any other width produces a different address
   and the transaction fails.
2. `ownerTokenX` is derived with the **token Y** program. On a mixed
   SPL-Token / Token-2022 pair — which every xStocks pair is — this derives
   the wrong account. Derive it independently.

### 1.3 Meteora: bin math

`price_per_lamport = (1 + binStep/10000) ^ binId`, and
`binId = log(price) / log(1 + binStep/10000)`.

Both operate on **price per lamport**, not on a UI price.
`getBinIdFromPrice` does **not** convert for you. With NVDAx at 8 decimals
against USDC at 6, the exponent is `6 − 8 = −2`, so prices per lamport are
sub-1 and bin ids are small. Every UI price goes through
`toPricePerLamport` first.

Position amounts are raw base units. For a Token-2022 mint with a transfer
fee, the `*ExcludeTransferFee` fields are what actually reaches a wallet, and
those are the figures the UI shows.

### 1.4 Kamino: supply accounting

Supplying USDC mints **collateral tokens** (cTokens). The cToken balance
stays constant; the exchange rate moves. `getCollateralExchangeRate()`
returns `cTokenSupply / liquiditySupply`, an unscaled ratio starting at 1 and
**decreasing** as interest accrues, so `liquidity = cTokens / rate`. The
SDK's own comment claiming a 1e18 scale is stale.

**klend carries no per-position cost basis.** There is no on-chain
"interest earned" counter for a lending obligation. Realized yield is
therefore computed from a basis Henar records itself:

    yield = cTokens / rateNow  −  cTokens / rateAtDeposit

`currentValue − principalDeposited` is only correct for a single deposit with
no withdrawals, measured in USDC rather than USD. Henar records
`(cTokenAmount, exchangeRateAtDeposit)` at deposit and re-baselines on every
harvest, so the accounting stays correct across multiple harvests.

Other findings:

- **MAIN market** `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF`, **USDC
  reserve** `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`. The market holds
  four reserves whose liquidity mint is USDC; three are dust. The reserve is
  pinned by address, never looked up by mint.
- `supplyApy` from the metrics endpoint is a **fraction**, so the existing
  `× 100` in Henar is right.
- **No operator or delegate exists in klend.** Only the obligation owner can
  withdraw, and a supply-only position carries no debt, so it cannot be
  liquidated.
- No deposit fee, no withdrawal fee, no lockup. The real constraints are
  reserve liquidity at high utilization and a per-interval withdrawal cap.
- A Kamino **vault** is a different program with a curator who reallocates
  across reserves and charges fees. Earn Stocks uses the lending reserve
  directly, which is the smaller trust surface. Henar's existing on-chain
  Earn product uses the vault program and is untouched by this work.

### 1.5 Auto Compound LP: not built

DAMM v2 supports `CollectFeeMode.Compounding`, but it is chosen at **pool
creation** and applies to every position in that pool. No existing stock pool
is configured that way, and creating one to fill a fourth card would be
manufacturing a strategy. It is out of scope.

---

## 2. Authority and custody

    OWNER     Henar demo wallet. Holds the capital. Only it can withdraw.
    OPERATOR  Henar strategy operator. May manage; may never receive principal.
    KEEPER    Unprivileged. May claim fees where the owner has enabled it.

No strategy in this version holds anyone's capital but Henar's. The runner
proposes actions; anything that moves funds needs an authorized signer, and
mainnet execution additionally needs `HENAR_STRATEGY_MAINNET_ACTIONS=1`.

Because limit orders admit no operator, Smart Accumulate settlement is an
**owner-signed** action by construction. The runner surfaces it as a
proposal; it cannot execute it.

Keys live in the server or worker environment, never in the repository, the
frontend bundle, or Vercel's client-visible configuration.

---

## 3. Public deposits

Public deposits are **not implemented** for these strategies. There is no
deposit endpoint, no deposit instruction, and no disabled deposit control in
the UI. Strategy pages offer "View strategy".

Henar's pre-existing on-chain Earn product (`/earn/usdc-stocks`, the Anchor
program over a Kamino vault) is unchanged by this work and keeps its own
admission rules and caps.

Before public capital could be considered, all of the following are required,
and none is done:

1. External audit of any Henar program that would custody strategy capital.
2. A review of the operator authority matrix by someone other than its author.
3. A funded period long enough to measure real strategy behaviour.
4. Withdrawal mechanics, including behaviour when a reserve is at its
   withdrawal cap or a DLMM position is out of range.
5. A legal review of how each strategy is described.

---

## 4. Fees

Zero, and inactive. The architecture supports a future performance fee on
**realized** yield or **realized** LP fees only:

- no deposit fee, no withdrawal fee, ever;
- never assessed against principal;
- never assessed against unrealized appreciation;
- never assessed against stock accumulated from principal.

`FeeModel.active` is false everywhere, and the accounting path that would
apply a fee is exercised by tests so that switching it on later is a
configuration change rather than new code.

---

## 5. Safety

Every automated action passes the same gate before it can execute: the
strategy is enabled and not paused, the operator is authorized, the market is
in the verified registry, state is fresh, a route exists, the Execution Guard
approves, the transaction simulates, the amount clears the dust floor and
sits under the per-action and daily caps.

A failure is recorded as `SKIPPED` with its reason. It is never retried
blindly.

Circuit breakers pause a strategy on: stale pool state, an unavailable
reference, extreme price deviation, protocol unavailability, unexpected
position ownership, an unsupported token extension, repeated simulation
failure, an unavailable route, excessive price impact, or an accounting
mismatch between Henar's ledger and the protocol's own numbers.

---

## 6. Reuse

Nothing here re-implements what Henar already has. Swaps go through the Henar
Router, which brings the Execution Guard, minimum-output protection,
simulation and protected submission with them. References come from the
existing Pyth Fair Value layer. Mint facts come from the router's verified
mint registry. The circuit breaker is the router's.
