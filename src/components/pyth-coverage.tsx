import Link from "next/link";
import type { PythCoverage } from "@/lib/pyth/types";

const AVAILABILITY: Record<string, string> = {
  AVAILABLE: "Available",
  CATALOG_ONLY: "Catalog only",
  NOT_ENTITLED: "Not entitled",
  STALE: "Stale",
  UNAVAILABLE: "Unavailable",
  INVALID: "Invalid key",
  NOT_CONFIGURED: "Not configured",
};

const PROVIDER: Record<string, string> = { xstocks: "xStocks", backpack: "Backpack", ondo: "Ondo" };

function ratio(a: number | null, b: number) {
  return a === null ? `— / ${b.toLocaleString()}` : `${a.toLocaleString()} / ${b.toLocaleString()}`;
}

/**
 * The data/provenance surface: what Pyth's catalog covers of Henar's
 * universe, what the current key can read, and what widens when the
 * entitlement does. Every count is a runtime measurement.
 */
export function PythCoveragePanel({ coverage, enabled }: { coverage: PythCoverage | null; enabled: boolean }) {
  if (!enabled)
    return (
      <div className="pyth-coverage">
        <header>
          <span>PYTH PRO DATA</span>
          <h2>Market data is switched off</h2>
          <p>HENAR_PYTH_PRO is off on this deployment.</p>
        </header>
      </div>
    );
  if (!coverage)
    return (
      <div className="pyth-coverage">
        <header>
          <span>PYTH PRO DATA</span>
          <h2>Coverage unavailable</h2>
          <p>The Pyth catalog could not be read. Nothing is estimated in its place.</p>
        </header>
      </div>
    );
  const c = coverage.coverage;
  const e = coverage.entitlement;
  const probed = coverage.probe;
  return (
    <div className="pyth-coverage">
      <header>
        <span>PYTH PRO DATA</span>
        <h2>Current coverage</h2>
        <p>
          One data architecture, sized by entitlement. A broader Pyth Pro key adds feeds, channels and history; nothing else changes.
        </p>
      </header>
      <div className="pyth-coverage-grid">
        <section>
          <h3>Henar universe</h3>
          <dl>
            <div>
              <dt>Underlying equities mapped</dt>
              <dd>{ratio(c.underlyingMapped, c.companies)}</dd>
            </div>
            <div>
              <dt>Tokenized equities mapped</dt>
              <dd>{ratio(c.tokenizedMapped, c.representations)}</dd>
            </div>
            {Object.entries(c.byProvider).map(([provider, p]) => (
              <div key={provider}>
                <dt>{PROVIDER[provider] ?? provider} representations mapped</dt>
                <dd>{ratio(p.mapped, p.representations)}</dd>
              </div>
            ))}
            <div>
              <dt>Redemption-rate feeds</dt>
              <dd>{c.redemptionRatesMapped.toLocaleString()}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Current entitlement</h3>
          <dl>
            <div>
              <dt>Key</dt>
              <dd>{e.keyConfigured ? "Configured (server-side)" : "Not configured"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{AVAILABILITY[e.status] ?? e.status}</dd>
            </div>
            {probed ? (
              <>
                <div>
                  <dt>Feeds accessible (probe)</dt>
                  <dd>{`${probed.feedsAccessible} / ${probed.feedsProbed}`}</dd>
                </div>
                <div>
                  <dt>Underlying accessible</dt>
                  <dd>{ratio(c.underlyingAccessible, Math.min(probed.sampleSize, c.underlyingMapped))}</dd>
                </div>
                <div>
                  <dt>Tokenized accessible</dt>
                  <dd>{ratio(c.tokenizedAccessible, c.tokenizedMapped)}</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>Real-time data</dt>
              <dd>{e.channels.real_time ? `${AVAILABILITY[e.channels.real_time]}${c.realTimeFeeds !== null ? ` · ${c.realTimeFeeds} feeds` : ""}` : "Not probed"}</dd>
            </div>
            <div>
              <dt>Historical data</dt>
              <dd>{`${AVAILABILITY[e.history] ?? e.history}${c.historicalFeeds !== null ? ` · ${c.historicalFeeds} feeds` : ""}`}</dd>
            </div>
            {Object.entries(e.channels)
              .filter(([k]) => k !== "real_time")
              .map(([channel, status]) => (
                <div key={channel}>
                  <dt>{channel}</dt>
                  <dd>{AVAILABILITY[status] ?? status}</dd>
                </div>
              ))}
          </dl>
          <p className="onchain-method">{e.detail || "Entitlement measured per feed."}</p>
        </section>
        <section>
          <h3>Pyth catalog</h3>
          <dl>
            <div>
              <dt>Feeds in catalog</dt>
              <dd>{coverage.catalog.totalFeeds.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Equity feeds</dt>
              <dd>{coverage.catalog.equityFeeds.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Tokenized-equity feeds</dt>
              <dd>{coverage.catalog.tokenizedEquityFeeds.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Additional feeds with expanded entitlement</dt>
              <dd>{c.additionalWithEntitlement === null ? "Unknown until a key is configured" : c.additionalWithEntitlement.toLocaleString()}</dd>
            </div>
          </dl>
          <p className="onchain-method">Catalog read {coverage.catalog.fetchedAt ? new Date(coverage.catalog.fetchedAt).toLocaleString() : "unavailable"}.</p>
        </section>
      </div>
      <p className="onchain-method">
        Measured {new Date(coverage.generatedAt).toLocaleString()} · Feed mappings require an issuer keyword in the Pyth catalog description and an exact token-symbol match; xStocks additionally carry Pyth&apos;s redemption-rate feed · <Link href="/markets">Back to Markets</Link>
      </p>
    </div>
  );
}
