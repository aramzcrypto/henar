# Mainnet setup and operations

Status: the Kani Markets website is deployed; the Solana program is built but not deployed or funded. Helius and Jupiter credentials are configured. Pyth trial credentials are local, but the trial does not cover the 39-stock pack manifest. Packs now use Jupiter directly without Pyth; automated positions retain oracle safeguards. No funded mainnet flow or independent security audit has passed. The initial program configuration is paused.

Public website: [Kani Markets](https://kanimarkets.vercel.app). Website deployment does not deploy the Solana program.

## Testing setup

The test program address is `7EMrgJNodNBmuQBg3cv9ASDUmXQFYp1VRiHcCzUMaC7E`. Admin/deployment funding address: `ACbdckvGrWj6Qifeq99daEeYz4WzVk5u2uUgK6crNkwx`. Keys are local-only in `.secrets` with restrictive permissions; these files are excluded from Vercel uploads. Never put private keys in deployment settings.

Run `npm run mainnet:status` for fresh balances and deployment status. Operational scripts now load `.env.local` automatically; exported environment values take precedence. `npm run mainnet:routes` verifies live Jupiter quotes. `npm run mainnet:packets` checks the actual vault packet layout.

## Final inputs

| Input | Where | Purpose |
| --- | --- | --- |
| `SOLANA_RPC_URL` | Vercel server and worker | Mainnet RPC with account reads, simulation and transaction submission |
| `JUPITER_API_KEY` | Vercel server and worker | Market and pack routing; optional position routing |
| `PYTH_API_KEY` | Worker and local verification | Optional for oracle-gated positions; not required for packs |
| `STOCKROOM_TREASURY_OWNER` | Server and local setup | Public wallet receiving protocol fees |
| `STOCKROOM_LOOKUP_TABLE` | Server and worker | Public lookup table created by the setup command |
| `STOCKROOM_PROGRAM_ID` | Server and worker | Public address of the exact deployed build |
| `STOCKROOM_PROGRAM_KEYPAIR_PATH` | Local deployment only | Program identity file, mode 0600 |
| `STOCKROOM_ADMIN_KEYPAIR_PATH` | Local deployment only | Funded upgrade/configuration authority, mode 0600 |
| `SOLVER_KEYPAIR_PATH` | Persistent worker only | Limited operational wallet, mode 0600 |

Get Jupiter access through its [developer portal](https://developers.jup.ag/portal). **No paid Pyth plan is needed for Market or Packs.** Current oracle-gated Limit/DCA/yield-stock settlement still requires entitled feeds. The optional Pyth adapter uses the official upgraded receiver and authenticated `pyth.dourolabs.app/hermes` endpoint. Do not enable those position fills without verifying coverage. See [PACK_EXECUTION.md](PACK_EXECUTION.md) for the pack execution trust model.

`STOCKROOM_FEE_ACCOUNT` and `STOCKROOM_FEE_ACCOUNTS` remain optional explicit Market fee-account overrides. Otherwise, the server derives canonical treasury ATAs from `STOCKROOM_TREASURY_OWNER` and verifies that they exist. These are public account addresses, not credentials.

Jupiter V2 `/build` does not return the legacy platform-fee object. Market fees are explicit atomic token transfers: input-USDC fees reduce the swap budget, while output-token fees reduce the quoted stock receipt and minimum by the same disclosed fixed fee. No Titan integration/key is required for V1. Jupiter `/build` provides composable swap instructions; additional routing providers can be evaluated against actual stock execution quality later.

## Rebuild and deploy

1. Create or choose local program/admin key files with permissions 0600. Keep their contents private. The generated development placeholder and build-generated test identity must not be funded or used as production identities.
2. Set the public address using `npm run program:address -- <public-program-address>`. Set the corresponding environment variables. Run `npm run contracts:build` and all app checks. This regenerates IDL/address bindings.
3. Run `npm run mainnet:cost`. It queries actual rent for the current executable. The current checked build is 922,072 bytes: approximately **4.6858 SOL persistent program rent**, with a conservative **9.3708 SOL peak rent allowance** including the temporary deployment buffer, before transaction fees and account setup. Recalculate after the final address/build; these are RPC rent results, not fiat price estimates.
4. Deploy the checked binary with Solana CLI, explicit program key, admin upgrade authority and fee payer, mainnet RPC, `--max-len` equal to the binary size, and `--use-rpc`. The cost script prints the command template. Retain upgradeability for the controlled test phase; do not accidentally pass `--final`.
5. Run `npm run mainnet:plan`, review `config/mainnet-manifest.json`, then `npm run mainnet:setup`. Setup creates the USDC treasury ATA, initializes paused configuration, uploads stocks in packet-sized chunks, and seals/activates the manifest. It checks resumed uploads against the intended contents and refuses an already-unpaused configuration.
6. Run `npm run treasury:plan`, then `npm run treasury:setup` to create missing fee accounts for the V1 manifest. Add `-- --all` to plan/setup for the wider Market catalog; review the larger rent requirement first. It is idempotent and creates accounts with the correct SPL/Token-2022 program.
7. Run `npm run mainnet:lookup:plan`, then `npm run mainnet:lookup:setup`. This builds the protocol lookup table under the local admin, verifies every address, and saves its public address in `.env.local`. Add `STOCKROOM_LOOKUP_TABLE` to the Vercel preview environment and redeploy. Setup reconciles an uncertain prior signature before submitting a replacement.
8. Run `npm run protocol:preflight`. It verifies mainnet genesis, deployed executable bytes against the local build, vault/share mint, canonical programs, treasury, sealed manifest, extensions, configured credentials and pack quote authority. Add `-- --with-oracles` to separately check position oracle coverage. It does **not** certify a funded trade or economic safety.

## Worker

Run one persistent worker per state directory, outside Vercel. Export the worker environment, set `SOLVER_MAX_SETTLEMENT_USDC_BASE_UNITS` explicitly, then:

```sh
npm run solver:check
npm run solver:start
```

Packs always use direct Jupiter CPI from pack escrow to the owner's stock account; the worker needs SOL for fees/rent, not USDC or stock inventory. Configure its public key using `npm run packs:execution -- enable` (plan) then `--execute` after deployment and verification. This adds an explicit, capped quote-service authority.

Position stock fills remain disabled unless `SOLVER_EXECUTE_POSITIONS=true`. For those oracle-gated fills only, `SOLVER_ROUTE_STOCKS=true` enables Jupiter routing instead of stock inventory; those fills still front capital and require Pyth feed coverage. USDC harvest and yield-earned sealed pack creation do not require this position-fill opt-in.

Persist `SOLVER_STATE_DIR` on durable storage. `worker.lock` prevents concurrent use of the same directory. `journal.json` records signatures before broadcasting. Reconcile all recorded signatures before removing a stale lock, restoring backups, or moving hosts. Never retry solely because an RPC request timed out. `health.json` is the heartbeat; alert on stale timestamps and repeated job errors. A process manager should restart crashes, not delete the journal.

Pyth update accounts close only after confirmed consumption. If a submission is uncertain, they remain open rather than risk invalidating an in-flight settlement. Reclaim orphan oracle-account rent only after reconciling the recorded transactions; automated orphan reclamation is not implemented.

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
