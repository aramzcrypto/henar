export type AdminProduct = {
  name: string;
  accounts: number | null;
  wallets: number | null;
  principal: string | null;
  recordedYieldFees: string | null;
  recordedPackFees: string | null;
  deliveredBudget: string | null;
  status: string;
};
export type AdminUser = {
  wallet: string;
  products: string[];
  positions: number;
  sealed: string;
  principal: string;
  firstSeen: number;
  lastSeen: number;
};
export type AdminActivity = {
  address: string;
  wallet: string;
  product: string;
  status: string;
  timestamp: number;
  amount: string | null;
};
export type AdminSnapshot = {
  observedAt: string;
  programId: string;
  treasury: { address: string; balance: string | null };
  access: {
    paused: boolean;
    pilotOwner: string;
    admissionLimit: string;
    admitted: string;
    enabledProducts: number;
  };
  totals: {
    wallets: number;
    positions: number;
    activeOrders: number;
    principal: string;
    sealed: string;
    pendingPacks: number;
    settledPacks: number;
    overduePacks: number;
    yieldFees: string;
    packFees: string | null;
  };
  products: AdminProduct[];
  users: AdminUser[];
  activity: AdminActivity[];
  warnings: string[];
  coverage: string;
};
