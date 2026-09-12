/** Find an indicative input from live ExactIn routes; never an execution guarantee. */
export async function estimateInput<
  T extends { inAmount: string; outAmount: string },
>(
  desired: bigint,
  initial: bigint,
  quote: (amount: bigint) => Promise<T>,
): Promise<T> {
  let q = await quote(initial);
  for (let i = 0; i < 3; i++) {
    const current = BigInt(q.outAmount);
    if (current <= 0n) throw new Error("No output liquidity.");
    const next = (BigInt(q.inAmount) * desired + current - 1n) / current;
    if (next === BigInt(q.inAmount)) break;
    q = await quote(next);
  }
  const output = BigInt(q.outAmount);
  const difference = output > desired ? output - desired : desired - output;
  if (difference * 10000n > desired * 50n)
    throw new Error(
      "Unable to estimate this quantity reliably. Enter a pay amount.",
    );
  return q;
}
