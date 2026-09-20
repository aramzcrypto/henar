import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { EquityLogo } from "./equity-logo";
import type { IssuerMeasure, IssuerProfileData, SourceStatus } from "@/lib/issuers/types";

const STATUS_LABEL: Record<SourceStatus, string> = {
  available: "Live",
  unavailable: "Unavailable",
  not_configured: "Not configured",
};

function usd(value: number | null) {
  if (value === null) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function measureValue(measure: IssuerMeasure) {
  if (measure.value === null) return "—";
  if (typeof measure.value === "string") return measure.value;
  if (measure.unit === "usd") return usd(measure.value);
  if (measure.unit === "percent") return `${measure.value.toFixed(2)}%`;
  if (measure.unit === "ratio") return `${measure.value.toFixed(2)}×`;
  return measure.value.toLocaleString();
}

function Measures({ measures }: { measures: IssuerMeasure[] }) {
  return (
    <dl className="issuer-measures">
      {measures.map((measure) => (
        <div key={measure.id}>
          <dt>
            {measure.label}
            {measure.detail ? <small>{measure.detail}</small> : null}
          </dt>
          <dd>{measureValue(measure)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One issuer's profile.
 *
 * Reached by selecting an issuer in the Markets comparison rather than from a
 * menu: an issuer is something a reader arrives at from a number they were
 * already looking at, not a destination they browse to.
 *
 * Every block names its source and its own availability, so a reader can tell
 * the issuer's claim about itself from Henar's measurement of it.
 */
export function IssuerProfile({ data }: { data: IssuerProfileData }) {
  const { profile, catalog, market, disclosure, external, sources, peers } = data;
  const reserves = disclosure.reserves;
  return (
    <section className="markets-shell">
      <nav className="issuer-breadcrumb">
        <Link href="/markets">
          <ArrowLeft size={13} /> Markets
        </Link>
        <span>Issuers</span>
        <strong>{profile.label}</strong>
      </nav>

      <header className="issuer-hero">
        <span className="issuer-hero-mark">
          <Image src={profile.logo} alt="" width={34} height={34} />
        </span>
        <div className="issuer-hero-text">
          <h1>{profile.label}</h1>
          <p>{profile.instrument}</p>
          <small>
            Issued by {profile.issuer}
            {profile.tokenSuffix
              ? ` · tokens carry the suffix “${profile.tokenSuffix}”`
              : " · tokens carry the plain ticker"}
          </small>
        </div>
        <div className="issuer-hero-links">
          <a href={profile.issuerUrl} target="_blank" rel="noreferrer">
            Issuer site <ArrowUpRight size={12} />
          </a>
          <a href={profile.docsUrl} target="_blank" rel="noreferrer">
            Documentation <ArrowUpRight size={12} />
          </a>
          {profile.apiUrl ? (
            <a href={profile.apiUrl} target="_blank" rel="noreferrer">
              Public API <ArrowUpRight size={12} />
            </a>
          ) : null}
        </div>
      </header>

      <dl className="issuer-keystats">
        <div>
          <dt>Representations</dt>
          <dd>{catalog.representations.toLocaleString()}</dd>
        </div>
        <div>
          <dt>24h volume</dt>
          <dd>{usd(market.volume24hUsd)}</dd>
        </div>
        <div>
          <dt>Liquidity</dt>
          <dd>{usd(market.liquidityUsd)}</dd>
        </div>
        <div>
          <dt>Traded in 24h</dt>
          <dd>{market.tradedMints.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Token holders</dt>
          <dd>{market.holders === null ? "—" : market.holders.toLocaleString()}</dd>
        </div>
      </dl>

      <div className="issuer-panel-grid">
        <section>
          <h3>In Henar&apos;s catalog</h3>
          <dl className="issuer-measures">
            <div>
              <dt>Companies</dt>
              <dd>{catalog.companies.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Representations</dt>
              <dd>{catalog.representations.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Stocks / ETFs</dt>
              <dd>
                {catalog.stocks.toLocaleString()} / {catalog.etfs.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>
                Only this issuer
                <small>Companies no other issuer represents</small>
              </dt>
              <dd>{catalog.soleIssuer.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Represented by all three</dt>
              <dd>{catalog.sharedWithAll.toLocaleString()}</dd>
            </div>
          </dl>
          {profile.redemptionModel ? (
            <p className="onchain-method">Redemption · {profile.redemptionModel}</p>
          ) : null}
        </section>

        <section>
          <h3>On Solana</h3>
          {market.status === "available" ? (
            <>
              <dl className="issuer-measures">
                <div>
                  <dt>24h volume</dt>
                  <dd>{usd(market.volume24hUsd)}</dd>
                </div>
                <div>
                  <dt>Pooled liquidity</dt>
                  <dd>{usd(market.liquidityUsd)}</dd>
                </div>
                <div>
                  <dt>
                    Mints traded in 24h
                    <small>Of {market.mintsQueried.toLocaleString()} verified mints</small>
                  </dt>
                  <dd>{market.tradedMints.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Mints with pooled liquidity</dt>
                  <dd>{market.mintsWithLiquidity.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Token holders</dt>
                  <dd>{market.holders === null ? "—" : market.holders.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>
                    Traders, 24h
                    <small>
                      Summed per mint, so a wallet trading two of this issuer&apos;s tokens
                      counts twice
                    </small>
                  </dt>
                  <dd>{market.traders24h === null ? "—" : market.traders24h.toLocaleString()}</dd>
                </div>
              </dl>
              {market.reason ? <p className="onchain-method">{market.reason}</p> : null}
            </>
          ) : (
            <p className="fin-empty">{market.reason ?? "Unavailable"}</p>
          )}
        </section>

        <section>
          <h3>
            The issuer&apos;s own source
            <span className={`issuer-status is-${disclosure.status}`}>
              {STATUS_LABEL[disclosure.status]}
            </span>
          </h3>
          {disclosure.status === "available" ? (
            <>
              <Measures measures={disclosure.measures} />
              {disclosure.networks.length ? (
                <p className="onchain-method">Chains · {disclosure.networks.join(", ")}</p>
              ) : null}
            </>
          ) : (
            <p className="fin-empty">
              {disclosure.reason ?? "This issuer publishes no public source Henar can read."}
            </p>
          )}
        </section>

        {external ? (
          <section>
            <h3>
              Token Terminal
              <span className={`issuer-status is-${external.status}`}>
                {STATUS_LABEL[external.status]}
              </span>
            </h3>
            {external.status === "available" ? (
              <Measures measures={external.measures} />
            ) : (
              <p className="fin-empty">{external.reason}</p>
            )}
          </section>
        ) : null}
      </div>

      {reserves && reserves.status === "available" ? (
        <section className="issuer-reserves">
          <header>
            <strong>Proof of reserves</strong>
            <small>
              Shares the issuer reports holding against the circulating token supply, as the
              issuer states it
            </small>
          </header>
          <dl className="issuer-measures">
            <div>
              <dt>Assets with a reserve record</dt>
              <dd>{reserves.assets.toLocaleString()}</dd>
            </div>
            <div>
              <dt>
                At or above 1:1
                <small>Of {reserves.comparable.toLocaleString()} with tokens outstanding</small>
              </dt>
              <dd>{reserves.fullyBacked.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Lowest reported ratio</dt>
              <dd>{reserves.minRatio === null ? "—" : `${reserves.minRatio.toFixed(4)}×`}</dd>
            </div>
            <div>
              <dt>Median ratio</dt>
              <dd>{reserves.medianRatio === null ? "—" : `${reserves.medianRatio.toFixed(2)}×`}</dd>
            </div>
            {reserves.custodians.map((custodian) => (
              <div key={custodian.name}>
                <dt>Custodian · {custodian.name}</dt>
                <dd>{custodian.assets.toLocaleString()} assets</dd>
              </div>
            ))}
          </dl>
          <p className="onchain-method">
            Read from the issuer&apos;s published reserve records
            {reserves.observedAt
              ? ` · issuer timestamp ${new Date(reserves.observedAt).toLocaleString()}`
              : ""}
            . Henar repeats the issuer&apos;s figures and does not independently verify custody.
          </p>
        </section>
      ) : null}

      {market.top.length ? (
        <section className="issuer-top">
          <header>
            <strong>Most traded</strong>
            <small>This issuer&apos;s own tokens, by 24h volume on Solana</small>
          </header>
          <ol>
            {market.top.map((row) => (
              <li key={row.mint}>
                <Link href={`/markets/${row.ticker}`}>
                  <EquityLogo logo={row.logo} ticker={row.ticker} size={24} />
                  <span>
                    <b>{row.tokenSymbol}</b>
                    <i>{row.name}</i>
                  </span>
                  <u>{usd(row.volume24hUsd)}</u>
                  <em>{row.liquidityUsd === null ? "—" : usd(row.liquidityUsd)}</em>
                </Link>
              </li>
            ))}
          </ol>
          <p className="onchain-method">Volume, then the pooled liquidity behind it.</p>
        </section>
      ) : null}

      <section className="issuer-sources">
        <header>
          <strong>Where every figure came from</strong>
          <small>
            Each source answers for itself; one being unavailable never fills in for another
          </small>
        </header>
        <ul>
          {sources.map((source) => (
            <li key={source.id}>
              <span className={`issuer-status is-${source.status}`}>
                {STATUS_LABEL[source.status]}
              </span>
              <span>
                <strong>{source.label}</strong>
                <small>{source.role}</small>
                {source.reason ? <em>{source.reason}</em> : null}
              </span>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  Source <ArrowUpRight size={12} />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="onchain-method">Read {new Date(data.generatedAt).toLocaleString()}.</p>
      </section>

      <nav className="issuer-peers">
        <span>Other issuers</span>
        {peers.map((peer) => (
          <Link key={peer.id} href={`/markets/issuers/${peer.id}`}>
            <Image src={peer.logo} alt="" width={20} height={20} />
            {peer.label}
            <ArrowUpRight size={12} />
          </Link>
        ))}
      </nav>
    </section>
  );
}
