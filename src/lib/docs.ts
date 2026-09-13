export type DocSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: { headings: string[]; rows: string[][] };
  links?: { label: string; href: string }[];
};
export type Doc = {
  slug: string;
  title: string;
  group: string;
  description: string;
  sections: DocSection[];
};
export const docs: Doc[] = [
  {
    slug: "",
    title: "Meet Henar",
    group: "Start here",
    description: "Stocks, on your terms. Built on Solana.",
    sections: [
      {
        id: "overview",
        title: "A home for your stocks",
        paragraphs: [
          "Henar brings tokenized stock trading, USDC yield, and sealed Stock Packs into one app. Buy a company you know, put waiting capital to work, or discover a stock through a pack.",
          "Connect a Solana wallet to get started. Stockfolio brings your holdings and Henar positions together.",
        ],
      },
      {
        id: "products",
        title: "Explore Henar",
        table: {
          headings: ["Product", "What it does"],
          rows: [
            ["Trade", "Market swaps, yield-bearing Limit orders, and DCA."],
            [
              "Earn",
              "Put USDC to work and direct net yield toward stocks or packs.",
            ],
            [
              "Packs",
              "Discover a tokenized stock with Random or choose Lucky allocation odds.",
            ],
            [
              "Referrals",
              "Invite friends. Planned rewards turn fee shares into sealed packs.",
            ],
          ],
        },
      },
      {
        id: "v1",
        title: "About this release",
        paragraphs: [
          "Henar V1 is being prepared for a Solana hackathon submission. These guides cover the V1 product design; a visible preview is not the same as an enabled financial product. Check availability in the app before using a feature.",
          "The contracts are deployed, and an Earn deposit and withdrawal have been verified in a restricted pilot. Public product access remains gated. Referral earnings are not active. V2 is a proposed roadmap, not a delivery promise.",
        ],
      },
      {
        id: "before-you-start",
        title: "Before you start",
        bullets: [
          "Use a compatible Solana wallet and keep SOL for network fees.",
          "Review the asset, amount, fees, and minimum received before signing.",
          "Tokenized stocks depend on their issuers, trading liquidity, and transfer eligibility. Yield varies and capital can lose value.",
        ],
      },
    ],
  },
  {
    slug: "trade/market",
    title: "Market",
    group: "Trade",
    description: "Buy or sell a tokenized stock at an available market quote.",
    sections: [
      {
        id: "how-it-works",
        title: "How it works",
        bullets: [
          "Choose a stock and payment token, then enter an amount.",
          "Review the quote, fees, and minimum received.",
          "Confirm in your wallet. Your balance updates after confirmation.",
        ],
        paragraphs: [
          "Henar uses Jupiter for swap routing. Available routes, liquidity, and issuer restrictions determine which trades can execute.",
        ],
      },
      {
        id: "fees",
        title: "Fees and execution",
        paragraphs: [
          "The current Market fee is 0.15%. The review shows the fee token and amount. Network costs and any account-creation costs are separate.",
          "Quotes expire. A price estimate is not a guaranteed execution price; the minimum received protects the reviewed trade against excessive slippage.",
        ],
      },
      {
        id: "availability",
        title: "Availability",
        paragraphs: [
          "Market uses live routes when configured. A listing in the stock catalog does not guarantee an executable trade.",
        ],
      },
    ],
  },
  {
    slug: "trade/limit",
    title: "Limit with Yield",
    group: "Trade",
    description: "Set your buy price. Put the waiting USDC to work.",
    sections: [
      {
        id: "how-it-works",
        title: "How it works",
        paragraphs: [
          "Choose a stock, a target price, and a USDC budget. The order deposits USDC into the configured yield venue while it waits.",
          "A settlement service checks the price condition and delivers stock when the order can execute within its limits. Reaching the target price alone does not guarantee a fill.",
        ],
      },
      {
        id: "manage",
        title: "Manage your order",
        bullets: [
          "Review the target price, fees, and yield terms before signing.",
          "Track the order in Stockfolio.",
          "Cancel an unfilled order to recover the available funds and net accrued yield, subject to the venue’s withdrawal liquidity.",
        ],
      },
      {
        id: "availability",
        title: "V1 activation",
        paragraphs: [
          "Requires the Henar contracts, a running settlement service, supported price feeds, and a liquid execution route. Yield is variable; principal is exposed to the underlying venue.",
        ],
      },
    ],
  },
  {
    slug: "trade/dca",
    title: "DCA",
    group: "Trade",
    description: "Build a position through scheduled purchases.",
    sections: [
      {
        id: "how-it-works",
        title: "How it works",
        paragraphs: [
          "Choose a stock, fund your plan with USDC, and set the purchase schedule. Unspent USDC earns variable yield in the configured venue while it waits.",
          "The settlement service attempts eligible purchases on schedule. Network conditions, prices, and liquidity may delay execution.",
        ],
      },
      {
        id: "manage",
        title: "Manage your plan",
        bullets: [
          "Review the total budget, purchase size, interval, and fees.",
          "Follow completed purchases and the remaining balance in Stockfolio.",
          "Cancel the remaining plan when you want to stop. Completed purchases remain yours.",
        ],
      },
      {
        id: "availability",
        title: "V1 activation",
        paragraphs: [
          "DCA requires activated contracts, supported price feeds, and a running settlement service. Spreading purchases over time does not guarantee a profit or protect against a falling stock price.",
        ],
      },
    ],
  },
  {
    slug: "earn",
    title: "Earn",
    group: "Products",
    description: "Turn USDC yield into stocks or sealed packs.",
    sections: [
      {
        id: "how-it-works",
        title: "How it works",
        paragraphs: [
          "Deposit USDC into Henar’s configured Kamino vault integration and choose a yield destination: Stocks or Packs. The app tracks principal and accrued yield separately.",
          "Auto Packs uses each $10 of net available yield to create a sealed Random pack. The stock destination uses net yield to purchase the chosen supported stock when execution is available.",
        ],
      },
      {
        id: "yield",
        title: "Yield and fees",
        paragraphs: [
          "The default Henar share is 10% of accrued yield. Check the current terms before depositing. Yield-earned packs allocate $10 toward stock without an additional pack opening fee.",
          "APY changes with the underlying venue. Yield is not a fixed payment, and a displayed APY is not a guarantee.",
        ],
      },
      {
        id: "withdraw",
        title: "Withdrawals and availability",
        paragraphs: [
          "Manage deposits and withdrawals from your position. Withdrawals depend on available venue liquidity; separating principal from yield in the app does not insure the deposit.",
          "Earn is in a restricted mainnet pilot; a deposit and full withdrawal have been verified. Public access remains gated. Yield-to-stock settlement has additional price-feed and execution requirements.",
        ],
      },
    ],
  },
  {
    slug: "packs/random",
    title: "Random Packs",
    group: "Packs",
    description: "One sealed pack. One stock to discover.",
    sections: [
      {
        id: "how-it-works",
        title: "How it works",
        bullets: [
          "Buy a $10 sealed Stock Pack, or earn one through an eligible product.",
          "Choose Random when opening. Verifiable randomness selects from the pack’s eligible stock list.",
          "The allocation buys the selected stock and delivers it to your wallet after settlement.",
        ],
        paragraphs: [
          "Check Possible stocks before opening. The selected stock is random; the allocation does not depend on a Lucky multiplier.",
        ],
      },
      {
        id: "allocation",
        title: "Your allocation",
        paragraphs: [
          "At the current 2% purchased-pack fee, a $10 pack has a $9.80 stock budget before execution costs. Yield-earned packs use a $10 stock budget with no extra pack opening fee.",
          "A sealed pack is an entitlement recorded by Henar’s program, not an NFT. Stock price changes after delivery affect the value of your holdings.",
        ],
      },
      {
        id: "manage",
        title: "Opening and managing packs",
        paragraphs: [
          "Supported sealed packs can be gifted or refunded under the contract rules. Opening takes time for randomness and stock delivery; a reveal animation is not proof of a completed purchase.",
          "Random Packs require enabled contracts and a running delivery service. If delivery cannot complete, the app exposes recovery when the applicable timeout is reached.",
        ],
      },
    ],
  },
  {
    slug: "packs/lucky",
    title: "Lucky Packs",
    group: "Packs",
    description: "A random stock with a variable allocation.",
    sections: [
      {
        id: "how-it-works",
        title: "How it works",
        paragraphs: [
          "Lucky is an opening choice for eligible purchased packs. It applies a random multiplier to the post-fee allocation and reveals the selected stock before buying it.",
          "Choose Bank to authorize the stock purchase. If available, Roll Over risks the allocation once more with fresh randomness while keeping the selected stock. Only one rollover is allowed; after that, Bank is the continuation.",
        ],
      },
      {
        id: "odds",
        title: "V1 odds",
        table: {
          headings: ["Allocation multiplier", "Probability"],
          rows: [
            ["0.25×", "4%"],
            ["0.5×", "20%"],
            ["1×", "64%"],
            ["1.5×", "8%"],
            ["2×", "4%"],
          ],
        },
        paragraphs: [
          "Each roll has a 24% chance of reducing the allocation. The expected allocation is 95% of the amount risked per roll, before execution costs. A second roll can reduce it further.",
        ],
      },
      {
        id: "cost",
        title: "Cost and availability",
        paragraphs: [
          "With the current 2% pack fee, the first roll risks $9.80 of a $10 purchased pack. The first result ranges from $2.45 to $19.60. Bank and Roll Over do not charge the pack fee again; network and randomness costs are separate.",
          "Lucky remains independently disabled until its reserve is funded and the required reviews and live verification are complete. Opening and rollover depend on reserve capacity. Earned packs retain Random opening.",
        ],
      },
    ],
  },
  {
    slug: "stockfolio",
    title: "Stockfolio",
    group: "Products",
    description: "Your stocks, positions, and packs in one place.",
    sections: [
      {
        id: "holdings",
        title: "See what you own",
        paragraphs: [
          "Connect your wallet to view supported stock balances alongside Henar positions and sealed packs. A pending transaction is not a confirmed holding.",
        ],
      },
      {
        id: "manage",
        title: "Manage your activity",
        bullets: [
          "Follow orders and yield positions.",
          "View sealed packs and available pack actions.",
          "Use transaction receipts to check confirmed activity.",
        ],
      },
      {
        id: "next",
        title: "What comes next",
        paragraphs: [
          "V2 priorities include cost basis, realized and unrealized performance, allocation breakdowns, and exportable history. Historical values need reliable price and transaction coverage before they can be shown as complete.",
        ],
      },
    ],
  },
  {
    slug: "referrals",
    title: "Referrals",
    group: "Products",
    description: "Invite friends. Earn toward a sealed pack.",
    sections: [
      {
        id: "rewards",
        title: "Planned rewards",
        paragraphs: [
          "Earn 10% of the trading fees Henar collects from eligible referred trades. Each $10 in accrued rewards will fund a sealed Random pack for your wallet.",
        ],
      },
      {
        id: "invite",
        title: "Your invite link",
        paragraphs: [
          "Open Rewards beside the wallet button and connect your wallet to copy your link. Early invitations are remembered in the visitor’s browser for 30 days.",
        ],
      },
      {
        id: "status",
        title: "Prelaunch status",
        paragraphs: [
          "Verified referral counts, fee credits, and automatic pack delivery are not active. Early link capture does not create a reward balance. Points are reserved for a future release; no points or token distribution is promised.",
        ],
      },
    ],
  },
  {
    slug: "roadmap",
    title: "Roadmap",
    group: "What’s next",
    description: "Finish V1. Verify the experience. Expand with purpose.",
    sections: [
      {
        id: "submission",
        title: "Now · Hackathon submission",
        bullets: [
          "Polish the core Trade → Earn → Packs → Stockfolio story.",
          "Ship concise docs and a short walkthrough with clear product availability.",
          "Demonstrate verified flows with transaction receipts; label previews and unavailable integrations.",
          "Finish contract review and prioritize blockers over new product scope.",
        ],
      },
      {
        id: "launch",
        title: "Next · Controlled V1 launch",
        bullets: [
          "Expand the verified Earn pilot into complete product tests, with funded services and confirmed receipts.",
          "Enable products gradually with limits, monitoring, and recovery procedures.",
          "Activate the verified referral ledger and funded pack delivery.",
          "Collect feedback on execution, onboarding, and portfolio clarity.",
        ],
      },
      {
        id: "v2",
        title: "Then · V2",
        bullets: [
          "Trade: watchlists, alerts, better order management, and additional order controls.",
          "Stockfolio: performance, allocation, cost basis, and exports.",
          "Research stock yield and borrowing integrations for supported assets.",
          "Packs V2: TBD.",
        ],
        paragraphs: [
          "Sequence reflects current priorities. Features depend on user feedback, integrations, security review, and liquidity; no release dates are committed.",
        ],
      },
    ],
  },
  {
    slug: "v2",
    title: "V2 outlook",
    group: "What’s next",
    description: "A more useful home for tokenized stocks.",
    sections: [
      {
        id: "trade",
        title: "A deeper trading experience",
        bullets: [
          "Prioritize watchlists, price alerts, and clearer order history.",
          "Explore editing pending orders and more flexible DCA schedules.",
          "Evaluate stop-loss and take-profit orders after trigger reliability and failure handling are verified.",
        ],
        paragraphs: [
          "These are proposed extensions, not features available in V1.",
        ],
      },
      {
        id: "stockfolio",
        title: "A clearer Stockfolio",
        bullets: [
          "Cost basis and realized / unrealized performance with transparent data coverage.",
          "Portfolio allocation and concentration views.",
          "Exportable transactions and yield history.",
          "Explore user-confirmed rebalancing after reliable portfolio accounting.",
        ],
      },
      {
        id: "stock-yield",
        title: "Stock yield · Research",
        paragraphs: [
          "Explore lending supported tokenized stocks or depositing them into defined yield strategies. We will describe the actual yield source rather than promise a generic stock-staking APY.",
          "Availability will depend on asset support, demand, issuer terms, and integration review. Holding or locking a stock token alone does not create additional yield.",
        ],
      },
      {
        id: "borrow",
        title: "Borrow against stocks · Research",
        paragraphs: [
          "Explore borrowing USDC against supported stock collateral through an established lending integration. No collateral list or borrowing limits are committed.",
          "Borrowing requires reliable valuations, sufficient liquidity, and clear health and liquidation controls. A fall in collateral value can result in liquidation.",
        ],
        links: [
          {
            label: "Reference: Kamino borrowing",
            href: "https://kamino.com/docs/products/borrow",
          },
        ],
      },
      {
        id: "packs",
        title: "Packs V2 · TBD",
        paragraphs: [
          "A new chapter for Packs. Details will be shared after the V1 experience is validated.",
        ],
      },
      {
        id: "focus",
        title: "What we’re leaving out for now",
        paragraphs: [
          "No native token, promised airdrop, fixed-yield stock staking, or leveraged trading in the near-term plan. The priority is useful stock products with understandable execution and accounting.",
        ],
      },
    ],
  },
];
export function docHref(slug: string) {
  return slug ? `/docs/${slug}` : "/docs";
}
