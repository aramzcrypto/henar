import { Clock3, Crosshair, Repeat2 } from "lucide-react";

/**
 * Trade is one set of order types behind two interfaces, so the interfaces are
 * a switch above the order types rather than a fourth item beside them: Swap,
 * Limit and DCA all work in Simple and in Pro.
 */
const MODES = [
  {
    icon: Repeat2,
    name: "Swap",
    description: "Route across available liquidity, ranked by net output.",
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

export function LandingTrade() {
  return (
    <div className="tswitch-wrap" data-reveal>
      <div className="tswitch" role="img" aria-label="Simple and Pro interfaces">
        <span data-on>Simple</span>
        <span>Pro</span>
      </div>
      <p className="tswitch-note">One toggle. The same order types in both.</p>

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
