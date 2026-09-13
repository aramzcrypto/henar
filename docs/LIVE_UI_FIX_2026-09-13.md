# Live UI recovery — 13 September 2026

The user reported that henarapp.vercel.app displayed “The mainnet vault is not connected yet” when reviewing a 1.1 USDC deposit.

## Findings and fixes

- Every open tab polled the full protocol snapshot every five seconds. Helius rate limiting made reads intermittently fail, and a single failure erased the last confirmed snapshot. Visible tabs now poll every 15 seconds, hidden tabs do not poll, concurrent reads are coalesced, and successful protocol reads have a short per-owner cache. Transaction preparation still reads fresh chain state. The UI keeps confirmed balances during an interruption and offers a retry action.
- Valid Jupiter multi-hop routes can omit the intermediate legacy mint from the swap accounts while including its wallet token account. Setup validation now accepts that case while verifying the canonical wallet ATA and writable route reference.
- A closed wrapped-SOL account can appear in simulation as an empty system account instead of null. Only the account named by a validated cleanup instruction can use either closed representation. Unexpected token-account closure remains rejected.
- Some stock treasury fee accounts did not exist, preventing SOL-funded trades. The preview can create only the configured treasury's canonical ATA. Its exact simulated setup cost is separately disclosed before the user's signature. No fee account is created when the calculated protocol fee is zero.
- A route that would access unrelated existing wallet inventory is still rejected. The builder tries one smaller route with the same validation before giving up. It does not relax custody checks or silently accept a different amount.
- Empty provider error messages now use the normal error fallback.

## Verification

- Live Earn preview: HTTP 200 for the allowed wallet `EYVq1MrwT5mfsh8kJLw645ARKK3uP4ja3UcTzb8ULcff`, 1.1 USDC, Packs destination, Auto Packs off. Simulation passed; nothing was signed or sent.
- Browser regression: failed initial read, retry, retained snapshot on failed refresh, recovery, and no hidden-tab polling all passed.
- Mobile Trade/Earn/Packs checks at 390 × 844: no horizontal overflow or uncaught browser errors.
- Actual unsigned mainnet route simulations passed locally for 1.1 USDC and 0.01 SOL into the supported BABA stock mint.
- Application tests: 74 passed, including captured multi-hop route validation, rejected setup tampering, and closed-account representation tests.

## Scope

The on-chain policy remains Earn-only for the user's pilot wallet, unpaused, with a 25 USDC cumulative admission cap and 1 USDC previously admitted. Market trading uses wallet-signed Jupiter routes separately. Limit, DCA, stock-yield, Packs and Lucky are not activated by this UI fix. No contract upgrade or user-wallet transfer was performed for this fix.

The initial oracle-free position-swap module is separate, unfinished local work. It passes host compilation but needs worker integration, runtime/security tests, and an upgrade before any dependent products can be enabled.

Local diagnostic responses and browser test scripts are in `.cache/all-features/`; credentials are excluded from those records and from deployment artifacts.

## Final production verification

Deployment `dpl_GtL3N5GKxKFfx7LunrpQzpNx4Eds`, immutable URL `https://kanimarkets-j5w0t5f1s-arams-projects-cb250d30.vercel.app`, promoted to `https://henarapp.vercel.app`.

The deployed protocol read, 1.1 USDC Earn deposit preview, 1.1 USDC market preview, and 0.01 SOL market preview all returned HTTP 200 for the pilot wallet. Both market tests used `BABANGA4JE7Kkam4nTrALAwAVgsNJUuFJnnkF7S16BZp`. The SOL trade preview explicitly returned 1,559,560 lamports of protocol token-account setup funding; the USDC trade returned zero for that field. These were simulations and unsigned previews, not executed trades. Final mobile and connection-recovery browser checks passed again on the promoted deployment. Final type checking and production build passed.
