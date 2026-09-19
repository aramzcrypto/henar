/**
 * Price impact, to the same two decimals as every other percentage in the
 * ticket. It was rendered raw, so a quote showed "0.05048302673706992%" in a
 * column of formatted values.
 *
 * Rounding alone would print "0.00%" for a real impact, which reads as none at
 * all, so anything that rounds to zero without being zero is shown as its
 * bound instead.
 */
export function formatPriceImpact(fraction: number) {
  if (!Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  if (pct === 0) return "0.00%";
  if (Math.abs(pct) < 0.01) return `${pct < 0 ? ">-" : "<"}0.01%`;
  return `${pct.toFixed(2)}%`;
}
