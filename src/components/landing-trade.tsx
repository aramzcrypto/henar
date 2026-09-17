import { Clock3, Crosshair, Repeat2 } from "lucide-react";

/**
 * Three order types, and the execution underneath them.
 *
 * This used to open on a Simple/Pro switch. There is no Pro terminal and one
 * is not being built, so the switch promised a product that does not exist and
 * spent the most prominent slot in the section doing it. What belongs there is
 * the thing Henar actually built and nobody can see from a screenshot: the
 * router.
 *
 * Every claim here is checkable. The venues are the ones with enabled pools in
 * `src/data/router/pools.json`; splitting across up to three of them is
 * `DEFAULT_SPLIT_OPTIONS.maxLegs`; the simulation is the gate in
 * `RouterApi.quoteAndBuild`, which refuses a route whose simulation errors or
 * falls short of its floor.
 */
const MODES = [
  {
    icon: Repeat2,
    name: "Swap",
    description: "Every venue quoted at once, ranked by what lands in your wallet.",
  },
  {
    icon: Crosshair,
    name: "Limit + Yield",
    description: "Put idle orders to work until they fill.",
  },
  {
    icon: Clock3,
    name: "DCA",
    description: "Build a position on a schedule you set.",
  },
];

const VENUES = ["Raydium", "Orca", "Meteora", "Jupiter", "OpenOcean"];

export function LandingTrade() {
  return (
    <div className="trade-intro" data-reveal>
      <div className="troute" role="img" aria-label="Henar routes across Raydium, Orca, Meteora, Jupiter and OpenOcean, splitting one order across up to three venues">
        <span className="troute-label">Routes across</span>
        <span className="troute-venues">
          {VENUES.map((venue) => (
            <span className="troute-venue" key={venue}>
              {venue}
            </span>
          ))}
        </span>
      </div>
      <p className="trade-note">
        One order can be split across three venues at once. Every transaction is
        simulated before it reaches your wallet.
      </p>

      <div className="tmodes">
        {MODES.map(({ icon: Icon, name, description }, index) => (
          <article
            className="tmode"
            key={name}
            data-reveal
            style={{ "--reveal-delay": `${index * 90}ms` } as React.CSSProperties}
          >
            <span className="tmode-icon">
              <Icon size={19} strokeWidth={1.6} />
            </span>
            <h3>{name}</h3>
            <p>{description}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
