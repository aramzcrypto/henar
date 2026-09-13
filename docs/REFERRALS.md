# Henar referrals — prelaunch

The Rewards icon beside the wallet opens a referral dropdown on hover or click.
It also supports keyboard activation, Escape, outside clicks, and mobile layouts.
Points and a dedicated Rewards page are intentionally omitted for now.

## Agreed economics

The proposed reward is 10% of trading fees Henar actually collects, not 10% of
trade volume. Every $10 of accrued rewards funds one sealed Random pack for the
referrer's wallet. Rewards, balances, and delivery are not active in this release.

## Current invitation capture

A connected wallet can copy `/?ref=<wallet address>`. The app captures this on
landing and app pages and remembers the first valid invitation in this browser
for 30 days. Invalid addresses and expired invitations are rejected. A connected
wallet's own invitation is ignored/removed. Storage-disabled browsers continue
normally. The address in an invite URL is public.

This is browser-local invitation capture only. It does not count verified
referrals, associate another connected wallet with the referrer in a database,
track trades, or create credits. Clearing storage loses the invitation. Local
storage is untrusted; modifying it must never grant rewards. Unavailable stats
are displayed as dashes, never invented zero balances.

## Required before activation

- Persist a wallet-authenticated, immutable referral relationship in a shared
  ledger before the first qualifying trade. Reject self-referrals; specify
  eligibility and attribution terms publicly before users accrue rewards.
- Verify finalized trading transactions against server-issued trade records,
  their wallet signer, and actual transfers into the configured fee accounts.
  Do not accept client-reported fees or use transaction submission as payment.
- Use a unique transaction/instruction key to prevent duplicate credits. Define
  conversion to USDC for fees collected in stock tokens before enabling those
  trades for rewards. Only distribute the referrer's portion of collected fees.
- Accrue using integer base units and carry remainders. Atomically reserve $10
  credits in a durable payout job, retaining credits above the threshold.
- Fund and operate an authorized pack-delivery worker after contract deployment.
  Existing pack gifting needs a funded pack source; it does not mint free packs.
  Confirm recipient, backing, fee treatment, and Random opening behavior.
- Reconcile finalized deliveries and retries using stable payout IDs. Never
  debit twice or create duplicate packs after a crash or RPC timeout.
- Serve verified counts, balances, delivery history, and progress from the ledger;
  replace the prelaunch UI only once the end-to-end flow is verified.

No deployment or database provisioning is included in this change.
