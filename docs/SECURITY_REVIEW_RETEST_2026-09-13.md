# Kani Markets — remediation review

> Subsequent release update: the reviewed artifact was deployed upgradeably and a restricted Earn deposit/full-withdrawal test passed. The contract remains paused. See [the mainnet deployment record](MAINNET_RELEASE_2026-09-13.md); statements below record the remediation review before that deployment.

Date: 13 September 2026 (Asia/Baghdad)
Reviewer: Codex, reviewing code it also helped implement.

The four findings in the [baseline review](SECURITY_REVIEW_2026-09-13.md) are addressed in the reviewed source and passed targeted regression testing. Web changes and API firewall rules are deployed. Solana contracts have not been deployed or activated. This is a first-party review, not an independent audit or approval for unrestricted public funds.

## Remediation results

| Finding | Change | Retest result |
| --- | --- | --- |
| KANI-01: upstream instruction injection | Market and position-worker routes validate the Jupiter program, ordinary RouteV2 encoded amounts and fees, fixed accounts, signers, setup and cleanup instructions. Unrelated operations fail closed. Wallet inventory checks reject routes exposing unrelated funded token accounts; market simulation verifies balance changes and token authorities. | Captured USDC and SOL routes accepted. Injected authority changes, altered amounts, destinations, signers, fees and native overspending rejected. |
| KANI-02: pause and legacy settlement bypass | Investment execution checks global/product stops. Legacy pack settlement also requires the canonical pack execution configuration to be enabled and its budget cap to cover the pack. Owner exits remain available during pause. | Paused harvest/fill and disabled or paused legacy settlement rejected; valid enabled settlement succeeds. Paused principal withdrawal and Lucky banking remain available. |
| KANI-03: unrestricted activation | Separate Earn, Limit, DCA, stock-yield, Packs and Lucky bits; optional single-wallet pilot; cumulative external USDC admission cap. Defaults: all products disabled, admin-only pilot, $100 cumulative admission. Policy changes require pause. | Non-pilot admission, disabled products and cap overflow rejected. Deposit and purchased-pack admissions share the counter. Withdrawal does not refill the budget; failed operations roll back atomically. |
| KANI-04: API abuse exposure | Streaming request-body limits, strict RPC method/parameter validation, transaction size limits and deployed Vercel IP rate limits. | Oversized bodies and unsupported RPC methods rejected before upstream use. Live production returned 400 for both probes. Published firewall configuration was read back as active and valid. |

The admission limit counts cumulative external USDC accepted, not current TVL. Withdrawals and refunds do not reset it. Yield-derived packs do not count as a second external deposit. Per-pack execution limits are separate controls.

Route validation intentionally supports a restricted Jupiter instruction format. Unsupported/shared route versions and unrecognized setup operations are rejected, which can reduce available routes. Legacy oracle-based delivery remains supported when the same execution switch, product gate, pause state and budget cap permit it; it is not a bypass for disabled direct execution.

## Validation evidence

- Application tests: **61 passed**, including seven security-policy regressions.
- Rust math: **12 passed**.
- Solana runtime: **15 passed**, plus **5 snapshot integration tests passed** separately. Snapshots cover Kamino, ORAO, Lucky ORAO, Pyth verification and direct Jupiter stock delivery without Pyth.
- Type checking, lint, contract build, generated IDL and Vercel preview/production builds passed.
- Mobile browser smoke checks at 390 × 844: Trade, Earn and Packs loaded without horizontal overflow or page errors.
- No funded mainnet transaction or wallet signature was performed for this retest.

Built SBF artifact: `target/deploy/stockroom.so`, 931,544 bytes.

SHA-256: `f62a3701210f0548c2cf39639fb4acfc999833f0b214706efd5b3003d6c2171e`.

Local evidence is retained under `.cache/`: `security-fix-tests.log`, `security-fix-types.log`, `security-fix-lint.log`, `security-fix-contracts.log`, `security-final-snapshots.log`, `security-ui-check.log`, and the firewall/deployment logs. These local logs are not public repository artifacts. The reviewed working tree is based on commit `553b280b146afa701762872139ad1e1a92c07f63`; remediation is not represented by a new Git commit yet.

## Deployment status

Production: [kanimarkets.vercel.app](https://kanimarkets.vercel.app).

Production deployment ID: `dpl_GPghL25SpW6wehrSxis97MLCqxMb`, rebuilt with production environment variables from successful preview `dpl_QTHKD9Xit1BSfEtMHWGQTEToHLyG`.

Live firewall policy, in priority order:

1. `/api/market*` and `/api/protocol/prepare`: 30 requests per IP per 60 seconds.
2. `/api/*`: 120 requests per IP per 60 seconds.

These are regional IP limits, not a global provider spending ceiling or protection against every distributed attack. Configuration was verified through the control plane; deliberate load testing of the 429 threshold was not performed against the user's live session.

Concurrent UI, Henar branding and Lucky probability edits were preserved. The current Lucky probability table is 4%, 20%, 64%, 8%, 4%, with 95% expected return under the tested payout table. Passing its arithmetic tests does not establish operational safety of the entire Lucky lifecycle.

## Remaining release requirements

1. **Fresh contract deployment and account layout verification.** Config grew by 49 bytes. The updated layout targets a fresh deployment; an existing old-layout deployment would require a deliberate migration. Test fixture adaptation is not a production migration.
2. **Restricted funded smoke test.** Deploy initialized and paused, inspect authority/configuration, then enable only the intended product for the pilot wallet with a small cumulative cap. Verify actual deposit, withdrawal, order cancellation, pack purchase/opening, stock delivery and recovery as applicable before expanding access.
3. **Lucky-specific adversarial review.** The earlier unconfirmed late-VRF/timeout ordering concern still needs dedicated lifecycle testing before public Lucky activation. Lucky remains disabled by default.
4. **Price-quality and integration assumptions.** Direct pack swaps trust quote authority for price quality rather than an independent fair-price oracle. Slippage and budget checks do not eliminate that trust. Actual issuer eligibility, transfer hooks and every supported mainnet stock route are not covered by snapshot tests. Position pricing/feed coverage remains a separate activation requirement.
5. **Authority and operational controls.** Review upgrade/admin/quote authority custody, recovery and monitoring before meaningful funds. An upgrade cannot reverse an already completed transfer or automatically migrate state.
6. **Dependency maintenance.** The original dependency advisory reachability assessment remains applicable; all transitive advisories were not eliminated through forced SDK changes. See the baseline report for disposition.

Decision: the four remediations passed this review. The next release stage is paused deployment and restricted testing with the owner's funds, not unrestricted mainnet activation. No new API credentials were required for these fixes.
