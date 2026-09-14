import Image from "next/image";
import { EquityLogo } from "./equity-logo";

/**
 * The thesis as a diagram: three issuer tokens for one company, converging
 * through Henar into a single market.
 *
 * Deliberately static. The previous panel drew a live volume chart, which
 * cost a fetch on first paint and illustrated nothing a visitor could not
 * already see on /markets. This states the argument instead.
 */
type Representation = { provider: string; symbol: string };

const ISSUER_LABELS: Record<string, string> = {
  xstocks: "xStocks",
  backpack: "Backpack",
  ondo: "Ondo",
};

const ISSUER_LOGOS: Record<string, string> = {
  xstocks: "/logos/issuers/xstocks.svg",
  backpack: "/logos/issuers/backpack.svg",
  ondo: "/logos/issuers/ondo.svg",
};

export function LandingUnify({
  company,
  ticker,
  logo,
  representations,
}: {
  company: string;
  ticker: string;
  logo: string | null;
  representations: Representation[];
}) {
  return (
    <figure className="unify" aria-label={`${company} across ${representations.length} issuers`}>
      <div className="unify-issuers">
        <span className="unify-label">Issuer representations</span>
        {representations.map((item) => (
          <div key={item.provider} className="unify-token">
            <Image
              src={ISSUER_LOGOS[item.provider]}
              alt=""
              width={18}
              height={18}
            />
            <b>{item.symbol}</b>
            <i>{ISSUER_LABELS[item.provider] ?? item.provider}</i>
          </div>
        ))}
      </div>

      {/* Connectors drawn as one SVG so the curves meet the hub exactly. */}
      <svg className="unify-wires" viewBox="0 0 120 220" aria-hidden="true">
        <defs>
          <linearGradient id="unify-wire" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(70,179,168,0.08)" />
            <stop offset="100%" stopColor="rgba(70,179,168,0.5)" />
          </linearGradient>
        </defs>
        {[38, 110, 182].map((y) => (
          <path
            key={y}
            d={`M 0 ${y} C 58 ${y}, 62 110, 120 110`}
            fill="none"
            stroke="url(#unify-wire)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        ))}
      </svg>

      <div className="unify-hub">
        <span className="unify-mark">
          <Image src="/brand/henar.png" alt="" width={30} height={30} />
        </span>
        <div className="unify-result">
          <EquityLogo logo={logo} ticker={ticker} size={34} />
          <span>
            <b>{company}</b>
            <i>One market · {representations.length} representations</i>
          </span>
        </div>
        <span className="unify-chain">
          <Image src="/logos/issuers/solana.svg" alt="Solana" width={62} height={13} />
        </span>
      </div>
    </figure>
  );
}
