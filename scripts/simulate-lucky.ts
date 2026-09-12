/** Offline synthetic reserve stress test. NEVER used to select real pack outcomes. */
import { luckyPayout, canReserveLucky } from "../src/lib/lucky";
let seed = 0x4b414e49;
function bucket() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return Math.floor(((seed >>> 0) / 4294967296) * 100);
}
const stake = 9_800_000n;
const results = [];
for (const initial of [100_000_000n, 1_000_000_000n])
  for (const policy of ["bank", "roll-once"] as const) {
    const runs = [];
    for (let run = 0; run < 200; run++) {
      let reserve = initial,
        fees = 0n,
        paid = 0n,
        accepted = 0,
        blocked = 0,
        rollBlocked = 0;
      for (let batch = 0; batch < 50; batch++) {
        const pending: bigint[] = [];
        for (let i = 0; i < 20; i++) {
          if (!canReserveLucky(stake, reserve, 20_000_000n)) {
            blocked++;
            continue;
          }
          reserve -= stake;
          fees += 200_000n;
          accepted++;
          pending.push(stake);
        }
        const second: bigint[] = [];
        for (const amount of pending) {
          const reward = luckyPayout(amount, bucket());
          reserve += 2n * amount - reward;
          if (
            policy === "roll-once" &&
            canReserveLucky(reward, reserve, 20_000_000n)
          ) {
            reserve -= reward;
            second.push(reward);
          } else {
            paid += reward;
            if (policy === "roll-once") rollBlocked++;
          }
        }
        for (const amount of second) {
          const reward = luckyPayout(amount, bucket());
          reserve += 2n * amount - reward;
          paid += reward;
        }
        if (
          reserve < 0n ||
          reserve + paid + fees !== initial + BigInt(accepted) * 10_000_000n
        )
          throw new Error("Solvency/conservation violation.");
      }
      runs.push({ reserve: Number(reserve) / 1e6, blocked, rollBlocked });
    }
    const sorted = runs.map((r) => r.reserve).sort((a, b) => a - b);
    results.push({
      initialReserveUSDC: Number(initial) / 1e6,
      policy,
      runs: runs.length,
      purchaseAttemptsPerRun: 1000,
      maxConcurrentFirstRolls: 20,
      minimumFinalReserveUSDC: sorted[0],
      medianFinalReserveUSDC: sorted[100],
      maximumFinalReserveUSDC: sorted[199],
      runsEndingBelowInitial: runs.filter(
        (r) => r.reserve < Number(initial) / 1e6,
      ).length,
      runsWithPurchaseRejections: runs.filter((r) => r.blocked > 0).length,
      runsWithRolloverRejections: runs.filter((r) => r.rollBlocked > 0).length,
    });
  }
console.log(
  JSON.stringify(
    {
      synthetic: true,
      seed: "0x4b414e49",
      feesExcludeOperatingCosts: true,
      results,
    },
    null,
    2,
  ),
);
