# Restricted mainnet deployment — 13 September 2026

> Pilot access update, 13 September 2026: at the user's request, the allowed wallet was changed to `EYVq1MrwT5mfsh8kJLw645ARKK3uP4ja3UcTzb8ULcff` and Earn was unpaused. The 25 USDC cumulative cap remains, with 1 USDC already admitted. Production API verified `walletAllowed: true`, `paused: false`, and product mask 1. Access transaction: `481N2RC1CRhGGDM6KsVKTqZNiLiQyADdQtv9YamK2NS7pxUY6RSiNw6BY2WGc7et7u9TPZcjxex5rj8XxdgJfv44`. Unpause transaction: `2uRkAdybB2rDj3XE2J3NxQzzoqEPEsBUZ2L8e6YDd4D1BaKYwKEfvBAn2ej2FZJCmW1i3k4ExXuYLuPgBskCj6tm`. The record below describes the earlier deployment and completed admin-wallet test.

The reviewed program is deployed and initialized on Solana mainnet. Upgrade authority is retained. A real Earn deposit and full withdrawal were verified. **The contract is paused; public deposits and other products are not activated.**

## Deployed artifact and authority

- Program: [`7EMrgJNodNBmuQBg3cv9ASDUmXQFYp1VRiHcCzUMaC7E`](https://explorer.solana.com/address/7EMrgJNodNBmuQBg3cv9ASDUmXQFYp1VRiHcCzUMaC7E).
- ProgramData: `9u8KdEhJyg8MCeQhJEzKRCqeBXtTEhewqqKZpbeyFVtZ`.
- Upgrade/configuration authority: `ACbdckvGrWj6Qifeq99daEeYz4WzVk5u2uUgK6crNkwx`.
- Deployment slot: `446543768`.
- [Deployment transaction](https://explorer.solana.com/tx/3xSbWRUJYDmJPfdqRwQA9aCcocj9TvvTp9oeT8X4ehZy1Ph9z8Mn1e63zbNKuaY9SGRbAsHwpkjAv7ASDGYqY9JP).
- Executable: 931,544 bytes; SHA-256 `f62a3701210f0548c2cf39639fb4acfc999833f0b214706efd5b3003d6c2171e`.

The on-chain bytes were compared directly to the reviewed artifact. The loader, ProgramData account and retained upgrade authority were verified. An upgrade was not performed as part of this first deployment.

The initial bulk uploader exhausted retries. Confirmed buffer writes were reconciled, missing bytes were uploaded at a controlled rate, and the complete buffer was compared byte-for-byte before deployment. The same funded buffer was reused. Private keys stayed local.

## Final access policy

| Setting | On-chain value |
| --- | --- |
| Global pause | Enabled |
| Selected product | Earn only, mask 1 |
| Pilot wallet | Admin address above |
| Cumulative admission cap | 25 USDC |
| Already admitted | 1 USDC |
| Limit, DCA, stock-yield, Packs, Lucky | Disabled |
| Protocol yield share | 10% |
| Purchased-pack fee | 2% |

The cap is cumulative external admission, not TVL; withdrawing the test deposit did not reset it. Unpausing under this policy would still restrict admission to the pilot wallet and Earn. Keep the policy unchanged until the next scoped test is planned.

The sealed 39-stock manifest was initialized. The protocol lookup table is `GSym23RCknAT3pNUXTMic3n2o6ViLHy5QuZrFbtbAMQB`; its public address was added to local and Vercel production configuration.

## Funded Earn test

1. Temporarily unpaused with the restricted policy.
2. [Deposited 1 USDC](https://explorer.solana.com/tx/3VUChzbUpNQPB5aYaUm9Jk9PXLR8JyWCaMsor9BA7UJBUansT9MhgKwiGENHR2F2fjyFqxFFE6tYZdd2TcLKTy2e).
3. [Paused the contract](https://explorer.solana.com/tx/3RH3XgNwAePH4QcmGZSyjeVh2rjGjMqXTTDd9Yk4kPwuxqu8qYbap1ACtTYVN5KK8cq7VjKNJo8kCpqfyfYjfWxG).
4. A simulation requesting exactly the original 1 USDC failed with insufficient available principal (6007). No failed withdrawal was broadcast: original deposit basis can exceed redeemable principal after vault costs and rounding.
5. [Withdrew all available principal while paused](https://explorer.solana.com/tx/23d4rhP2TQZNTYhGp5Ft3vg7wcvF6jryAdGmRYLrtX4d8pPomwvv5brojRfSrG9C9PG7GzFVkyKuK98ymnx53bPF), using the contract's existing full-withdrawal instruction option.

| Measurement | USDC |
| --- | ---: |
| Wallet before deposit | 27.500000 |
| Wallet after deposit | 26.500000 |
| Returned from full withdrawal | 0.998993 |
| Wallet after withdrawal | 27.498993 |
| Measured round-trip difference | 0.001007 |

Position `aRXFjRetDvSACP4PKMXuF4XAmf6aTZEu1QrBrEwQo4P` ended with zero principal basis, zero shares and zero claimable yield. No test principal remains invested. The measured difference is not represented as protocol revenue; the test does not separately attribute every venue cost and rounding component.

The UI now offers **Withdraw all principal**, with an explicit full-withdrawal description in the transaction preview. Partial withdrawals retain their exact-amount behavior. No contract upgrade was needed for this control.

## Website verification

The withdrawal control and lookup-table configuration were published to [henarapp.vercel.app](https://henarapp.vercel.app), production deployment `dpl_5QaD55UkKvQZ2FitxK72rMBgyPJj`. The production API returned HTTP 200 and read the actual paused policy, 25 USDC cap, 1 USDC admission counter and zero remaining principal/shares from mainnet. Deposit and withdrawal amounts above were also checked against each transaction's token-balance changes, not only aggregate wallet snapshots.

## Costs and remaining checks

Persistent program rent is **4.73395548 SOL**. At the final balance observation, the admin held **3.569139008 SOL** and **27.498993 USDC**. The difference beyond program rent includes initialization/lookup/position account funding and network fees; it must not all be labeled transaction fees. First deployment reused buffer funding. Later upgrades require temporary buffer funding in addition to the existing program rent.

Latest application validation: 64 tests passed, type checking, lint and preview/production builds passed. Production mobile checks at 390 × 844 passed on Trade, Earn and Packs with no horizontal overflow or browser errors. The browser checks wait for visible page content; waiting for network idleness timed out on background Earn requests. Contract evidence remains the reviewed 12 math tests and 20 runtime/snapshot tests for the exact deployed hash.

Live preflight verified the deployed bytes, canonical programs, vault/share mint, manifest stock extensions, treasury and lookup table. Its full-product result remains nonzero because pack execution is intentionally unconfigured. Automated-position oracle coverage was not checked in this Earn-only pilot. This is not a full-product launch pass.

Remaining activation work includes funded pack/randomness/stock-delivery tests, a separately funded and monitored worker, position oracle coverage, and dedicated Lucky lifecycle review before enabling those products. Retain upgrade authority and test account-layout compatibility before future upgrades; updates cannot reverse completed transfers.

Local evidence: `.cache/mainnet-release/` contains the immutable executable copy, source archive, deployment verification JSON, upload receipts, configuration logs, Earn pilot receipts and verification logs. This directory is not uploaded to the public repository or Vercel.
