# Mainnet setup and operations

Status: the Solana program is deployed, initialized and upgradeable. Earn is unpaused only for pilot wallet `EYVq1MrwT5mfsh8kJLw645ARKK3uP4ja3UcTzb8ULcff`, with a 25 USDC cumulative admission cap (21 USDC admitted as of 20 September 2026, leaving 4 USDC). Other contract products remain disabled. A restricted 1 USDC Earn deposit and full withdrawal previously passed on mainnet using the admin wallet. See [the deployment record](MAINNET_RELEASE_2026-09-13.md). This is not unrestricted public activation.

Current production website: [Henar](https://henarapp.vercel.app). Website deployment does not deploy or upgrade the Solana program.

## Testing setup

The test program address is `7EMrgJNodNBmuQBg3cv9ASDUmXQFYp1VRiHcCzUMaC7E`. Admin/deployment funding address: `ACbdckvGrWj6Qifeq99daEeYz4WzVk5u2uUgK6crNkwx`. Keys are local-only in `.secrets` with restrictive permissions; these files are excluded from Vercel uploads. Never put private keys in deployment settings.

Run `npm run mainnet:status` for fresh balances and deployment status. Operational scripts now load `.env.local` automatically; exported environment values take precedence. `npm run mainnet:routes` verifies live Jupiter quotes. `npm run mainnet:packets` checks the actual vault packet layout.

## Final inputs

| Input | Where | Purpose |
| --- | --- | --- |
| `SOLANA_RPC_URL` | Vercel server and worker | Mainnet RPC with account reads, simulation and transaction submission |
| `JUPITER_API_KEY` | Vercel server and worker | Market and pack routing; optional position routing |
| `OPENOCEAN_API_URL` | Vercel server | Optional independent OpenOcean quote discovery; include the QuickNode `/addon/807` suffix |
| `STOCKROOM_TREASURY_OWNER` | Server and local setup | Public wallet receiving protocol fees |
| `STOCKROOM_LOOKUP_TABLE` | Server and worker | Public lookup table created by the setup command |
| `STOCKROOM_PROGRAM_ID` | Server and worker | Public address of the exact deployed build |
| `STOCKROOM_PROGRAM_KEYPAIR_PATH` | Local deployment only | Program identity file, mode 0600 |
| `STOCKROOM_ADMIN_KEYPAIR_PATH` | Local deployment only | Funded upgrade/configuration authority, mode 0600 |
| `SOLVER_KEYPAIR_PATH` | Persistent worker only | Limited operational wallet, mode 0600 |

Get Jupiter access through its [developer portal](https://developers.jup.ag/portal). **No Pyth subscription is required by the active worker.** Positions and packs use direct Jupiter escrow swaps. The program checks actual token delivery, schedules and limit prices. Quote quality for market-priced execution relies on the configured, capped quote authority. Legacy oracle instructions are retained for compatibility but are not called by the active worker. See [PACK_EXECUTION.md](PACK_EXECUTION.md).

`STOCKROOM_FEE_ACCOUNT` and `STOCKROOM_FEE_ACCOUNTS` remain optional explicit Market fee-account overrides. Otherwise, the server derives canonical treasury ATAs from `STOCKROOM_TREASURY_OWNER` and verifies that they exist. These are public account addresses, not credentials.

Jupiter V2 `/build` does not return the legacy platform-fee object. Market fees are explicit atomic token transfers: input-USDC fees reduce the swap budget, while output-token fees reduce the quoted stock receipt and minimum by the same disclosed fixed fee. No paid Titan integration/key is required for V1. OpenOcean adds independent price discovery through the free QuickNode plan; its mandatory 15 basis point provider fee is deducted before ranking. OpenOcean remains quote-only until its transaction instructions pass the same custody and simulation policy as Jupiter.

## Rebuild and deploy

1. Create or choose local program/admin key files with permissions 0600. Keep their contents private. The generated development placeholder and build-generated test identity must not be funded or used as production identities.
2. Set the public address using `npm run program:address -- <public-program-address>`. Set the corresponding environment variables. Run `npm run contracts:build` and all app checks. This regenerates IDL/address bindings.
3. Run `npm run mainnet:cost`. It queries actual rent for the current executable. The reviewed build is 931,544 bytes: **4.73395548 SOL persistent program rent**, before transaction fees and account setup. Agave 2.3.13 reuses the upload buffer funding during a first deployment, so it does not require twice that rent at once. A later upgrade needs a temporary funded buffer while the existing program remains funded; the conservative combined allowance is **9.46707784 SOL** before fees. Recalculate after changes to the build; these are RPC rent results, not fiat price estimates.
4. Deploy the checked binary with Solana CLI, explicit program key, admin upgrade authority and fee payer, mainnet RPC, `--max-len` equal to the binary size, and `--use-rpc`. The cost script prints the command template. Retain upgradeability for the controlled test phase; do not accidentally pass `--final`.
5. Run `npm run mainnet:plan`, review `config/mainnet-manifest.json`, then `npm run mainnet:setup`. Setup creates the USDC treasury ATA, initializes paused configuration, uploads stocks in packet-sized chunks, and seals/activates the manifest. It checks resumed uploads against the intended contents and refuses an already-unpaused configuration.
6. Run `npm run treasury:plan`, then `npm run treasury:setup` to create missing fee accounts for the V1 manifest. Add `-- --all` to plan/setup for the wider Market catalog; review the larger rent requirement first. It is idempotent and creates accounts with the correct SPL/Token-2022 program.
7. Run `npm run mainnet:lookup:plan`, then `npm run mainnet:lookup:setup`. This builds the protocol lookup table under the local admin, verifies every address, and saves its public address in `.env.local`. Add `STOCKROOM_LOOKUP_TABLE` to the Vercel preview environment and redeploy. Setup reconciles an uncertain prior signature before submitting a replacement.
8. Run `npm run protocol:preflight`. It verifies mainnet genesis, deployed executable bytes against the local build, vault/share mint, canonical programs, treasury, sealed manifest, extensions, configured credentials and pack quote authority. Add `-- --with-oracles` to separately check position oracle coverage. It does **not** certify a funded trade or economic safety.

## Raising the pilot admission cap

`admitted_usdc` is cumulative and never decreases — a withdrawal does not give
the headroom back — so the pilot wallet eventually meets "The mainnet testing
deposit limit has been reached." Raising the cap is a `configure_access` call
and needs no program change.

Read the live values first. This writes nothing:

```
npm run mainnet:access
```

**`configure_access` overwrites products, pilot owner and cap together.** It
does not merge with what is on chain. With the environment unset the plan
prints `products: []` and the admin wallet as pilot — running that would
disable every product and take access away from the pilot wallet. Always read
the printed plan before adding `--execute`, and always pass all three:

```
PROTOCOL_PRODUCTS=earn,limit,dca,stocks,packs,lucky \
PROTOCOL_PILOT_OWNER=EYVq1MrwT5mfsh8kJLw645ARKK3uP4ja3UcTzb8ULcff \
PROTOCOL_ADMISSION_LIMIT_USDC_BASE_UNITS=1000000000 \
STOCKROOM_ADMIN_KEYPAIR_PATH=<admin key> \
npm run mainnet:access -- --execute
```

The policy can only change while paused, so the full sequence is
`mainnet:pause -- --execute`, the call above, then `mainnet:unpause -- --execute`.
The script refuses a cap below what has already been admitted, requires the key
file at 0600, and checks the signer against the on-chain admin.

Raising the cap does not open public deposits. `assertAdmission` refuses any
wallet that is not `pilot_owner`, and that stays pinned to the pilot address;
the cap only governs how much that one wallet may cumulatively admit.

The operational scripts read `.env.local` only, and `vercel env pull` returns
several values empty (`STOCKROOM_PROGRAM_ID`, `JUPITER_API_KEY`,
`STOCKROOM_TREASURY_OWNER`). Without `STOCKROOM_PROGRAM_ID` every one of them
fails with "Henar mainnet deployment is not configured." It is a public
address, so set it in `.env.local` on each machine that operates the protocol:

```
STOCKROOM_PROGRAM_ID=7EMrgJNodNBmuQBg3cv9ASDUmXQFYp1VRiHcCzUMaC7E
```

## Worker

Run one persistent worker per state directory, outside Vercel. Export the worker environment, set `SOLVER_MAX_SETTLEMENT_USDC_BASE_UNITS` explicitly, then:

```sh
npm run solver:check
npm run solver:start
```

Packs always use direct Jupiter CPI from pack escrow to the owner's stock account; the worker needs SOL for fees/rent, not USDC or stock inventory. Configure its public key using `npm run packs:execution -- enable` (plan) then `--execute` after deployment and verification. This adds an explicit, capped quote-service authority.

Position stock fills now call `swapPosition`. The same configured quote authority and per-settlement cap apply. Product flags and pause state remain onchain controls; deployment of the new instruction must precede activation. The worker needs SOL for transaction/account costs, not USDC inventory. USDC harvesting and sealed-pack accounting use actual redeemed vault yield.

Persist `SOLVER_STATE_DIR` on durable storage. `worker.lock` prevents concurrent use of the same directory. `journal.json` records signatures before broadcasting. Reconcile all recorded signatures before removing a stale lock, restoring backups, or moving hosts. Never retry solely because an RPC request timed out. `health.json` is the heartbeat; alert on stale timestamps and repeated job errors. A process manager should restart crashes, not delete the journal.


## Controlled mainnet verification

Keep public access gated while performing these funded tests. Pause prevents new positions/purchases/openings, but owner exits/refunds remain available. A controlled test requires temporarily unpausing through `npm run mainnet:unpause`; return to `npm run mainnet:pause` on failures.

- Market: real stock purchase, exact fee, wallet rejection, quote expiry, insufficient balance, confirmed receipt and portfolio refresh.
- Earn: deposit and withdraw from the configured vault, measured share/cash deltas, actual venue costs. Observe real accrued yield; never inject simulated yield into production.
- Limit/DCA: unmet limits and premature schedules do not fill; executed stock minimum and fee match receipts; owner cancellation returns available principal plus net yield.
- Packs: buy, gift, explicit opening, real ORAO fulfillment, direct Jupiter CPI, stock delivery, receipt display and replay rejection. Test sealed refunds and pending/selected timeout refunds. Earned packs require actual net yield, not principal funding.
- Routes: check every eligible stock for live quote, issuer transfer restrictions, Token-2022 extensions and full atomic transaction simulation. Remove unsupported stocks from the new manifest **before** activation; do not silently change an existing pack's odds.

Record signatures, slots, raw deltas and build hash in a release evidence file. Local runtime tests do not replace these steps.

## Vercel

Deploy the Next.js application with Node 22, `npm ci`, and `npm run build`. Add only server API credentials and public protocol/treasury configuration. Do not put admin, program or solver private keys in Vercel. The worker needs a separate persistent host. It is prepared locally for testing, but a laptop is not an always-on production worker. Configure production endpoint rate limits/WAF and monitoring before exposing funded flows; the app's request-size/method checks are not distributed rate limiting.

## Material limits to resolve before a public production release

- Authenticated quotes succeeded for all 39 candidate pack stocks. A captured-mainnet BABA Jupiter CPI passed locally, including Token-2022 and its route programs. This is one route, not blanket issuer eligibility or funded settlement evidence. No funded mainnet flow has passed yet.
- The Kamino adapter traverses reserve groups in one atomic redemption. Incomplete liquidity, a failing reserve CPI, or a transaction exceeding Solana compute/account/packet limits causes a rollback. For routed order fills, the worker selects the largest reserve prefix that fits with the swap and retries narrower Jupiter routes if necessary. Full redemption remains mandatory: insufficient liquidity rolls back the entire swap. Inventory-only settlement and user exits retain all reserve groups. The checked vault has four reserve groups; substantially different vault layouts require fresh validation. Vault curator changes, venue fees, losses and redemption availability remain dependencies; yield is variable and principal value is not guaranteed by this application.
- Token transfer hooks are forwarded and net transfer amounts are enforced, but active issuer-hook eligibility and paused/frozen token behavior must be tested with the real issuer assets. Feed matching is not an eligibility certification.
- `npm audit --omit=dev` currently reports 41 dependency findings (23 high, 18 moderate), including upstream Solana SDK transitive dependencies. No forced downgrade was applied. Review reachable paths and supported fixes before production; do not describe this build as security-audited.
- Deployment authority custody, public API abuse controls, worker monitoring and incident procedures require the actual hosting/wallet setup. Historical portfolio USD valuation and automated oracle-rent reclamation are not implemented.

## Optional Lucky opening

See [LUCKY.md](LUCKY.md) for fixed odds, custody, timeout behavior, reserve operations and launch gates. Lucky is independently disabled by default; regular protocol activation never enables it. The updated Pack layout requires a fresh deployment or explicit migration. Do not use older deployment size/rent estimates for the updated binary.
