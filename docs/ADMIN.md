# Admin dashboard

Open `/admin`. This is a read-only dashboard; no transactions or configuration
changes can be submitted from it. It is excluded from search indexing and public
navigation. The page shell is public; data is protected at the API boundary.

## Access

The onchain `config.admin` wallet has access by default. Optional dashboard-only
roles can be granted using `HENAR_ADMIN_WALLETS`, a comma-separated server-side
list of public wallet addresses. Pilot access does not grant dashboard access.
Changing this list requires restarting/redeploying the application.

A compatible wallet signs a domain-bound message to start a five-minute session.
The signed proof is held only in React memory and sent in the Authorization
header. The API verifies the Ed25519 signature, exact origin, expiry, and current
allowlist before reading or serving a cached snapshot. Wallet changes and local
sign-out clear the displayed data. Sign-out clears the local proof; an already
copied proof remains valid until its five-minute expiry. No cookies or private
wallet keys are used, and no private keys should be configured on Vercel.

## Data available now

- Finalized Position, PackBatch, and Pack accounts belonging to this configuration.
- Distinct account-owner wallets, product usage, principal basis, sealed packs,
  active orders, delivered stock budgets, and account timestamps.
- Yield fees recorded in positions, separated from pack fee collection records.
- Random pack fees only after settlement; Lucky batch fee once at opening,
  including later refunds, never again for a rollover.
- Current treasury USDC balance, policy masks, pilot admission use/limit, and
  unsettled/overdue pack counts.
- Wallet search, pagination, CSV export, and Solana Explorer links.

Treasury balance is not revenue. Position principal basis is not current TVL.
Recorded yield fees include accruals and cannot be treated as reconciled cash.
Lucky fees are not Lucky pool profit. Budgets spent are not current stock values.
Wallets are not unique people. Last account timestamps are not last website visits.

Snapshots are cached in memory for up to 15 seconds after successful authorization.
Account lists are independently finalized reads and can reflect different slots.
Missing reads fail closed or show unavailable, rather than replacing failures with
zero. The dashboard rejects more than 5,000 retained accounts pending an indexer;
RPC enumeration itself must move to paginated indexing before that scale.

## Data that still requires an indexer

Market swaps are not Henar position accounts. This dashboard does not invent
Market revenue, historical users, visitors, conversion funnels, referral balances,
or worker health. It labels missing coverage explicitly.

For complete revenue analytics, implement a persistent, idempotent transaction
indexer with backfill from deployment. Attribute atomic Market fee transfers to
server-issued reviewed trades; reconcile fees into configured treasury accounts;
separate external treasury funding, fees, refunds, withdrawals, and reserve P&L.
Keep token amounts by mint until a documented historical USD pricing policy is
available. Do not value all token fees as USDC or count deposits as revenue.

Index position and pack events using transaction/instruction identifiers and
finality, retain historical records if accounts close, then add date filters and
revenue trends. A separate consent-aware website analytics source is needed for
page views/conversion, the referral ledger for referral metrics, and authenticated
worker heartbeats for service health.

## Verification

`tests/admin.test.ts` covers unauthorized wallets, forged signatures, origin
binding, expiry, future timestamps, exact integer aggregation, duplicate wallet
counting, fee timing, missing Lucky provenance, and waiting-for-Bank deadlines.
Unauthenticated `/api/admin/analytics` returns 401 with private/no-store caching.
