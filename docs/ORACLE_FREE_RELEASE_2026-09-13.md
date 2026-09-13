# Pyth-free execution release candidate — 13 September 2026

Deployed executable: 836,528 bytes, SHA-256 `0eff264f28a2e10344ef48b269249b6d6b1b5ee274ab1b9e3defe47bb33e0bbd`. It is preserved in `.cache/oracle-free-release/stockroom.so` and was compared byte-for-byte with ProgramData after the upgrade.

## Deployment completed

- The contract was paused before the release: `2ym9Y3tABSqEsRuUnDpb7ZDfP7FBdpwLV4Y1c32XMocvxRcXnQfeow5aYE4y5BAPnJ5cSDWQ7XLJzMWhkTNBHDzp`.
- The temporary release buffer was initialized in `45ekEoSDj1nqi6skZ8hXRdjh6ERpqaqfwEkUd1SQUx6q3EgMEMNZXhyAWbTr6Ghp371K6efxPgtTJBahURYcjksE` and fully verified before use.
- The guarded upgrade was confirmed in `4s7YDY6Ku9rShxCuP9fDaV2AeXQ1aV5UwFKF8TkmhKXgDNKiZmPjgvHtrCvt46UQXJB6HUQdsp2fCMLWJFG9xdGN`. The temporary 4.250400440 SOL buffer rent was returned, deployed bytes matched the reviewed hash, and upgrade authority was retained.
- Restricted access was changed to mask 63 (Earn, Limit, DCA, stock yield, Packs and Lucky) in `3tWKugJXzJoeccztnvJUYM2EEgHPYSdxt2Zqgb36yQwiR1MVLGPARqVNcEbSSjAuHBgNtZHixBj3jbbCrWwYCxUE`.
- Pilot testing was unpaused in `2jP1sJADCy6VxjYg4QzDaUR9f2zxNqBG9gV8ExfTzf46jjTv6514HhSYrrNJCdZStmVQcHGdxQfaw7HFeiLfAk7r`.
- Access remains restricted to `EYVq1MrwT5mfsh8kJLw645ARKK3uP4ja3UcTzb8ULcff`. The cumulative admission cap remains 25 USDC; 21 USDC was admitted at final verification.
- The matching web release is live at `https://henarapp.vercel.app`. Live USDC-to-SOL, SOL-to-stock and stock-to-USDC quote probes all returned executable multi-source routes.
- The persistent worker restarted on this release and reported a fresh health record with two jobs and zero errors.
- Final application validation: 109 tests passed, along with lint, type checking, and a clean production build.

## Implemented

- A new `swapPosition` instruction redeems actual tracked Kamino shares, swaps directly from position escrow through the fixed Jupiter router, verifies exact USDC debit and net stock delivery, and atomically updates position accounting.
- Limit prices include the trading fee and are checked against actual delivered units, using conservative integer arithmetic for scaled token amounts.
- DCA enforces the schedule, preserves remaining principal during reinvestment, and refunds the exact unused quoted-input remainder to the owner.
- Earn-to-stocks spends only claimable yield. Principal and invested shares are unchanged.
- Existing stored account layouts and the program address remain unchanged. Legacy oracle instructions remain ABI-compatible but are not called by the active worker. No Pyth key, paid plan, feed posting, or worker stock inventory is used by the new worker.
- The worker retains its transaction journal and uncertain-signature reconciliation. Product flags, pause state, the capped quote authority, and the pilot owner remain onchain controls.

## Verification

26 of 26 contract runtime tests passed, including all eight captured-program tests. New cases cover fee-inclusive limit rejection, underdelivery rollback, stale quotes, unauthorized execution, replay, DCA timing and reinvestment, yield-only spending, and paused execution. Captured mainnet Kamino/Jupiter programs passed combined Limit and DCA swaps; stock-yield swaps passed without changing principal/shares. These use synthetic local positions against captured venue state, not funded mainnet order executions.

All 84 application tests passed. Type checking passed. Existing math tests passed in the contract build. No SBF stack-limit errors were reported. The build retains overflow checks and uses size optimization.

## Funding and deployment

Program: `7EMrgJNodNBmuQBg3cv9ASDUmXQFYp1VRiHcCzUMaC7E`.
Upgrade authority: `ACbdckvGrWj6Qifeq99daEeYz4WzVk5u2uUgK6crNkwx`.
Allowed pilot wallet remains `EYVq1MrwT5mfsh8kJLw645ARKK3uP4ja3UcTzb8ULcff`.

The worker wallet `24Gsn1yessodCP86t8LsZ9c9USvj25RiaypXnxpwmsuz` was funded with 0.1 SOL, confirmed by transaction `5AZ7BuyUvm2jPasJt1cqDEX6udYvV8LVqzTuEpRPwTevqDtvyhdMPaJL4nCmb5cnngHdqhVZ4UNDz9Hm7q87YrVq`. The earlier expired, absent funding attempt was reconciled before this replacement was sent.

Current upgrade plan:

- Admin balance: 3.465775276 SOL.
- Temporary upload-buffer rent: 4.250400440 SOL.
- Reserved upload/upgrade transaction budget: 0.025 SOL.
- Funding gap: 0.809625164 SOL.

The existing ProgramData account is large enough; no extension or account migration is needed. Upload-buffer funds are released to the admin on successful upgrade; only actual transaction fees are spent. The current program is not closed. The upgrade script verifies the deployed baseline and candidate bytes, uses an explicit local buffer key, journals submissions, and verifies the deployed bytes and retained authority after upgrade.

## Remaining activation checks

Packs and Lucky are now enabled alongside Earn (mask 49), unpaused, restricted to the same pilot and 25 USDC cumulative admission cap. Activation confirmed in transaction `2EmDvaQUT6tM76sDLj3Fshzo2JiNBxwJzvHgkFVsoocdZVh2NETrCj1f2VBAiR46HGNKLMXE1J9UynGZC7DAuEzK`. The Lucky pool holds 25 USDC, with a 20 USDC maximum stake. Available reserve must cover each opening/rollover; a maximum win may leave insufficient reserve for another roll. Odds are unchanged.

The persistent local worker is running with a private transaction journal and healthy status. A live unsigned one-pack purchase for the pilot returned HTTP 200 and passed simulation, disclosing 10 USDC total and 0.20 USDC protocol fee. This is a preview, not a signed purchase or completed opening.

Limit, DCA and stock-yield remain gated until the funded upgrade. Complete that upgrade, enable the remaining restricted flags, publish the matching application/IDL, and verify their live previews. Funded user-wallet flows require the user's wallet signature. Actual yield-earned packs require real net accrued yield; the $10 threshold is never filled with principal or fabricated yield for a mainnet demo.

The initial worker will run on the development Mac for restricted testing. Continuous public service requires an always-on worker host. No worker or admin private key is placed in the browser or public repository.
