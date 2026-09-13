import Decimal from "decimal.js";
import { formatUnits } from "../amount";

type PrincipalAccount = {
  principalBasis: { toString(): string };
};

export function principalTvl(accounts: PrincipalAccount[]) {
  return formatUnits(
    accounts.reduce(
      (total, account) => total + BigInt(account.principalBasis.toString()),
      0n,
    ),
    6,
    6,
  );
}

export function exactDecimal(value: string) {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function compactUsdc(value: string) {
  const amount = new Decimal(value);
  const units = [
    { threshold: new Decimal(1_000_000_000), suffix: "B" },
    { threshold: new Decimal(1_000_000), suffix: "M" },
    { threshold: new Decimal(1_000), suffix: "K" },
  ];
  const unit = units.find(({ threshold }) => amount.abs().gte(threshold));
  if (unit)
    return `${amount.div(unit.threshold).toDecimalPlaces(1).toString()}${unit.suffix}`;
  return exactDecimal(amount.toDecimalPlaces(2).toString());
}
