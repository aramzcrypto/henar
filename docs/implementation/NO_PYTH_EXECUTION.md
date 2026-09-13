# Pyth-free execution status — 13 September 2026

Implementation and verification are complete; see [release report](../ORACLE_FREE_RELEASE_2026-09-13.md) for the exact tested artifact, transactions and remaining deployment steps.

The new swapPosition instruction and worker execute Limit, DCA and stock-yield directly through Jupiter with atomic balance checks and no Pyth calls. All 26 contract runtime tests and 84 application tests pass. Actual captured Jupiter/Kamino programs are included in the runtime checks; these are local synthetic positions, not completed mainnet user trades.

Mainnet currently allows Earn, Packs and Lucky for EYVq1MrwT5mfsh8kJLw645ARKK3uP4ja3UcTzb8ULcff, retaining the 25 USDC cumulative cap. The pool is funded with 25 USDC, and the local persistent worker is running. Live one-pack purchase simulation passes. The deployment wallet needs approximately 0.81 SOL additional temporary buffer funding; 1 SOL was requested from the user. Do not close the existing program or remove the allowlist to bypass this requirement.

Next: fund/upload the tested 0eff264f release, verify its bytes and retained authority, enable the remaining product flags, publish matching IDL/app, and verify live transaction previews. Reconcile every uncertain signature before any retry. Actual user transactions require the user's wallet signature; earned packs require real accrued net yield. The local worker requires the development Mac to remain available during restricted testing.
