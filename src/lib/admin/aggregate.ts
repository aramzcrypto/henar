import type { AdminActivity, AdminProduct, AdminUser } from "./types";

type Amount = { toString(): string };
type Key = { toBase58(): string };
type Enum = Record<string, unknown>;
export type PositionRecord = {
  address: string;
  owner: Key;
  kind: Enum;
  status: Enum;
  principalBasis: Amount;
  yieldFees: Amount;
  stockUsdcSpent: Amount;
  createdAt: Amount;
  updatedAt: Amount;
};
export type BatchRecord = {
  address: string;
  owner: Key;
  creator: Key;
  remaining: Amount;
  unitFee: Amount;
  createdAt: Amount;
};
export type PackRecord = {
  address: string;
  owner: Key;
  batch: Key;
  status: Enum;
  lucky: boolean;
  unitFee: Amount;
  stockValue: Amount;
  createdAt: Amount;
  settledAt: Amount;
  expiresAt: Amount;
};
const amount = (v: Amount) => BigInt(v.toString());
const timestamp = (v: Amount) => Number(v.toString());
const kind = (v: Enum) => Object.keys(v)[0] || "unknown";
export function aggregateAdmin(
  positions: PositionRecord[],
  batches: BatchRecord[],
  packs: PackRecord[],
  enabled: number,
  paused: boolean,
  now = Date.now(),
) {
  const users = new Map<string, AdminUser>();
  const activity: AdminActivity[] = [];
  const products: AdminProduct[] = [
    {
      name: "Market",
      accounts: null,
      wallets: null,
      principal: null,
      recordedYieldFees: null,
      recordedPackFees: null,
      deliveredBudget: null,
      status: "Not indexed",
    },
    ...[
      ["Earn", 1],
      ["Limit", 2],
      ["DCA", 4],
      ["Random Packs", 16],
      ["Lucky Packs", 48],
    ].map(([name, mask]) => ({
      name: String(name),
      accounts: 0,
      wallets: 0,
      principal: Number(mask) < 16 ? "0" : null,
      recordedYieldFees: Number(mask) < 16 ? "0" : null,
      recordedPackFees: Number(mask) >= 16 ? "0" : null,
      deliveredBudget: "0",
      status:
        !paused && (enabled & Number(mask)) === Number(mask)
          ? "Enabled by policy"
          : "Disabled",
    })),
    {
      name: "Referrals",
      accounts: null,
      wallets: null,
      principal: null,
      recordedYieldFees: null,
      recordedPackFees: null,
      deliveredBudget: null,
      status: "Coming soon",
    },
  ];
  const walletSets = new Map<string, Set<string>>();
  function user(
    wallet: string,
    product: string,
    created: number,
    updated: number,
  ) {
    let u = users.get(wallet);
    if (!u) {
      u = {
        wallet,
        products: [],
        positions: 0,
        sealed: "0",
        principal: "0",
        firstSeen: created,
        lastSeen: updated,
      };
      users.set(wallet, u);
    }
    if (!u.products.includes(product)) u.products.push(product);
    u.firstSeen = Math.min(u.firstSeen, created);
    u.lastSeen = Math.max(u.lastSeen, updated);
    if (!walletSets.has(product)) walletSets.set(product, new Set());
    walletSets.get(product)!.add(wallet);
    return u;
  }
  let principal = 0n,
    yieldFees = 0n,
    sealed = 0n,
    packFees = 0n,
    activeOrders = 0,
    pendingPacks = 0,
    settledPacks = 0,
    overduePacks = 0;
  let completePackFees = true;
  for (const p of positions) {
    const name = (
      { earn: "Earn", limit: "Limit", dca: "DCA" } as Record<string, string>
    )[kind(p.kind)];
    if (!name) throw new Error("Unknown position kind.");
    const product = products.find((v) => v.name === name)!;
    const balance = amount(p.principalBasis),
      fees = amount(p.yieldFees);
    const u = user(
      p.owner.toBase58(),
      name,
      timestamp(p.createdAt),
      timestamp(p.updatedAt),
    );
    u.positions++;
    u.principal = (BigInt(u.principal) + balance).toString();
    product.accounts!++;
    product.principal = (BigInt(product.principal!) + balance).toString();
    product.recordedYieldFees = (
      BigInt(product.recordedYieldFees!) + fees
    ).toString();
    product.recordedPackFees = null;
    product.deliveredBudget = (
      BigInt(product.deliveredBudget!) + amount(p.stockUsdcSpent)
    ).toString();
    principal += balance;
    yieldFees += fees;
    if (name !== "Earn" && "active" in p.status) activeOrders++;
    activity.push({
      address: p.address,
      wallet: u.wallet,
      product: name,
      status: kind(p.status),
      timestamp: timestamp(p.updatedAt),
      amount: balance.toString(),
    });
  }
  const batchMap = new Map(batches.map((b) => [b.address, b]));
  for (const b of batches) {
    const u = user(
      b.owner.toBase58(),
      "Sealed Packs",
      timestamp(b.createdAt),
      timestamp(b.createdAt),
    );
    const remaining = amount(b.remaining);
    sealed += remaining;
    u.sealed = (BigInt(u.sealed) + remaining).toString();
  }
  for (const p of packs) {
    const name = p.lucky ? "Lucky Packs" : "Random Packs";
    const product = products.find((v) => v.name === name)!;
    const status = kind(p.status),
      created = timestamp(p.createdAt),
      settled = timestamp(p.settledAt);
    user(p.owner.toBase58(), name, created, Math.max(created, settled));
    product.accounts!++;
    product.principal = null;
    product.recordedYieldFees = null;
    let fee = 0n;
    // Random collects on settlement. Lucky pays the batch fee once on opening
    // and zeroes the pack's fee; rollovers must never be counted again.
    if (p.lucky) {
      const batch = batchMap.get(p.batch.toBase58());
      if (!batch) {
        completePackFees = false;
        product.recordedPackFees = null;
      } else fee = amount(batch.unitFee);
    } else if (status === "settled") fee = amount(p.unitFee);
    packFees += fee;
    if (product.recordedPackFees !== null)
      product.recordedPackFees = (
        BigInt(product.recordedPackFees) + fee
      ).toString();
    if (status === "settled") {
      settledPacks++;
      product.deliveredBudget = (
        BigInt(product.deliveredBudget!) + amount(p.stockValue)
      ).toString();
    } else if (status !== "refunded") {
      pendingPacks++;
      if (status !== "luckyReady" && timestamp(p.expiresAt) * 1000 < now)
        overduePacks++;
    }
    activity.push({
      address: p.address,
      wallet: p.owner.toBase58(),
      product: name,
      status,
      timestamp: Math.max(created, settled),
      amount: status === "settled" ? amount(p.stockValue).toString() : null,
    });
  }
  for (const p of products) {
    if (p.wallets !== null) p.wallets = walletSets.get(p.name)?.size || 0;
  }
  return {
    totals: {
      wallets: users.size,
      positions: positions.length,
      activeOrders,
      principal: principal.toString(),
      sealed: sealed.toString(),
      pendingPacks,
      settledPacks,
      overduePacks,
      yieldFees: yieldFees.toString(),
      packFees: completePackFees ? packFees.toString() : null,
    },
    products,
    users: [...users.values()].sort((a, b) => b.lastSeen - a.lastSeen),
    activity: activity.sort((a, b) => b.timestamp - a.timestamp).slice(0, 30),
  };
}
