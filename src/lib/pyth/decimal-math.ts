/**
 * Exact decimal arithmetic for market references. Prices arrive as integer
 * mantissas with an exponent; comparisons are done on rationals (bigint
 * numerator / denominator) and reported in basis points. No floats.
 */
export type Rational = { num: bigint; den: bigint };

/** `mantissa × 10^exponent` as a plain decimal string. */
export function scaleMantissa(mantissa: string | number | bigint, exponent: number): string {
  const raw = BigInt(mantissa);
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  let text: string;
  if (exponent >= 0) text = (abs * 10n ** BigInt(exponent)).toString();
  else {
    const digits = abs.toString().padStart(-exponent + 1, "0");
    const point = digits.length + exponent;
    text = `${digits.slice(0, point)}.${digits.slice(point)}`.replace(/\.?0+$/, "");
    if (text.endsWith(".")) text = text.slice(0, -1);
    if (text === "") text = "0";
  }
  return negative ? `-${text}` : text;
}

/** Parse a non-negative decimal string exactly. Null when malformed. */
export function parseDecimal(value: string | null | undefined): Rational | null {
  if (value === null || value === undefined) return null;
  const m = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(value);
  if (!m) return null;
  const frac = m[2] ?? "";
  return { num: BigInt(m[1] + frac), den: 10n ** BigInt(frac.length) };
}

export function isPositive(r: Rational | null): r is Rational {
  return r !== null && r.num > 0n && r.den > 0n;
}

export function multiply(a: Rational, b: Rational): Rational {
  return { num: a.num * b.num, den: a.den * b.den };
}

export function divide(a: Rational, b: Rational): Rational | null {
  if (b.num === 0n) return null;
  return { num: a.num * b.den, den: a.den * b.num };
}

/** (a / b − 1) in basis points, rounded half away from zero. Null when b is zero. */
export function relativeBps(a: Rational, b: Rational): number | null {
  const left = a.num * b.den;
  const right = b.num * a.den;
  if (right === 0n) return null;
  const diff = (left - right) * 10_000n;
  const half = right / 2n;
  const rounded = diff >= 0n ? (diff + half) / right : -((-diff + half) / right);
  return Number(rounded);
}

/** a / b in basis points (e.g. confidence / price). Null when b is zero. */
export function ratioBps(a: Rational, b: Rational): number | null {
  const left = a.num * b.den * 10_000n;
  const right = b.num * a.den;
  if (right === 0n) return null;
  return Number((left + right / 2n) / right);
}

/** Fixed-point decimal string of a rational with `places` decimals (truncated). */
export function formatRational(r: Rational, places = 6): string {
  const scale = 10n ** BigInt(places);
  const whole = (r.num * scale) / r.den;
  const text = whole.toString().padStart(places + 1, "0");
  const point = text.length - places;
  return places ? `${text.slice(0, point)}.${text.slice(point)}`.replace(/\.?0+$/, "") || "0" : text;
}
