import Image from "next/image";
import { EquityLogo } from "./equity-logo";

/**
 * The thesis as a diagram: three issuer tokens for one company, converging
 * through Henar into a single market.
 *
 * Deliberately static. The previous panel drew a live volume chart, which
 * cost a fetch on first paint and illustrated nothing a visitor could not
 * already see on /markets. This states the argument instead.
 *
 * The geometry is fixed rather than fluid: rows are ROW_H tall with ROW_GAP
 * between them, so the connector endpoints land on row centres exactly. A
 * fluid column would need preserveAspectRatio="none", which shears the
 * curves. Keep these three constants in step with the CSS.
 */
type Representation = { provider: string; symbol: string };

const ROW_H = 56;
const ROW_GAP = 10;
const JOIN_W = 112;
const MARK_R = 23;

const COL_H = ROW_H * 3 + ROW_GAP * 2;
const MID = COL_H / 2;
const ROWS = [ROW_H / 2, MID, COL_H - ROW_H / 2];
const HUB_X = JOIN_W / 2;

export const ISSUER_LABELS: Record<string, string> = {
  xstocks: "xStocks",
  backpack: "Backpack",
  ondo: "Ondo",
};

export const ISSUER_LOGOS: Record<string, string> = {
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
    <figure
      className="unify"
      aria-label={`${company} across ${representations.length} issuers`}
    >
      <header className="unify-head">
        <span className="unify-label">Issuer representations</span>
        <span className="unify-chain">
          <Image
            src="/logos/issuers/solana.svg"
            alt="Solana"
            width={62}
            height={13}
          />
        </span>
      </header>

      <div className="unify-body">
        <div className="unify-issuers">
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

        {/* One SVG for every connector so the curves meet the hub exactly. */}
        <div className="unify-join">
          <svg
            className="unify-wires"
            viewBox={`0 0 ${JOIN_W} ${COL_H}`}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="unify-wire" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(70,179,168,0.07)" />
                <stop offset="100%" stopColor="rgba(70,179,168,0.55)" />
              </linearGradient>
            </defs>
            {ROWS.map((y) => (
              <path
                key={y}
                d={`M 0 ${y} C ${HUB_X * 0.62} ${y}, ${HUB_X * 0.5} ${MID}, ${HUB_X - MARK_R} ${MID}`}
                fill="none"
                stroke="url(#unify-wire)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            ))}
            <path
              d={`M ${HUB_X + MARK_R} ${MID} H ${JOIN_W}`}
              fill="none"
              stroke="rgba(70,179,168,0.55)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span className="unify-mark">
            <Image src="/brand/henar.png" alt="Henar" width={26} height={26} />
          </span>
        </div>

        <div className="unify-result">
          <span className="unify-result-label">One market</span>
          <div className="unify-company">
            <EquityLogo logo={logo} ticker={ticker} size={38} />
            <span>
              <b>{company}</b>
              <i>{ticker}</i>
            </span>
          </div>
          <div className="unify-merged">
            {representations.map((item) => (
              <Image
                key={item.provider}
                src={ISSUER_LOGOS[item.provider]}
                alt=""
                width={15}
                height={15}
              />
            ))}
            <span>{representations.length} representations unified</span>
          </div>
        </div>
      </div>
    </figure>
  );
}
