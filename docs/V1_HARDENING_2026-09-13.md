# Henar V1 hardening — 13 September 2026

First-party remediation of the supplied Claude Code review. This is not an independent audit or approval for unrestricted public funds. Contract development is concurrent with this web review; the final contract artifact needs its own frozen-source retest.

## Changes in this pass

- Per-response script nonces, Content Security Policy, frame denial, MIME sniffing protection, no-referrer policy and restricted browser permissions. HTML is dynamic and private/no-store so nonces cannot be reused through a shared HTML cache. Inline styles remain necessary; production JavaScript does not allow unsafe-eval. Vercel already provides HSTS.
- Market quote requests require a signed, origin-bound, wallet-bound message expiring after five minutes. The browser reconstructs that message before signing. Supplemental instance budgets limit executable quote work. A wallet must support message signing to use this flow.
- Market transactions are reconstructed and compared byte-for-byte before the wallet signing prompt. The browser validates route amounts, mints, payer/signers, setup/cleanup, the 25 bps protocol fee, and fixed priority fees against the review and user's request. Lookup tables and mint accounts are fetched independently. This does not defend against compromised frontend delivery or dishonest RPC data.
- Protocol actions are checked against the requested action, account, amount, pack count, gift recipient/message and position preferences before signing. Only the pinned Henar program plus the expected compute budget and USDC account setup are allowed. Remaining protocol account constraints are still enforced on-chain; this is not a second implementation of the full contract.
- RPC transaction submission requires a valid wallet signature and an invocation of Henar or Jupiter. This prevents the relay from accepting unsigned or unrelated transfers; it is not a complete anti-abuse system.
- Reuse server RPC connections and briefly coalesce mainnet identity checks. Failed identity checks are not cached. Route-account reads respect the relay's 20-account bound.
- The gift preparation API rejects off-curve recipients. Direct on-chain gifting still needs a matching supported-recipient policy; this API check alone is not a contract fix.
- The browser independently reconstructs admin authentication messages before signing.
- Referral copy explicitly describes the percentage as planned. Referral capture remains local to the visitor's browser; no durable accrual, retrospective attribution guarantee or pack payout is implied.

## Verification

- 84 application tests pass, including real ephemeral wallet proofs and rejection of altered amounts, fees, recipients, instructions, expired/cross-origin proofs and unsigned/unrelated relay requests.
- TypeScript and lint pass without warnings.
- A live, unsigned 1.1 USDC Earn deposit preview for the existing pilot wallet passed preparation/simulation and the new browser transaction validator. No funds were moved by this check.
- Local HTTP checks verify frame/referrer headers, distinct per-response nonces and rejection of an unauthenticated executable Market quote.
- Production deployment verification is recorded below when complete. Desktop access was unavailable because the Mac was locked; a separate headless browser verified live rendering and navigation without that access.

## Items that remain before unrestricted launch

| Item | Assessment and launch requirement |
| --- | --- |
| Pack rent | Approximately 0.01627944 SOL across a one-pack batch, its pack and two ordinary token accounts at the reviewed sizes. This is locked rent, not transaction fees burned by the network. Moving the 1028-byte gift field saves approximately 0.00715488 SOL per batch, not the entire batch rent. Closing accounts requires correct refund beneficiaries, protection against recreation/replay, live-pack references and durable Stockfolio history. Do not add unconditional close constraints immediately before submission. |
| Quote authority | The authority supplies price/output terms; custody checks do not independently establish fair market value. Keep explicit product/admission caps and restricted participation until the new execution path is retested. Establish key custody, rotation and monitoring before accepting broader public funds. |
| Oracle/keeper findings | Legacy confidence math widens the delivery band; at 1% confidence on each feed plus 1% slippage, the floor can be approximately 2.95% below the mid-price quantity. DCA already has next-fill and expiry checks; yield settlement lacks an equivalent cooldown. The peer task is replacing active oracle execution, so review the exact final active path rather than treating old findings as automatically closed. |
| Lucky | Keep disabled pending complete reserve, timeout/fairness and operational/product review. This pass does not activate Lucky or certify its economics. |
| API costs | Signed quotes, per-instance budgets and existing IP firewall rules are supplemental. Public estimates, reads and prepared actions can still consume upstream resources. Distributed enforcement, provider spending caps and alerting remain operational requirements. |
| Release provenance | The workspace contains concurrent uncommitted changes. The web snapshot has a SHA-256 source manifest in `.cache/henar-hardening-source-manifest.json`; it is not a reviewed contract commit. Freeze and commit the completed source, rebuild and record the exact deployed contract hash before claiming a reviewed release. |
| Referral rewards | Durable attribution and an accrual ledger are not implemented; payouts stay off as requested. |

The Market pair check intentionally permits a known stock paired with USDC/SOL or another token. Replacing OR with AND would break supported payment flows. A stricter payment-token policy, if desired, should be an explicit product decision with corresponding UI changes.

Historical security reports retain their original branding and point-in-time findings. They are not current activation status reports.

## Web deployment evidence

The web release was built on Vercel with production settings, then promoted to https://henarapp.vercel.app. Final candidate: `kanimarkets-9hav0gkzj-arams-projects-cb250d30.vercel.app`. The final delta adds a generation check immediately before protocol signing, rejecting a wallet/action change during asynchronous validation.

The preceding identical web build (apart from that check) passed live HTTP checks on Home, Trade, Earn, Packs, Stockfolio, Docs and Admin; repeated Packs requests received different script nonces. All 26 script tags in the inspected Packs response matched its CSP nonce. Executable Market quotes without a proof returned 401; a correctly signed ephemeral proof reached amount validation and returned the expected 400 for zero input. Anonymous admin analytics returned 401. Headless production Packs rendering, Lucky switching and client-side Docs navigation produced no browser errors. Wallet-adapter styles are bundled locally without their Google Fonts import.

No contract upgrade, product activation, wallet transaction signature or movement of user funds was performed in this hardening pass. No unrestricted-launch approval is implied.

Final promotion confirmed as `dpl_GqVeLuyxeT9Yf8gei3y1dnRpgnTn`. The final live Packs response passed the HTTP/header checks. A 390px headless browser navigated from Docs to Trade and opened the Connect wallet dialog without console errors. The isolated browser had no wallet extension, so this did not exercise a real wallet signing prompt or submit a trade.
