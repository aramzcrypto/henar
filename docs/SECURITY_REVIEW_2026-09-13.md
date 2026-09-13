# Kani Markets — pre-mainnet security review

> Historical baseline report. The four numbered findings were subsequently fixed and retested; see [the remediation review](SECURITY_REVIEW_RETEST_2026-09-13.md) for current evidence, deployment status, and remaining launch requirements. Statements below describe the original review, before remediation.

Date: 13 September 2026 (Asia/Baghdad)
Reviewer: Codex, including review of code it previously helped implement.
Status: **NOT APPROVED for public deposits or unrestricted mainnet activation.**

This is a first-party security code review, with local adversarial checks and Solana runtime tests. It is not an independent audit, formal verification, a warranty against loss, or a completed funded mainnet test. No funds were moved and no deployment, configuration, credentials, or application code were changed during this review.

## Executive decision

Audit and fix before putting user funds at risk. Deploying an initialized, paused program for inspection is a separate step from enabling deposits. Later updates can use the same program address while its upgrade authority is retained; they do not reverse completed transfers and do not automatically migrate incompatible account data. Removing upgrade authority is irreversible. See [Solana's deployment and upgrade documentation](https://solana.com/docs/programs/deploying).

Current blockers:

1. Restrict market and position-worker transaction instructions before signing (KANI-01).
2. Define and enforce execution pause semantics across every settlement entry point (KANI-02).
3. Add a restricted pilot mode and product-specific activation gates; the present global unpause permits public deposits into all position kinds (KANI-03).
4. Establish API abuse protection and provider spending limits (KANI-04).
5. Complete dependency advisory disposition, release verification, and a funded, restricted mainnet smoke test.

No permissionless theft of principal or reserved Lucky payouts was demonstrated in the reviewed contract paths. That statement is limited to the review and tests below; it is not a claim that none is possible.

## Scope and reproducibility

Contract/API/worker baseline: `553b280b146afa701762872139ad1e1a92c07f63`.

Tested local SBF artifact: `target/deploy/stockroom.so`, SHA-256 `cc3f5b26416d4158963cacede855c401e1f28216af4e0f56ddd657f5837a6576`.

Reviewed boundaries:

- Anchor instruction handlers and account constraints, configuration/admin transfer, manifests, token custody and CPI.
- Exact principal/yield/fee accounting; deposits, withdrawals, cancellation, harvesting, yield allocation and order settlement.
- Purchased/earned/gifted packs; ORAO requests, selection, Lucky reserves, banking, rollover and refunds.
- Direct Jupiter pack delivery, legacy oracle settlement, Pyth validation, Kamino account binding.
- Market transaction preparation, wallet signing, public RPC/quote routes, keeper signing and retry journal.
- Dependency advisories, secret exclusion, operational setup and activation assumptions.

Uncommitted UI work was present at the start and preserved. During the review, concurrent edits also changed `crates/stockroom-math/src/lib.rs`, `src/lib/lucky.ts`, `src/lib/protocol/prepare.ts`, Lucky tests/docs, and branding/landing files. The new Lucky buckets are 4/20/64/8/4%, compared with the baseline 10/45/15/10/20%. This report and the recorded SBF hash are **not an approval of those moving changes**. Freeze and rebuild the intended release, then review the delta and rerun the full suite. In particular, changing payout code must not retroactively change odds promised to an already-open pending pack: version terms per pack or prove there are no affected outstanding rounds before an upgrade.

## Findings

### KANI-01 — High: upstream route instructions can exceed the reviewed trade's authority

**Confidence:** confirmed instruction-validation gap; exploitation requires a malicious/compromised upstream build response and a successful transaction. No live exploit was attempted.

**Evidence:**

- [Market route assembly](../src/app/api/market/route.ts#L208) includes upstream setup, swap, cleanup and `otherInstructions` directly. Their program IDs, opcodes, accounts and permitted effects are not constrained to the reviewed trade.
- [Shared schema](../src/lib/market.ts#L2) validates structure, not instruction meaning.
- [Position worker route assembly](../services/solver/market.ts#L32) performs amount checks but returns the same unrestricted instruction groups at line 58.
- [Market wallet signing](../src/components/stockroom.tsx#L555) simulates and signs the supplied message without binding all its effects to the displayed review. [Dispatcher](../services/solver/transactions.ts#L23) similarly checks simulation success, not permitted effects.

**Impact:** an otherwise valid route could include an unrelated SPL token account authority change, approval, or transfer signed by the user or keeper. Amount fields can still describe an ordinary trade. A successful simulation, one required signer, packet-size limits and fixed compute fees do not prohibit these additional effects. For an ordinary token account, an authority change need not change its balance or the user's SOL balance, and can permit later theft. This is conditional on upstream response integrity failure, not a finding that Jupiter currently returns malicious instructions.

**Local reproduction:** `.cache/security-review/reproduce.ts` mocks fetch, supplies a matching quote with an unrelated SPL `SetAuthority` in `otherInstructions`, and calls the actual shared schema and position route builder. Both accept it and preserve the owner's signer privilege. No RPC, signing, simulation or broadcast occurs. The market path shares this schema; its inclusion of those instructions was confirmed by source review, not a full mocked market POST or funded exploit.

**Remediation:** implement a common route policy for market and worker paths. Validate canonical router, supported exact-in opcode and encoded terms, source/destination accounts, signer and writable privileges, expected ATA creation and tightly constrained native-SOL cleanup. Reject unexplained extra instructions, authority changes and approvals. Bind final transactions to the user's reviewed terms and verify relevant post-simulation token account state. Add malicious-response regression tests for both paths. A program-ID allowlist alone is insufficient: SPL Token itself can perform an unwanted authority change.

**Existing mitigation:** fixed HTTPS Jupiter endpoint, fresh quotes, simulation, explicit fees, wallet approval for market users. Position execution is currently opt-in. The newer pack-specific validator is substantially stricter, so this finding should not be generalized to that path.

### KANI-02 — Medium: stopping direct pack execution does not stop legacy settlement

**Confidence:** confirmed from instruction handlers; pause scope requires an explicit product/security decision.

**Evidence:** [Direct pack swap](../programs/stockroom/src/pack_swap.rs#L90) requires both enabled execution and unpaused configuration. [Legacy `settle_pack`](../programs/stockroom/src/packs.rs#L323) checks selected status, expiry, stock and oracle delivery, but not either stop flag. It remains publicly exposed in `lib.rs`. [Yield settlement](../programs/stockroom/src/positions.rs#L522) and `fill` likewise do not check `config.paused`.

**Impact:** an operator cannot interpret the global pause or pack execution disable as a complete trading circuit breaker. A party supplying the required stock and valid oracle accounts can still settle an existing allocation through the legacy path after direct swaps are stopped. Oracle and recipient protections still apply; this is not evidence of arbitrary withdrawal or unauthorized redirection.

**Remediation:** define separate entry/deposit and execution pause semantics. Apply the execution stop consistently to direct and legacy pack delivery and automated position settlement, or remove the unused legacy pack entry point. Keep legitimate owner withdrawal, claim and refund exits available. Add tests that attempt every settlement path while paused and every owner exit while paused. If continuing fulfillment during an entry-only pause is intentional, name and document that policy; direct-pack-only shutdown still needs to cover alternate delivery paths.

### KANI-03 — Medium: global activation also accepts unsupported automated positions

**Confidence:** confirmed activation/control gap; fund theft not demonstrated.

**Evidence:** [Position creation](../programs/stockroom/src/positions.rs#L23) uses one global pause and accepts Earn, Limit and DCA with valid terms. [API preparation](../src/lib/protocol/prepare.ts#L145) constructs these deposits without a product availability gate. [Worker opt-in](../services/solver/engine.ts#L246) only stops the offchain worker. There is no contract depositor allowlist, global deposit cap, or per-product enable flag in current configuration. A per-pack execution budget limits one settlement, not total deposits or total exposure.

**Impact:** enabling the protocol for Packs or USDC Earn can also allow users to create Limit/DCA/Earn-to-stock positions before oracle coverage and a live worker are ready. Such positions may remain unfilled and require cancellation/withdrawal. Hiding a UI or stopping the worker does not prevent direct contract calls. Unpausing for a supposedly private pilot is currently public activation.

**Remediation:** add contract-enforced per-product activation flags and temporary pilot restrictions, plus matching API/UI availability. Prefer an allowlist with an aggregate exposure cap for testing. Test direct calls from a non-pilot wallet and attempts to use disabled products. Keep oracle-dependent products off until each supported feed and actual execution path works. Do not describe the current program as having capped/private deposit testing.

### KANI-04 — Medium: public APIs can spend shared provider quotas without application throttling

**Confidence:** confirmed application behavior; Vercel/provider edge policies were not inspected and could mitigate exposure.

**Evidence:** [RPC proxy](../src/app/api/rpc/route.ts#L14) forwards allowed methods using the server's RPC credential, with no caller quota, concurrency budget or app-specific transaction restriction. `simulateTransaction` and `sendTransaction` are allowed; their parameters are forwarded without method-specific validation. Quote and estimate routes also call paid upstream services without a shared application throttle. The RPC body size check happens after reading the complete body.

**Impact:** callers can use the endpoint as a general service for supported RPC methods, consuming credits, concurrency and availability for legitimate users. This does not give callers the RPC secret or a wallet signature. An application-level body cap alone does not bound total request volume.

**Local reproduction:** `.cache/security-review/rpc.ts` calls the real RPC handler 20 times without authentication and verifies 20 mocked upstream forwards. This demonstrates no handler throttle, not an attack against production or proof that its edge has no controls.

**Remediation:** configure and verify distributed/edge rate and concurrency limits, upstream account spending alarms/caps, bounded method-specific parameters and body parsing, and separate budgets for simulation and expensive quote solving. Use a short-lived session or wallet proof where appropriate, but do not rely on browser Origin checks as authentication or on per-process counters on Vercel. Add integration tests for rejection and recovery under quota exhaustion.

## Dependency review — unresolved advisory disposition

`npm audit --json` reports **41 affected package entries: 23 high, 18 moderate, zero critical**. These include transitive effect chains, not 41 distinct exploitable application bugs. Machine-readable evidence: `.cache/security-npm-audit.json`.

Initial reachability triage:

- `bigint-buffer`: native `toBigIntLE` overflow advisory. SPL layout helpers call it through bounded bigint layouts; arbitrary-length attacker input reaching the vulnerable native conversion was not demonstrated. The native addon is present in this local install. Production/worker build parity and other transitive call sites still need disposition; bounded local SPL layouts are not a blanket exemption.
- `toml`: parser recursion/prototype pollution advisories. The inspected Anchor workspace path reads local `Anchor.toml`; no public TOML input was found. That materially reduces remote exposure but does not justify blindly ignoring the package.
- `postcss`: source-map file-read and stringify advisories in Next's nested dependency. No user-submitted CSS build/render path was found. Treat primarily as build dependency exposure for this application unless another input path is introduced.
- `image-size` via Metro/React Native: parser denial of service. This app uses Next; a reachable Metro image-processing server was not identified.
- `stream-json`: inspected Jayson streaming code uses `StreamValues` and `Verifier`, not the pick/ignore/filter/replace filters named in the advisory. `uuid`: inspected Jayson callers use v4, not the v3/v5/v6 buffer interfaces named in that advisory. These inspected call sites do not establish those specific exploits; retain the disposition when changing SDK versions.

Do not run forced dependency fixes or downgrade Solana SDKs merely to reduce the advisory count. Resolve with compatible updates/patches or documented, tested reachability exceptions. The npm result is not a clean dependency approval.

`cargo-audit` 0.22.2 completed against Cargo.lock using RustSec database commit `b50980aad8b8f14f77e25a97b32dd94bf008b0af` (last updated 9 September 2026). It reported **5 vulnerability entries**, **10 unmaintained warnings**, and **6 unsoundness warnings**. Evidence: `.cache/security-cargo-audit.json`.

- `curve25519-dalek` 3.2.0 — RUSTSEC-2024-0344, scalar subtraction timing variability.
- `ed25519-dalek` 1.0.1 — RUSTSEC-2022-0093, signing API misuse involving mismatched public keys.
- `rustls-webpki` 0.101.7 — RUSTSEC-2026-0104, RUSTSEC-2026-0098, RUSTSEC-2026-0099, certificate parsing/constraint issues.

Inverse dependency checks for all three affected package versions show no path in Stockroom's normal/build dependency graph, including `--target all`; they appear when Solana SDK/program-test development dependencies are included. This distinguishes local test/tooling exposure from the deployed SBF program. It does not certify the external Solana validator software or the safety of using affected signing APIs in future tools. Save this disposition and update compatible test tooling separately. The maintenance/unsoundness warnings still require package-by-package handling; warning counts are not demonstrated contract exploits. Inverse-tree evidence: `.cache/security-rust-reachability.log`.

## Verified controls and test evidence

Fresh runs during this review:

| Check | Result | Local evidence |
| --- | --- | --- |
| Application/unit tests | 54 passed | `.cache/security-tests.log` |
| Integer accounting/math | 12 passed | `.cache/security-math.log` |
| Solana runtime tests | 13 passed; 5 snapshot tests excluded in this run | `.cache/security-runtime.log` |
| Explicit snapshot integration run | All 5 passed | `.cache/security-snapshots.log` |
| Unsafe upstream instruction acceptance | Reproduced with mocked response | `.cache/security-review/reproduce.ts` |
| RPC forwarding without app throttle | Reproduced with mocked upstream | `.cache/security-review/rpc.ts` |

The snapshot run covers captured deployed Kamino, ORAO, Lucky ORAO, Pyth verification and a Jupiter stock-delivery route in a local Solana runtime. It uses synthetic funded user/config/escrow accounts. It does not establish that all live issuer assets, liquidity states, transfer restrictions or wallets work on mainnet.

Controls supported by source review and the existing tests include:

- Canonical program/config/PDA binding and owner signatures for owner actions. Initial configuration is bound to the program's upgrade authority; an unrestricted-initializer takeover is not present.
- Immutable sealed manifests and per-position/per-pack manifest binding.
- Integer/base-unit accounting, yield fee remainder carry, separate claimable yield, exact $10 earned-pack allocation and multiple-pack thresholds.
- Actual custody of vault shares, measured redemption/deposit changes, full-share redemption checks, and atomic rollback for incomplete routes.
- Fresh, bound ORAO requests; explicit owner opening; reserved maximum Lucky payout; one rollover; rejection of refunds that would erase an already fulfilled Lucky loss.
- Pack swap budget/recipient/mint enforcement, constrained signer forwarding, stale/future quote checks, actual received-token recording, post-CPI custody checks and replay rejection.
- Oracle account owner/feed/full-verification/freshness/confidence checks on paths that still use Pyth.
- Persistent worker signature journal before broadcast and pending-signature reconciliation rather than immediate replacement after uncertain confirmation.
- Private key and environment exclusions from Git/Vercel upload paths; fixed server-side upstream URLs; display metadata separated from mint identity/decimals; no raw HTML rendering sink found in the reviewed application source.

Passing these checks does not establish exhaustive branch coverage. This review did not run a sustained fuzzer, symbolic verification, third-party program audit, live adversarial trading, wallet-extension audit or independent build reproduction.

## Material trust assumptions and unresolved edge cases

1. **Pack quote authority remains trusted for price quality.** The contract checks minimum delivery against a quote signed by Kani's authority, not an independent fair price. A compromised quote authority could choose an economically bad route and sign a low minimum. Exact USDC spending and correct stock delivery do not prove equivalent market value. Keep its key separate from upgrade/admin keys, cap pilot exposure, monitor realized prices and preserve the disclosure. The per-pack cap is not an aggregate loss cap.
2. **Upgradeable contracts remain admin-trusted.** The upgrade key can replace program logic. A local testing key is not a long-term custody policy. Transfer upgrade/admin powers to an appropriate user-controlled multisig/hardware-backed process before meaningful public balances, and test recovery and upgrades. Do not make the program immutable during testing.
3. **Kamino and issuer risks remain external.** Principal protection in pack accounting means packs do not consume principal; it does not insure the vault against losses, liquidity shortages or issuer freezes. Real transfer-hook eligibility and exits during upstream failures still need funded checks.
4. **Lucky timeout ordering deserves a dedicated adversarial test.** Already-fulfilled loss refunds are rejected. A late fulfillment after timeout and cancellation racing ahead of it is a separate ordering case not proven safe by that test. No exploit was established here. Keep Lucky disabled until this scenario and reserve stress under real fees/latency are resolved.
5. **Lucky negative expected return does not guarantee reserve growth.** Wins are reserved before accepting a round, which prevents borrowing against hoped-for future deposits. Reserve availability, replenishment and shutdown still need operational tests. This review is not a legal approval of a paid chance-based product.
6. **Account lifecycle and migration need release tests.** Closed positions/settled pack state and their rent are not the same as the deploy buffer rent. Do not promise all account rent is reclaimable without a verified close path. No account-layout migration drill has been completed.
7. **Deployment controls were reviewed as code, not attested live infrastructure.** Production WAF rules, provider quotas, worker host hardening, alert delivery, backups and multisig recovery were not verified. No secret values are included in this report or the reproductions.

## Release sequence

1. Fix and retest the high-risk signing path. Resolve execution pause semantics and product gates, and finish advisory triage. Review the final diff and freeze the release artifact.
2. Deploy and initialize **paused**. Verify program ID, upgrade authority, deployed binary, treasury, vault, sealed stock manifest, quote authority and caps against the release record.
3. Enable only a contract-restricted pilot with the project's own disposable test funds. A paused program cannot exercise normal deposit/open instructions, so adding pilot restrictions is necessary before unpausing for this purpose.
4. Run real deposit/withdraw, partial withdrawal, claim, order cancellation, purchased pack, yielded pack, gift/refund, VRF request, swap/delivery and receipt reconciliation. Test pause/worker restart, expired quotes, low balances, lack of routes, provider outage and failed transactions. For enabled oracle products, test fresh signed prices and stale/wrong-feed rejection. For Lucky, test reserve refusal, banking, rollover and timeout behavior before broader activation.
5. Reconcile wallet balances, protocol fees, rent and every receipt. Test an upgrade with representative existing accounts and an owner exit afterward. Re-audit any fix or migration.
6. Only then consider gradually raising public limits. Obtain independent review before meaningful third-party funds even if this first-party review and pilot pass.

## Status of changes

Findings are **open**. Application/contracts were not patched as part of this reporting pass. The report and local reproductions have not been pushed to the public repository. Existing user UI work is preserved. No mainnet activation was performed.
