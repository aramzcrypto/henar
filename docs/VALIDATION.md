# Validation — 2026-09-12

## Passed in this implementation

- Optimized Next.js production build, TypeScript and ESLint checks.
- 43 JavaScript tests: base-unit arithmetic, fee rounding, catalogs/allowlists, request rejection, oracle minimum/scale/limit calculations, full-width instruction/PDA encoding, full mainnet genesis validation, HTTP confirmation outcomes provider-error redaction, explicit Jupiter V2 fee transfers, and transaction byte/account-limit enforcement.
- 10 Rust arithmetic tests, including exact scaled-token multiplier conversion.
- 9 compiled-SBF runtime tests. They exercise actual SPL token transfers, deposit custody, yield/share accounting, earned-pack thresholds, purchased/gifted/refunded batches, ownership/overflow/replay failures, full-vs-partial/stale oracle rejection, VRF binding, delivery-before-payment, scaled Token-2022 receipt units, limit execution, DCA timing and cancellation. Multi-reserve redemption is tested for both complete withdrawal and rollback of incomplete liquidity.
- Mainnet snapshot test executing the deployed Kamino/KLEND binaries locally: deposit and complete withdrawal passed.
- Mainnet snapshot test executing the deployed ORAO binary locally: correctly bound pending randomness request and duplicate rejection passed.

Default runtime tests use explicit mock vault/oracle fixtures only inside the local test harness. Mainnet snapshot tests copy real program binaries/state into local ProgramTest and use public test wallets; they do not submit transactions to mainnet. Snapshot data is cached under `.cache/mainnet-snapshot`, never used as application balances.

- Browser verification: Earn, Packs, Trade and Portfolio render on a 390px viewport without horizontal overflow on the checked Earn/Packs/Trade screens. Earn opens its mobile deposit drawer. No browser errors were reported in this credential-free pass. This does not validate wallet signing.

## Configured integration checks

- Helius verified the mainnet genesis and returned live blockhashes through the protected Vercel preview RPC endpoint.
- Authenticated Jupiter quotes returned valid routes for all 39 candidate Backpack pack stocks. Quotes are time-sensitive and do not prove issuer eligibility or actual receipt.
- Rebuilt program identity: `7EMrgJNodNBmuQBg3cv9ASDUmXQFYp1VRiHcCzUMaC7E`; ELF SHA-256 `73161dfdb327ccf723641e74305a86f6b4e7af06babd86cfbafdade86345e084`.
- Re-ran both deployed Kamino and ORAO snapshot tests against that exact local binary; both passed.
- Actual vault lookup table packet compilation: deposit 696 bytes; full withdrawal 882; cancellation 845; harvest 874. The 1,232-byte limit is enforced before serialization; the conservative 64-account limit is enforced separately.
- Atomic route checks found that unrestricted Jupiter routes exceeded packet/account limits. The worker now uses bounded routes, a protocol lookup table, and the broadest reserve prefix that fits, all checked before oracle posting. With a locally constructed candidate table containing the planned public addresses, all 78 pack/order compositions for 39 stocks fit: maximum 997 bytes and 56 accounts. This is wire-format verification using live quotes, not simulation or onchain table verification. The table still needs onchain creation with a funded wallet.

## Pending final credentials / funded environment

- `deployed_pyth_full_verification_is_consumed_by_stockroom` is implemented but has not passed: obtaining signed Hermes payloads requires `PYTH_API_KEY` (the unauthenticated endpoint returned HTTP 401). Generate a fresh snapshot with `npm run mainnet:snapshot -- --with-prices` after configuring the key, then run that ignored test.
- Complete atomic swap/settlement simulation, wallet signing and actual stock receipt.
- Deployed Stockroom binary and configuration verification; real vault/yield accounting, ORAO fulfillment, withdrawals, gifts, expiry/refunds and Portfolio confirmation on mainnet.
- Stock-specific active transfer-hook/issuer eligibility behavior for all 39 candidate stocks.
- Production hosting, monitoring, rate limits and independent security review. Dependency audit currently reports unresolved findings; details are in MAINNET.md.

## Reproduce

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run contracts:build
npm run mainnet:snapshot
SBF_OUT_DIR="$PWD/target/deploy" cargo test -p stockroom --test runtime deployed_kamino_snapshot_deposit_and_full_withdraw -- --ignored --test-threads=1
SBF_OUT_DIR="$PWD/target/deploy" cargo test -p stockroom --test runtime deployed_orao_snapshot_creates_a_bound_pending_request -- --ignored --test-threads=1
```

The Pyth variant additionally requires a snapshot produced with `--with-prices`. Runtime logs are in `.cache/runtime-tests.log`, `.cache/mainnet-fork-tests.log` and `.cache/orao-fork-tests.log`. They are local evidence, not a formal audit or proof of production readiness.

## Pinned integration sources

- Kamino vault source: `1d146d7087a76edbbadc14d848ae14295c0745a4`.
- ORAO source: `5ef94f9c7d83952573b0276fa91e14495e2531a3`.
- Kamino SDK source: `38845294447623f6de3afc9dec29875f959f6f48`.
- Anchor 0.32.1, cargo-build-sbf 4.3.0, Solana CLI/program-test 2.3.13; SDK versions are exact in package.json and package-lock.json; Rust dependencies are locked in Cargo.lock.
- The `jito-ts` web3 dependency override aligns its old bundled web3 import with the root web3 version. Without it, the Pyth SDK import fails due to an incompatible rpc-websockets package export. No oracle verification shortcut was introduced.
