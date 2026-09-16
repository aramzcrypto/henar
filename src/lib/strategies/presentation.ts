/**
 * Presentation rules for strategy pools.
 *
 * These are pure decisions about what to show, with no protocol imports, so
 * a client component can use them without pulling an SDK — and a Node-only
 * import — into the browser bundle.
 */

export type DepositAvailability = {
  /** Whether a deposit can be made through Henar. Always false in this version. */
  available: boolean;
  label: string;
  /** Why not, in the words a depositor should read. */
  note: string;
};

/**
 * What a depositor can do today.
 *
 * The distinction this makes is the one that matters: the pool is live on its
 * protocol, and it is Henar's deposit path that does not exist yet. Saying
 * "coming soon" about the pool would be wrong; saying it about the deposit is
 * exactly right.
 */
export function depositAvailability(): DepositAvailability {
  return {
    available: false,
    label: "Coming soon",
    note: "The pool is live on its protocol. Depositing into it through Henar is not built yet, so this strategy holds no capital and accepts none.",
  };
}

/**
 * Whether the pool's published rate is the strategy's own return.
 *
 * Both Meteora strategies sit on the same pool, but only one of them earns
 * that pool's LP fees. An accumulation strategy places limit orders: its
 * return is the price it pays, and showing the pool's fee APY beside it
 * would credit the strategy with income it does not collect.
 */
export function rateIsStrategyReturn(strategyType: string) {
  return strategyType !== "SMART_ACCUMULATE";
}
